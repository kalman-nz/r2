// Getting a customer's existing data into R2, the biggest switching cost:
// - runRentmanStep: pulls equipment, serials, folders, stock locations,
//   custom field names, contacts, locations and projects with their lines
//   from their own Rentman account with their own API token, a step at a
//   time. Re-running it updates whatever it created before (matched on
//   rentmanId) and never deletes anything in R2. It does overwrite
//   imported fields edited in R2 since, so it's for the migration period.
//   Contact and project field names were checked against a live account
//   in October 2026.
// - importCsv: items or contacts from a spreadsheet, all-or-nothing, with a
//   dry run that reports every problem row first.
// Every import is recorded in import_runs.
const { idFromRef } = require("./rentman.js");
const { errorMessage } = require("./records.js");

const MAX_ERRORS = 500;

function startRun(org, source, who) {
  const run = new Record($app.findCollectionByNameOrId("import_runs"), {
    org: org,
    source: source,
    status: "running",
    who: who,
    counts: {},
    errors: [],
  });
  $app.save(run);
  return run;
}

function finishRun(run, status, counts, errors, message) {
  run.set("status", status);
  run.set("counts", counts);
  run.set("errors", errors.slice(0, MAX_ERRORS));
  run.set("message", message || "");
  run.set("finishedAt", new Date().toISOString());
  $app.save(run);
}

// rentmanId -> R2 record id for everything this organisation previously
// imported into a collection, so the import doesn't query per row.
function importedIds(collection, org) {
  const rows = arrayOf(new DynamicModel({ id: "", rentmanId: "" }));
  $app
    .db()
    .newQuery("SELECT id, rentmanId FROM " + collection + " WHERE rentmanId != '' AND org = {:org}")
    .bind({ org: org })
    .all(rows);
  const map = {};
  for (const r of rows) map[r.rentmanId] = r.id;
  return map;
}

function upsert(org, collection, ids, rentmanId, data) {
  let record = null;
  if (ids[rentmanId]) {
    try {
      record = $app.findRecordById(collection, ids[rentmanId]);
    } catch (_) {
      record = null;
    }
  }
  if (!record) record = new Record($app.findCollectionByNameOrId(collection), { org: org });
  for (const key of Object.keys(data)) record.set(key, data[key]);
  record.set("rentmanId", rentmanId);
  $app.save(record);
  ids[rentmanId] = record.id;
  return record;
}

// Rentman references are usually "/folders/12"; accept a bare id too.
function refId(value) {
  if (typeof value === "number") return String(value);
  return idFromRef(value);
}

// Equipment, serial numbers, folders (as categories), stock locations and
// custom field names.
function importEquipment(client, org, counts, fail) {
  for (const key of ["categories", "locations", "customFields", "items", "serials"]) counts[key] = counts[key] || 0;
  // Fetch everything before writing anything, so a Rentman outage or a
  // bad token leaves R2 untouched.
  const folders = client.listAllFolders();
  const stockLocations = client.listAllStockLocations();
  const extraFields = client.listAllExtraInputFields();
  const equipment = client.listAllEquipment();
  const serialNumbers = client.listAllSerialNumbers();

  // Only the folders equipment actually sits in (and their parents), so
  // contact/project folders don't turn into inventory categories.
  const folderById = {};
  for (const f of folders) folderById[String(f.id)] = f;
  const wanted = {};
  for (const eq of equipment) {
    let id = refId(eq.folder);
    for (let depth = 0; id && folderById[id] && !wanted[id] && depth < 50; depth++) {
      wanted[id] = true;
      id = refId(folderById[id].parent);
    }
  }
  const categoryIds = importedIds("categories", org);
  for (const id of Object.keys(wanted)) {
    const f = folderById[id];
    try {
      upsert(org, "categories", categoryIds, id, { name: f.name || f.displayname || "Folder " + id });
      counts.categories++;
    } catch (err) {
      fail("folder", id, f.name, err);
    }
  }
  // Second pass once every category exists: hang each under its parent.
  for (const id of Object.keys(wanted)) {
    const parentId = refId(folderById[id].parent);
    if (!categoryIds[id] || !parentId || !categoryIds[parentId]) continue;
    try {
      const record = $app.findRecordById("categories", categoryIds[id]);
      record.set("parent", categoryIds[parentId]);
      $app.save(record);
    } catch (err) {
      fail("folder", id, folderById[id].name, err);
    }
  }

  const locationIds = importedIds("locations", org);
  for (const l of stockLocations) {
    try {
      upsert(org, "locations", locationIds, String(l.id), { name: l.displayname || l.name || "Location " + l.id });
      counts.locations++;
    } catch (err) {
      fail("stocklocation", l.id, l.displayname, err);
    }
  }

  // Rentman's itemtype "Materiaal" is equipment, "Exemplaar" a serialised
  // unit; fields on anything else (projects, contacts...) aren't used.
  const appliesTo = { Materiaal: "item", Exemplaar: "serial" };
  const fieldsCollection = $app.findCollectionByNameOrId("custom_fields");
  for (const f of extraFields) {
    if (!appliesTo[f.itemtype]) continue;
    const key = "custom_" + f.id;
    try {
      let record = $app.findRecordsByFilter("custom_fields", "org = {:org} && key = {:key}", "", 1, 0, { org: org, key: key })[0];
      if (!record) record = new Record(fieldsCollection, { org: org, key: key });
      record.set("label", f.displayname || f.name || key);
      record.set("appliesTo", appliesTo[f.itemtype]);
      record.set("source", "rentman");
      $app.save(record);
      counts.customFields++;
    } catch (err) {
      fail("extrainputfield", f.id, f.displayname, err);
    }
  }

  const serialCount = {};
  for (const s of serialNumbers) {
    const eqId = refId(s.equipment);
    if (eqId) serialCount[eqId] = (serialCount[eqId] || 0) + 1;
  }
  // Rentman's bulk equipment list leaves current_quantity empty; summing
  // stock movements gives the real count (only fetched if needed).
  let movementQty = null;
  const bulkQuantity = (eq) => {
    if (typeof eq.current_quantity === "number") return eq.current_quantity;
    if (!movementQty) {
      movementQty = {};
      for (const m of client.listAllStockMovements()) {
        const eqId = refId(m.equipment);
        if (eqId && typeof m.amount === "number") movementQty[eqId] = (movementQty[eqId] || 0) + m.amount;
      }
    }
    return movementQty[String(eq.id)] || 0;
  };

  const itemIds = importedIds("items", org);
  for (const eq of equipment) {
    const id = String(eq.id);
    const name = eq.displayname || eq.name || "Rentman item " + id;
    const serialised = (serialCount[id] || 0) > 0;
    try {
      upsert(org, "items", itemIds, id, {
        name: name,
        code: eq.code || "",
        category: categoryIds[refId(eq.folder)] || "",
        kind: "item",
        tracking: serialised ? "serial" : "bulk",
        stockQty: serialised ? 0 : Math.max(0, Math.round(bulkQuantity(eq))),
        price: Number(eq.price) || 0,
        weightKg: Number(eq.weight) || 0,
        powerW: Number(eq.power) || 0,
        barcode: eq.qrcodes || "",
        locationInWarehouse: eq.location_in_warehouse || "",
        description: eq.external_remark || "",
        notes: eq.internal_remark || "",
        archived: eq.in_archive === true,
        custom: eq.custom || {},
      });
      counts.items++;
    } catch (err) {
      fail("equipment", id, name, err);
    }
  }

  const serialIds = importedIds("serials", org);
  for (const s of serialNumbers) {
    const id = String(s.id);
    const itemId = itemIds[refId(s.equipment)];
    if (!itemId) {
      fail("serialnumber", id, s.displayname, "its equipment wasn't imported");
      continue;
    }
    try {
      upsert(org, "serials", serialIds, id, {
        item: itemId,
        barcode: s.qrcodes || s.ref || "",
        serialNumber: s.serial || "",
        label: s.displayname || "",
        status: s.active === false ? "retired" : "active",
        location: locationIds[refId(s.asset_location)] || "",
        purchaseDate: s.purchasedate || "",
        purchaseCost: Number(s.purchase_costs) || 0,
        nextInspection: s.next_inspection || "",
        notes: s.remark || "",
        custom: s.custom || {},
      });
      counts.serials++;
    } catch (err) {
      fail("serialnumber", id, s.displayname, err);
    }
  }
}

// One address block from a Rentman contact's prefix_ fields ("invoice",
// "mailing", "visit"); "" when that one's empty.
function addressOf(c, prefix) {
  const get = (field) => String(c[prefix + "_" + field] || "").trim();
  const street = [get("street"), get("number"), get("unit_number")].filter(Boolean).join(" ");
  const town = [get("postalcode"), get("city")].filter(Boolean).join(" ");
  // Visit addresses keep their country in plain `country`.
  const country = prefix === "visit" ? String(c.country || "").trim() : get("country");
  if (!street && !town) return "";
  return [street, get("extra_address_line"), get("district"), town, get("state"), country].filter(Boolean).join("\n");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rentman keeps clients and the places jobs happen in one contacts list.
// Contacts that projects use as their location become R2 locations
// (venues); every other contact, and any location that's also a client,
// becomes an R2 contact.
function importContacts(client, org, counts, fail) {
  counts.contacts = counts.contacts || 0;
  counts.venues = counts.venues || 0;
  const contacts = client.listAll("contacts");
  const people = client.listAll("contactpersons");
  const projects = client.listAll("projects", "id,customer,location");
  const subprojects = client.listAll("subprojects", "id,location");

  // Each contact's first contact person, for the name and a phone to fall back on.
  const personOf = {};
  for (const p of people) {
    const id = refId(p.contact);
    if (id && !personOf[id]) personOf[id] = p;
  }
  const asLocation = {};
  const asCustomer = {};
  for (const p of projects) {
    if (refId(p.location)) asLocation[refId(p.location)] = true;
    if (refId(p.customer)) asCustomer[refId(p.customer)] = true;
  }
  for (const s of subprojects) if (refId(s.location)) asLocation[refId(s.location)] = true;

  const contactIds = importedIds("contacts", org);
  const venueIds = importedIds("venues", org);
  for (const c of contacts) {
    const id = String(c.id);
    const name = String(c.displayname || c.name || "").trim() || "Rentman contact " + id;
    const person = personOf[id];
    const personName = person ? String(person.displayname || [person.firstname, person.lastname].filter(Boolean).join(" ")).trim() : "";
    const phone = String(c.phone_1 || c.phone_2 || (person && (person.phone || person.mobilephone)) || "").trim();
    if (asLocation[id]) {
      try {
        upsert(org, "venues", venueIds, id, {
          name: name,
          address: addressOf(c, "visit") || addressOf(c, "mailing") || addressOf(c, "invoice"),
          contactName: personName,
          phone: phone,
        });
        counts.venues++;
      } catch (err) {
        fail("contact (location)", id, name, err);
      }
    }
    if (asLocation[id] && !asCustomer[id]) continue;
    const emails = [c.email_1, c.email_2, person && person.email].map((e) => String(e || "").trim());
    try {
      upsert(org, "contacts", contactIds, id, {
        name: name,
        kind: c.type === "private" ? "person" : "company",
        contactPerson: personName === name ? "" : personName,
        email: emails.find((e) => EMAIL.test(e)) || "",
        phone: phone,
        billingAddress: addressOf(c, "invoice") || addressOf(c, "mailing") || addressOf(c, "visit"),
        notes: String(c.contact_warning || "").trim(),
      });
      counts.contacts++;
    } catch (err) {
      fail("contact", id, name, err);
    }
  }
}

// Rentman's project statuses (they live on subprojects) → R2's. Matched on
// the status name, since an account can rename and add its own; anything
// unknown becomes an enquiry, which holds no stock.
function jobStatusFor(name) {
  const n = String(name || "").toLowerCase();
  if (n.indexOf("cancel") !== -1) return "cancelled";
  if (n.indexOf("return") !== -1) return "returned";
  if (n.indexOf("location") !== -1 || n.indexOf("loaded") !== -1 || n === "out") return "out";
  if (n.indexOf("confirm") !== -1 || n.indexOf("prepped") !== -1) return "confirmed";
  if (n.indexOf("pending") !== -1 || n.indexOf("option") !== -1 || n.indexOf("reserv") !== -1) return "provisional";
  return "enquiry";
}

// Projects (with their subprojects folded in) → R2 projects. Kit is booked
// over Rentman's plan period and charged over its usage period. Rentman's
// project numbers are kept where R2 hasn't already used them. Needs the
// contacts step first for clients and locations.
function importProjects(client, org, counts, fail) {
  counts.projects = counts.projects || 0;
  const { toMs } = require("./time.js");
  const projects = client.listAll("projects");
  const subprojects = client.listAll("subprojects");
  const statusName = {};
  for (const st of client.listAll("statuses")) statusName[String(st.id)] = st.name || st.displayname;

  const subsOf = {};
  for (const sp of subprojects) {
    const pid = refId(sp.project);
    if (!pid) continue;
    (subsOf[pid] = subsOf[pid] || []).push(sp);
  }
  for (const pid of Object.keys(subsOf)) subsOf[pid].sort((a, b) => (a.order || 0) - (b.order || 0));

  const jobIds = importedIds("jobs", org);
  const contactIds = importedIds("contacts", org);
  const venueIds = importedIds("venues", org);
  const taken = {};
  const numbers = arrayOf(new DynamicModel({ number: 0, rentmanId: "" }));
  $app.db().newQuery("SELECT number, rentmanId FROM jobs WHERE org = {:org}").bind({ org: org }).all(numbers);
  for (const n of numbers) taken[n.number] = n.rentmanId;

  for (const p of projects) {
    const id = String(p.id);
    const name = String(p.displayname || p.name || "").trim() || "Rentman project " + id;
    const main = (subsOf[id] || [])[0];
    let prep = p.planperiod_start || p.usageperiod_start;
    let ret = p.planperiod_end || p.usageperiod_end;
    const billStart = p.usageperiod_start || prep;
    const billEnd = p.usageperiod_end || ret;
    if (!(toMs(prep) < toMs(ret))) {
      fail("project", id, name, new Error("No dates in Rentman"));
      continue;
    }
    const data = {
      name: name,
      status: jobStatusFor(main ? statusName[refId(main.status)] : ""),
      client: contactIds[refId(p.customer)] || "",
      venue: venueIds[refId(p.location) || (main && refId(main.location))] || "",
      reference: String(p.reference || "").trim(),
    };
    const number = Number(p.number);
    if (number > 0 && (taken[number] === undefined || taken[number] === id)) data.number = number;
    try {
      if (jobIds[id]) {
        upsert(org, "jobs", jobIds, id, data);
        updatePeriods(jobIds[id], prep, ret, billStart, billEnd);
      } else {
        // New: the dates seed its schedule (records_periods.pb.js).
        const billed = toMs(billStart) < toMs(billEnd);
        upsert(org, "jobs", jobIds, id, Object.assign(data, {
          prepAt: prep,
          returnAt: ret,
          billingStart: billed ? billStart : "",
          billingEnd: billed ? billEnd : "",
        }));
      }
      if (data.number) taken[data.number] = id;
      counts.projects++;
    } catch (err) {
      fail("project", id, name, err);
    }
  }
}

// A line's discount as R2 holds it: Rentman's line discount, then its
// subproject's rental discount and overall discount (how fixed-price
// subprojects reach their price), all fractions in Rentman. A negative
// overall discount (a markup) can't be carried over.
function lineDiscount(line, sub) {
  let keep = 1 - (Number(line.discount) || 0);
  if (sub) keep *= (1 - (Number(sub.discount_rental) || 0)) * (1 - Math.max(0, Number(sub.discount_subproject) || 0));
  return Math.min(100, Math.max(0, Math.round((1 - keep) * 10000) / 100));
}

// A re-imported project's dates: moved on its usage and billing periods,
// which the job's own dates follow. Only while it still has just the one of
// each the import gave it; a schedule reworked in R2 is left alone.
function updatePeriods(jobId, prep, ret, billStart, billEnd) {
  const periods = $app.findRecordsByFilter("job_periods", "job = {:job}", "", 0, 0, { job: jobId });
  const usage = periods.filter((p) => p.getString("kind") === "usage");
  const billing = periods.filter((p) => p.getString("kind") === "billing");
  if (usage.length !== 1 || billing.length !== 1) return;
  usage[0].set("start", prep);
  usage[0].set("end", ret);
  $app.save(usage[0]);
  billing[0].set("start", billStart);
  billing[0].set("end", billEnd);
  $app.save(billing[0]);
}

// One page of project equipment (Rentman's lines) → project lines. `cursor`
// is the page to fetch (Rentman's next_page_url, null for the first);
// returns the next one, or null at the end. A page at a time so each
// request stays short. Lines are priced as Rentman priced them: unit price
// × Rentman's day factor, as a fixed price, less the line's and its
// subproject's discounts, so totals match. Equipment R2
// doesn't have (or text-only lines) come in as custom lines.
function importLinesPage(client, org, counts, fail, cursor) {
  counts.lines = counts.lines || 0;
  const page = client.page("projectequipment", cursor);
  const groups = {};
  for (const g of client.listAll("projectequipmentgroup", "id,project,subproject,name,order")) groups[String(g.id)] = g;
  const subs = {};
  for (const sp of client.listAll("subprojects", "id,discount_rental,discount_subproject")) subs[String(sp.id)] = sp;
  const jobIds = importedIds("jobs", org);
  const itemIds = importedIds("items", org);
  const lineIds = importedIds("job_lines", org);
  const priceUnit = {};

  for (const l of page.data) {
    const id = String(l.id);
    const group = groups[refId(l.equipment_group)];
    const jobId = group && jobIds[refId(group.project)];
    if (!jobId) continue; // a project that wasn't imported
    const itemId = itemIds[refId(l.equipment)] || "";
    const name = String(l.name || l.displayname || "").trim() || "Rentman line " + id;
    const quantity = Math.max(0, Number(l.quantity) || 0);
    // Rentman keeps lines at 0 as placeholders, and options aren't charged
    // or booked until they're taken up.
    if (quantity === 0 || l.is_option) continue;
    const parentId = lineIds[refId(l.parent)] || "";
    // 0 for contents priced into their parent line: they're free.
    const factor = typeof l.factor === "number" ? l.factor : 1;
    const data = {
      job: jobId,
      item: itemId,
      lineType: itemId ? (parentId ? "accessory" : "item") : "custom",
      parentLine: itemId ? parentId : "",
      description: itemId ? String(l.external_remark || "").trim() : name,
      quantity: itemId ? Math.round(quantity) : quantity,
      unitPrice: Math.round((Number(l.unit_price) || 0) * factor * 100) / 100,
      priceMode: "fixed",
      discountPct: lineDiscount(l, subs[refId(group.subproject)]),
      group: String(group.name || "").trim(),
      sortOrder: (Number(group.order) || 0) * 1000 + (Number(l.order) || 0),
      notes: String(l.internal_remark || "").trim(),
    };
    if (parentId) {
      try {
        const parent = $app.findRecordById("job_lines", parentId);
        const parentQty = parent.getFloat("quantity");
        data.perParent = parentQty > 0 && quantity % parentQty === 0 ? quantity / parentQty : 0;
      } catch (_) {
        data.perParent = 0;
      }
    }
    try {
      upsert(org, "job_lines", lineIds, id, data);
      counts.lines++;
    } catch (err) {
      fail("projectequipment", id, name, err);
    }
  }
  return page.next;
}

const RENTMAN_STEPS = { equipment: importEquipment, contacts: importContacts, projects: importProjects };

// One step of a Rentman import, so a big account never needs one long
// request. The browser runs them in order with the same runId:
//   equipment   everything importEquipment does
//   contacts    clients and locations
//   projects    projects (after contacts)
//   lines       one page of project lines (after projects); repeat with
//               the returned `next` until it's null
// body: { step, runId?, cursor?, final? }. The run is finished on the call
// with final: true (for lines, once there's no next page).
function runRentmanStep(org, token, who, body) {
  const { createRentmanClient } = require("./rentman.js");
  const { decodeJson } = require("./records.js");
  if (!token) throw new BadRequestError("No Rentman API token — add one in Settings > Import");
  const step = String(body.step || "equipment");
  if (!RENTMAN_STEPS[step] && step !== "lines") throw new BadRequestError("Unknown import step");
  const client = createRentmanClient(token);

  let run;
  if (body.runId) {
    try {
      run = $app.findRecordById("import_runs", String(body.runId));
    } catch (_) {
      run = null;
    }
    if (!run || run.getString("org") !== org || run.getString("source") !== "rentman" || run.getString("status") !== "running") {
      throw new BadRequestError("That import isn't running any more: start it again");
    }
  } else {
    run = startRun(org, "rentman", who);
  }
  const counts = decodeJson(run.get("counts"), {});
  const errors = decodeJson(run.get("errors"), []);
  const fail = (resource, rentmanId, name, err) => {
    if (errors.length < MAX_ERRORS) errors.push({ resource: resource, rentmanId: String(rentmanId), name: name || "", message: errorMessage(err) });
  };

  let next = null;
  try {
    if (step === "lines") next = importLinesPage(client, org, counts, fail, body.cursor || null);
    else RENTMAN_STEPS[step](client, org, counts, fail);
  } catch (err) {
    finishRun(run, "failed", counts, errors, errorMessage(err));
    throw new BadRequestError("Rentman import failed: " + errorMessage(err));
  }
  if (body.final && !next) {
    finishRun(run, "ok", counts, errors, "");
  } else {
    run.set("counts", counts);
    run.set("errors", errors.slice(0, MAX_ERRORS));
    $app.save(run);
  }
  return { runId: run.id, counts: counts, errors: errors, next: next };
}

// "$1,200.50" → 1200.5; blank → undefined (leave the default).
function csvNumber(value, what) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(what + " isn't a number: " + value);
  return n;
}

// "Audio/Speakers" or "Audio > Speakers": finds or creates each level.
function categoryForPath(app, org, path, cache) {
  const parts = String(path || "")
    .split(/\s*(?:\/|>)\s*/)
    .map((p) => p.trim())
    .filter((p) => p);
  let parentId = "";
  let key = "";
  for (const name of parts) {
    key += "/" + name.toLowerCase();
    if (!cache[key]) {
      // Not "parent = {:parent}" with an empty parent: PocketBase binds an
      // empty string placeholder as the literal '""', which never matches.
      const siblings = parentId
        ? app.findRecordsByFilter("categories", "org = {:org} && parent = {:parent}", "", 0, 0, { org: org, parent: parentId })
        : app.findRecordsByFilter("categories", "org = {:org} && parent = ''", "", 0, 0, { org: org });
      const existing = siblings.find((c) => c.getString("name").toLowerCase() === name.toLowerCase());
      if (existing) {
        cache[key] = existing.id;
      } else {
        const record = new Record(app.findCollectionByNameOrId("categories"), { org: org, name: name, parent: parentId });
        app.save(record);
        cache[key] = record.id;
      }
    }
    parentId = cache[key];
  }
  return parentId;
}

// "per hour", "hr", "/day", "weekly", "ea", "each"… → hour | day | week |
// each. Blank is day, like every item before prices had a unit.
function csvPriceUnit(value) {
  const v = String(value || "").trim().toLowerCase().replace(/^(per\s*|\/)/, "");
  if (!v) return "day";
  if (/^(h|hr|hrs|hour|hours|hourly)$/.test(v)) return "hour";
  if (/^(d|day|days|daily)$/.test(v)) return "day";
  if (/^(w|wk|wks|week|weeks|weekly)$/.test(v)) return "week";
  if (/^(ea|each|unit|sale|sold|item)$/.test(v)) return "each";
  throw new Error("price unit should be hour, day, week or each, not " + value);
}

function importItemRow(app, org, row, counts, cache) {
  const name = String(row.name || "").trim();
  if (!name) throw new Error("name is required");
  const code = String(row.code || "").trim();
  if (code && app.findRecordsByFilter("items", "org = {:org} && code = {:code}", "", 1, 0, { org: org, code: code }).length > 0) {
    throw new Error("an item with code " + code + " already exists");
  }
  const barcodes = String(row.serials || "")
    .split(/[;|\n]/)
    .map((b) => b.trim())
    .filter((b) => b);
  const serialised = barcodes.length > 0;
  const item = new Record(app.findCollectionByNameOrId("items"), {
    org: org,
    name: name,
    code: code,
    category: categoryForPath(app, org, row.category, cache),
    kind: "item",
    tracking: serialised ? "serial" : "bulk",
    stockQty: serialised ? 0 : Math.max(0, Math.round(csvNumber(row.quantity, "quantity") || 0)),
    price: csvNumber(row.price, "price") || 0,
    priceUnit: csvPriceUnit(row.priceUnit),
    replacementValue: csvNumber(row.replacementValue, "replacement value") || 0,
    weightKg: csvNumber(row.weightKg, "weight") || 0,
    powerW: csvNumber(row.powerW, "power") || 0,
    barcode: String(row.barcode || "").trim(),
    locationInWarehouse: String(row.locationInWarehouse || "").trim(),
    description: String(row.description || "").trim(),
    notes: String(row.notes || "").trim(),
  });
  app.save(item);
  counts.items++;
  const serials = app.findCollectionByNameOrId("serials");
  for (const barcode of barcodes) {
    app.save(new Record(serials, { org: org, item: item.id, barcode: barcode, status: "active" }));
    counts.serials++;
  }
}

function importContactRow(app, org, row, counts) {
  const name = String(row.name || "").trim();
  if (!name) throw new Error("name is required");
  const email = String(row.email || "").trim();
  if (
    email &&
    app.findRecordsByFilter("contacts", "org = {:org} && name = {:name} && email = {:email}", "", 1, 0, { org: org, name: name, email: email })
      .length > 0
  ) {
    throw new Error(name + " <" + email + "> already exists");
  }
  const kind = String(row.kind || "").trim().toLowerCase();
  app.save(
    new Record(app.findCollectionByNameOrId("contacts"), {
      org: org,
      name: name,
      kind: kind === "person" ? "person" : "company",
      contactPerson: String(row.contactPerson || "").trim(),
      email: email,
      phone: String(row.phone || "").trim(),
      billingAddress: String(row.billingAddress || "").trim(),
      notes: String(row.notes || "").trim(),
    }),
  );
  counts.contacts++;
}

// rows: objects keyed by R2 field names (the browser maps the spreadsheet's
// columns). Runs in one transaction: with dryRun, or if any row fails,
// nothing is kept and every problem row is reported (row numbers count the
// header as row 1, to match the spreadsheet).
function importCsv(org, kind, rows, dryRun, who) {
  if (kind !== "items" && kind !== "contacts") throw new BadRequestError("kind must be items or contacts");
  if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestError("No rows to import");
  if (rows.length > 10000) throw new BadRequestError("Split files over 10,000 rows into smaller imports");

  const counts = kind === "items" ? { items: 0, serials: 0 } : { contacts: 0 };
  const errors = [];
  let rollingBack = false;
  try {
    $app.runInTransaction((tx) => {
      const cache = {};
      rows.forEach((row, i) => {
        try {
          if (kind === "items") importItemRow(tx, org, row || {}, counts, cache);
          else importContactRow(tx, org, row || {}, counts);
        } catch (err) {
          if (errors.length < MAX_ERRORS) errors.push({ row: i + 2, message: errorMessage(err) });
        }
      });
      if (dryRun || errors.length > 0) {
        rollingBack = true;
        throw new Error("rollback");
      }
    });
  } catch (err) {
    if (!rollingBack) throw err;
  }

  const committed = !rollingBack;
  if (committed) {
    const run = startRun(org, "csv", who);
    finishRun(run, "ok", Object.assign({ kind: kind }, counts), [], "");
  }
  return { dryRun: dryRun === true, committed: committed, counts: counts, errors: errors };
}

module.exports = { runRentmanStep, importCsv };
