// Job business logic behind routes_jobs.pb.js and routes_scan.pb.js:
// - buildSummary: everything the job page shows (lines, prices,
//   availability warnings, packing progress, quotes)
// - addLine / updateLine / deleteLine: line changes, including adding a
//   kit's components and an item's accessories automatically
// - issueQuote: freezing the job into a numbered quote snapshot
//
// Helpers take `app` rather than using $app so they work inside
// runInTransaction() with the transaction's app.
const { toMs } = require("./time.js");
const pricing = require("./pricing.js");
const { findOrNull } = require("./records.js");

const LINE_TYPES_FOLLOWING_PARENT = ["component", "accessory"];
// Done jobs don't hold stock, so there's nothing to warn about.
const NO_AVAILABILITY_STATUSES = ["returned", "cancelled"];

function requireJob(app, id) {
  const job = findOrNull(app, "jobs", id);
  if (!job) throw new NotFoundError("Job not found");
  return job;
}

function requireLine(app, id) {
  const line = findOrNull(app, "job_lines", id);
  if (!line) throw new NotFoundError("Line not found");
  return line;
}

function itemInfo(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.getString("name"),
    code: item.getString("code"),
    kind: item.getString("kind"),
    tracking: item.getString("tracking"),
    dayRate: item.getFloat("dayRate"),
    barcode: item.getString("barcode"),
    description: item.getString("description"),
    locationInWarehouse: item.getString("locationInWarehouse"),
    weightKg: item.getFloat("weightKg"),
    powerW: item.getFloat("powerW"),
    archived: item.getBool("archived"),
  };
}

function contactInfo(contact) {
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.getString("name"),
    contactPerson: contact.getString("contactPerson"),
    email: contact.getString("email"),
    phone: contact.getString("phone"),
    billingAddress: contact.getString("billingAddress"),
  };
}

function venueInfo(venue) {
  if (!venue) return null;
  return {
    id: venue.id,
    name: venue.getString("name"),
    address: venue.getString("address"),
    contactName: venue.getString("contactName"),
    phone: venue.getString("phone"),
  };
}

function jobInfo(app, job) {
  return {
    id: job.id,
    org: job.getString("org"),
    number: job.getInt("number"),
    name: job.getString("name"),
    status: job.getString("status"),
    client: job.getString("client"),
    venue: job.getString("venue"),
    prepAt: job.getString("prepAt"),
    showStart: job.getString("showStart"),
    showEnd: job.getString("showEnd"),
    returnAt: job.getString("returnAt"),
    chargeDays: job.getInt("chargeDays"),
    discountPct: job.getFloat("discountPct"),
    reference: job.getString("reference"),
    quoteNotes: job.getString("quoteNotes"),
    notes: job.getString("notes"),
    created: job.getString("created"),
    updated: job.getString("updated"),
    clientInfo: contactInfo(findOrNull(app, "contacts", job.getString("client"))),
    venueInfo: venueInfo(findOrNull(app, "venues", job.getString("venue"))),
  };
}

// Charged days: an explicit override wins, then the show dates, then the
// whole prep→return period for a dry hire with no show.
function chargeDaysFor(job) {
  const override = job.getInt("chargeDays");
  if (override > 0) return { days: override, basis: "override" };
  const showStart = toMs(job.getString("showStart"));
  const showEnd = toMs(job.getString("showEnd"));
  if (Number.isFinite(showStart) && Number.isFinite(showEnd)) {
    return { days: pricing.chargeableDays(showStart, showEnd), basis: "show" };
  }
  return { days: pricing.chargeableDays(toMs(job.getString("prepAt")), toMs(job.getString("returnAt"))), basis: "hire" };
}

// Parents in sortOrder, each followed by its own auto-added lines.
function orderLines(lines) {
  const bySort = (a, b) =>
    a.getInt("sortOrder") - b.getInt("sortOrder") || String(a.getString("created")).localeCompare(b.getString("created"));
  const top = lines.filter((l) => !l.getString("parentLine")).sort(bySort);
  const children = {};
  for (const l of lines) {
    const parent = l.getString("parentLine");
    if (parent) (children[parent] = children[parent] || []).push(l);
  }
  const ordered = [];
  for (const parent of top) {
    ordered.push(parent);
    for (const child of (children[parent.id] || []).sort(bySort)) ordered.push(child);
  }
  return ordered;
}

function loadLines(app, jobId) {
  return orderLines(app.findRecordsByFilter("job_lines", "job = {:job}", "", 0, 0, { job: jobId }));
}

function loadItems(app, lines) {
  const ids = [];
  for (const l of lines) if (l.getString("item") && ids.indexOf(l.getString("item")) === -1) ids.push(l.getString("item"));
  const map = {};
  for (const item of app.findRecordsByIds("items", ids)) if (item) map[item.id] = item;
  return map;
}

function displayName(line, item) {
  if (line.getString("lineType") === "custom") return line.getString("description");
  return item ? item.getString("name") : "(deleted item)";
}

// What's been scanned out and back for a job. Bulk items count quantities;
// serials track which units are currently out on this job.
function packingState(app, jobId, needs, itemsById) {
  const scans = app.findRecordsByFilter("scans", "job = {:job}", "created", 0, 0, { job: jobId });
  const state = {};
  const ensure = (itemId) => {
    if (!state[itemId]) {
      const item = itemsById[itemId] || findOrNull(app, "items", itemId);
      state[itemId] = {
        itemId: itemId,
        name: item ? item.getString("name") : "(deleted item)",
        tracking: item ? item.getString("tracking") : "",
        needed: needs[itemId] || 0,
        scannedOut: 0,
        returned: 0,
        serialsOut: {},
      };
    }
    return state[itemId];
  };
  for (const itemId of Object.keys(needs)) ensure(itemId);

  for (const scan of scans) {
    const s = ensure(scan.getString("item"));
    const qty = scan.getInt("quantity");
    const serialId = scan.getString("serial");
    if (scan.getString("direction") === "out") {
      s.scannedOut += qty;
      if (serialId) s.serialsOut[serialId] = true;
    } else {
      s.returned += qty;
      if (serialId) delete s.serialsOut[serialId];
    }
  }

  const serialIds = [];
  for (const itemId of Object.keys(state)) serialIds.push.apply(serialIds, Object.keys(state[itemId].serialsOut));
  const serialById = {};
  for (const serial of app.findRecordsByIds("serials", serialIds)) if (serial) serialById[serial.id] = serial;

  const items = Object.keys(state).map((itemId) => {
    const s = state[itemId];
    return {
      itemId: s.itemId,
      name: s.name,
      tracking: s.tracking,
      needed: s.needed,
      scannedOut: s.scannedOut,
      returned: s.returned,
      out: s.scannedOut - s.returned,
      serialsOut: Object.keys(s.serialsOut).map((id) => ({
        id: id,
        barcode: serialById[id] ? serialById[id].getString("barcode") : "",
        label: serialById[id] ? serialById[id].getString("label") : "",
      })),
    };
  });
  items.sort((a, b) => a.name.localeCompare(b.name));
  const packed = items.every((i) => i.scannedOut >= i.needed);
  const allBack = items.every((i) => i.out <= 0);
  return { items: items, packed: items.length > 0 && packed, allBack: allBack, scanCount: scans.length };
}

// The job page's whole payload. show is true for everything, or what this
// person's role allows ({ prices, quotes } from lib/orgs.js summaryAccess):
// without prices it's the kit list and packing state, no money.
function buildSummary(app, jobId, show) {
  const includePrices = show === true || !!(show && show.prices);
  const includeQuotes = show === true || !!(show && show.quotes);
  const { pricingSettings } = require(`${__hooks}/lib/settings.js`);
  const { jobAvailability } = require(`${__hooks}/lib/availabilityData.js`);
  const job = requireJob(app, jobId);
  const org = job.getString("org");
  const settings = pricingSettings(org);
  const lines = loadLines(app, job.id);
  const itemsById = loadItems(app, lines);

  // Physical units needed per item, across every line (an item can be on a
  // job directly and inside a kit).
  const needs = {};
  for (const line of lines) {
    const item = itemsById[line.getString("item")];
    if (item && item.getString("kind") === "item") {
      needs[item.id] = (needs[item.id] || 0) + Math.round(line.getFloat("quantity"));
    }
  }

  const start = toMs(job.getString("prepAt"));
  const end = toMs(job.getString("returnAt"));
  const availability =
    NO_AVAILABILITY_STATUSES.indexOf(job.getString("status")) === -1 && Object.keys(needs).length > 0
      ? jobAvailability(app, org, job.id, start, end, needs, settings.bufferHours)
      : {};

  const charge = chargeDaysFor(job);
  const factor = pricing.dayFactor(charge.days, settings.factors, settings.extraDayFactor);
  const priced = lines.map((l) => ({
    unitPrice: l.getFloat("unitPrice"),
    quantity: l.getFloat("quantity"),
    discountPct: l.getFloat("discountPct"),
    priceMode: l.getString("priceMode"),
  }));
  const totals = pricing.quoteTotals(priced, {
    factor: factor,
    discountPct: job.getFloat("discountPct"),
    gstRate: settings.gstRate,
  });

  const shortByLine = {};
  const lineViews = lines.map((line, i) => {
    const item = itemsById[line.getString("item")] || null;
    const avail = item && availability[item.id] ? availability[item.id] : null;
    if (avail && avail.short > 0 && line.getString("parentLine")) shortByLine[line.getString("parentLine")] = true;
    const view = {
      id: line.id,
      parentLine: line.getString("parentLine"),
      lineType: line.getString("lineType"),
      item: itemInfo(item),
      name: displayName(line, item),
      description: line.getString("description"),
      quantity: line.getFloat("quantity"),
      perParent: line.getInt("perParent"),
      priceMode: line.getString("priceMode"),
      group: line.getString("group"),
      sortOrder: line.getInt("sortOrder"),
      notes: line.getString("notes"),
      availability: avail,
    };
    if (includePrices) {
      view.unitPrice = line.getFloat("unitPrice");
      view.discountPct = line.getFloat("discountPct");
      view.amount = {
        gross: pricing.fromCents(totals.lines[i].gross),
        discount: pricing.fromCents(totals.lines[i].discount),
        net: pricing.fromCents(totals.lines[i].net),
      };
    }
    return view;
  });
  // A kit's own line has no stock, so flag it when any of its components is short.
  for (const view of lineViews) view.componentsShort = shortByLine[view.id] === true;

  const summary = {
    job: jobInfo(app, job),
    lines: lineViews,
    packing: packingState(app, job.id, needs, itemsById),
    includesPrices: includePrices,
  };

  if (includePrices) {
    summary.pricing = {
      days: charge.days,
      basis: charge.basis,
      factor: factor,
      gstRate: settings.gstRate,
      discountPct: job.getFloat("discountPct"),
      totals: {
        gross: pricing.fromCents(totals.gross),
        lineDiscount: pricing.fromCents(totals.lineDiscount),
        jobDiscount: pricing.fromCents(totals.jobDiscount),
        exGst: pricing.fromCents(totals.exGst),
        gst: pricing.fromCents(totals.gst),
        total: pricing.fromCents(totals.total),
      },
    };
    if (includeQuotes) {
      summary.quotes = app
        .findRecordsByFilter("quotes", "job = {:job}", "-version", 0, 0, { job: job.id })
        .map((q) => ({
          id: q.id,
          version: q.getInt("version"),
          status: q.getString("status"),
          total: q.getFloat("total"),
          issuedAt: q.getString("issuedAt"),
          validUntil: q.getString("validUntil"),
        }));
    }
  }
  return summary;
}

// Top-level category name, used as an item line's default quote heading.
function topCategoryName(app, categoryId) {
  let current = findOrNull(app, "categories", categoryId);
  for (let depth = 0; current && current.getString("parent") && depth < 50; depth++) {
    const parent = findOrNull(app, "categories", current.getString("parent"));
    if (!parent) break;
    current = parent;
  }
  return current ? current.getString("name") : "";
}

function nextSortOrder(app, jobId) {
  const rows = arrayOf(new DynamicModel({ n: 0 }));
  app
    .db()
    .newQuery("SELECT COALESCE(MAX(sortOrder), 0) AS n FROM job_lines WHERE job = {:job} AND parentLine = ''")
    .bind({ job: jobId })
    .all(rows);
  return rows[0].n + 10;
}

function positiveWhole(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestError(what + " must be a whole number, 1 or more");
  return n;
}

function optionalNumber(value, what) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new BadRequestError(what + " must be a number");
  return n;
}

function percent(value) {
  const n = optionalNumber(value, "Discount");
  if (n === undefined) return undefined;
  if (n < 0 || n > 100) throw new BadRequestError("Discount must be between 0 and 100%");
  return n;
}

// Adds a kit's components and the item's accessories under a parent line.
// Only one level deep: an accessory's own accessories aren't pulled in.
function expandChildren(app, parentLine, item, qty) {
  const collection = app.findCollectionByNameOrId("job_lines");
  const links = app.findRecordsByFilter("item_components", "parent = {:p}", "-kind,sortOrder,created", 0, 0, { p: item.id });
  let order = 0;
  for (const link of links) {
    const kind = link.getString("kind");
    if (kind === "component" && item.getString("kind") !== "kit") continue;
    const child = findOrNull(app, "items", link.getString("child"));
    if (!child) continue;
    const perParent = link.getInt("quantity");
    const chargeable = kind === "accessory" && link.getBool("chargeable");
    app.save(
      new Record(collection, {
        org: parentLine.getString("org"),
        job: parentLine.getString("job"),
        item: child.id,
        parentLine: parentLine.id,
        lineType: kind,
        quantity: qty * perParent,
        perParent: perParent,
        unitPrice: chargeable ? child.getFloat("dayRate") : 0,
        priceMode: "per_day",
        discountPct: 0,
        group: parentLine.getString("group"),
        sortOrder: (order += 10),
      }),
    );
  }
}

// Sets a line's quantity and keeps its auto-added lines in proportion.
function setQuantity(app, line, qty) {
  line.set("quantity", qty);
  app.save(line);
  for (const child of app.findRecordsByFilter("job_lines", "parentLine = {:id}", "", 0, 0, { id: line.id })) {
    child.set("quantity", qty * child.getInt("perParent"));
    app.save(child);
  }
}

// body: { itemId, quantity, unitPrice?, group? } for inventory, or
// { description, quantity, unitPrice, priceMode?, group? } for a custom line.
// Adding an item that's already on the job tops up its existing line.
function addLine(jobId, body) {
  $app.runInTransaction((tx) => {
    const job = requireJob(tx, jobId);
    const collection = tx.findCollectionByNameOrId("job_lines");
    const unitPrice = optionalNumber(body.unitPrice, "Price");
    const discountPct = percent(body.discountPct);

    if (body.itemId) {
      const item = findOrNull(tx, "items", String(body.itemId));
      if (!item || item.getString("org") !== job.getString("org")) throw new NotFoundError("Item not found");
      if (item.getBool("archived")) throw new BadRequestError(item.getString("name") + " is archived");
      const qty = positiveWhole(body.quantity === undefined ? 1 : body.quantity, "Quantity");

      const existing = tx.findRecordsByFilter(
        "job_lines",
        "job = {:job} && item = {:item} && lineType = 'item'",
        "created",
        1,
        0,
        { job: job.id, item: item.id },
      )[0];
      if (existing) {
        setQuantity(tx, existing, Math.round(existing.getFloat("quantity")) + qty);
        return;
      }

      const line = new Record(collection, {
        org: job.getString("org"),
        job: job.id,
        item: item.id,
        lineType: "item",
        quantity: qty,
        unitPrice: unitPrice === undefined ? item.getFloat("dayRate") : unitPrice,
        priceMode: "per_day",
        discountPct: discountPct || 0,
        group: typeof body.group === "string" ? body.group.trim() : topCategoryName(tx, item.getString("category")),
        sortOrder: nextSortOrder(tx, job.id),
      });
      tx.save(line);
      expandChildren(tx, line, item, qty);
      return;
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) throw new BadRequestError("Pick an item or describe the line");
    const quantity = optionalNumber(body.quantity, "Quantity");
    if (quantity === undefined || quantity <= 0) throw new BadRequestError("Quantity must be more than 0");
    const priceMode = body.priceMode === "per_day" ? "per_day" : "fixed";
    tx.save(
      new Record(collection, {
        org: job.getString("org"),
        job: job.id,
        lineType: "custom",
        description: description,
        quantity: quantity,
        unitPrice: unitPrice || 0,
        priceMode: priceMode,
        discountPct: discountPct || 0,
        group: typeof body.group === "string" ? body.group.trim() : "",
        sortOrder: nextSortOrder(tx, job.id),
      }),
    );
  });
}

// Returns the line's job id so the caller can send back a fresh summary.
function updateLine(lineId, body) {
  let jobId = "";
  $app.runInTransaction((tx) => {
    const line = requireLine(tx, lineId);
    jobId = line.getString("job");
    const lineType = line.getString("lineType");
    const followsParent = LINE_TYPES_FOLLOWING_PARENT.indexOf(lineType) !== -1;

    const unitPrice = optionalNumber(body.unitPrice, "Price");
    if (unitPrice !== undefined) line.set("unitPrice", unitPrice);
    const discountPct = percent(body.discountPct);
    if (discountPct !== undefined) line.set("discountPct", discountPct);
    if (typeof body.description === "string") {
      if (lineType === "custom" && !body.description.trim()) throw new BadRequestError("A custom line needs a description");
      line.set("description", body.description.trim());
    }
    if (typeof body.notes === "string") line.set("notes", body.notes);
    if (body.priceMode !== undefined) {
      if (lineType !== "custom") throw new BadRequestError("Only custom lines can change how they're priced");
      if (body.priceMode !== "fixed" && body.priceMode !== "per_day") throw new BadRequestError("Invalid price mode");
      line.set("priceMode", body.priceMode);
    }
    const sortOrder = optionalNumber(body.sortOrder, "Sort order");
    if (sortOrder !== undefined) line.set("sortOrder", Math.round(sortOrder));

    if (typeof body.group === "string" && !followsParent) {
      line.set("group", body.group.trim());
      for (const child of tx.findRecordsByFilter("job_lines", "parentLine = {:id}", "", 0, 0, { id: line.id })) {
        child.set("group", body.group.trim());
        tx.save(child);
      }
    }

    if (body.quantity !== undefined) {
      if (followsParent) throw new BadRequestError("This line's quantity follows the line it was added with");
      let qty;
      if (lineType === "custom") {
        qty = optionalNumber(body.quantity, "Quantity");
        if (qty === undefined || qty <= 0) throw new BadRequestError("Quantity must be more than 0");
      } else {
        qty = positiveWhole(body.quantity, "Quantity");
      }
      setQuantity(tx, line, qty);
      return;
    }
    tx.save(line);
  });
  return jobId;
}

function deleteLine(lineId) {
  const line = requireLine($app, lineId);
  const jobId = line.getString("job");
  // The line's auto-added children go with it (cascadeDelete on parentLine).
  $app.delete(line);
  return jobId;
}

// Freezes the job as it stands into quote version N+1. The snapshot holds
// everything the quote page prints, so changing the job, an item's name or
// the business address later never alters an issued quote.
function issueQuote(jobId, authRecord) {
  const { publicSettings } = require(`${__hooks}/lib/settings.js`);
  const summary = buildSummary($app, jobId, true);
  if (summary.lines.length === 0) throw new BadRequestError("Add something to the job before quoting it");
  const org = requireJob($app, jobId).getString("org");
  const settings = publicSettings(org);

  const rows = arrayOf(new DynamicModel({ n: 0 }));
  $app.db().newQuery("SELECT COALESCE(MAX(version), 0) AS n FROM quotes WHERE job = {:job}").bind({ job: jobId }).all(rows);
  const version = rows[0].n + 1;

  const now = new Date();
  const validDays = Number(settings.quoteValidityDays) || 0;
  const validUntil = validDays > 0 ? new Date(now.getTime() + validDays * 86400000).toISOString() : "";

  const snapshot = {
    business: {
      name: settings.businessName,
      address: settings.businessAddress,
      phone: settings.businessPhone,
      email: settings.businessEmail,
      gstNumber: settings.gstNumber,
    },
    job: {
      number: summary.job.number,
      name: summary.job.name,
      reference: summary.job.reference,
      prepAt: summary.job.prepAt,
      showStart: summary.job.showStart,
      showEnd: summary.job.showEnd,
      returnAt: summary.job.returnAt,
      quoteNotes: summary.job.quoteNotes,
    },
    client: summary.job.clientInfo,
    venue: summary.job.venueInfo,
    lines: summary.lines.map((l) => ({
      id: l.id,
      parentLine: l.parentLine,
      lineType: l.lineType,
      name: l.name,
      code: l.item ? l.item.code : "",
      description: l.lineType === "custom" ? "" : l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      priceMode: l.priceMode,
      discountPct: l.discountPct,
      group: l.group,
      amount: l.amount,
    })),
    pricing: summary.pricing,
    terms: settings.quoteTerms,
    issuedAt: now.toISOString(),
    validUntil: validUntil,
  };

  const collection = $app.findCollectionByNameOrId("quotes");
  const quote = new Record(collection, {
    org: org,
    job: jobId,
    version: version,
    status: "issued",
    snapshot: snapshot,
    exGst: summary.pricing.totals.exGst,
    gst: summary.pricing.totals.gst,
    total: summary.pricing.totals.total,
    issuedAt: now.toISOString(),
    validUntil: validUntil,
    issuedBy: authRecord ? authRecord.id : "",
  });
  $app.save(quote);
  return quote;
}

// Setting a price or discount on a line needs permission to see prices.
function checkPriceFields(ctx, body) {
  const touchesMoney = ["unitPrice", "discountPct", "priceMode"].some((k) => body && body[k] !== undefined);
  if (touchesMoney && !ctx.can("prices.view")) throw new ForbiddenError("Your role doesn't allow changing prices");
}

module.exports = {
  checkPriceFields, requireJob, buildSummary, addLine, updateLine, deleteLine, issueQuote, packingState, loadLines, loadItems };
