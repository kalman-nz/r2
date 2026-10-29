// Live sync with Momentus Enterprise (formerly Ungerboeck), for venues
// that take bookings in Momentus and run their AV out of R2. On the engine
// in lib/sync.js, through the client in lib/momentus.js (whose API details
// are unconfirmed: see there).
//
// Coming in, every pollMinutes (Momentus has no webhooks R2 can rely on):
// - events in the window (pastDays back, windowMonths ahead) → R2 projects,
//   with the event's account as the client and its first room as the
//   location. Show times are the event's; kit goes out prepHours before
//   and comes back returnHours after. Momentus statuses are the venue's
//   own codes, so they map through statusMap (Settings → Integrations
//   lists every status it has seen), then by name.
// - the event's orders for the AV department(s) → project lines, matched
//   to R2 items by resource code; anything unmatched is a custom line.
//   Orders R2 sent itself are skipped.
// Going out:
// - an issued quote → an order on the event (the same order each time it's
//   re-quoted, its items replaced), priced so its total matches the quote.
// - items → Momentus resources, so sales staff can sell the kit. If the
//   instance won't allow it (licensing), Settings offers a spreadsheet of
//   them in the shape Momentus imports instead.
// Projects pulled from Momentus follow it: R2 edits to their name, client,
// location and dates last until that field changes in Momentus.

const sync = require("./sync.js");
const { pick } = require("./momentus.js");

const DEFAULTS = {
  enabled: false,
  paused: false,
  baseUrl: "",
  orgCode: "",
  apiUserId: "",
  pollMinutes: 15,
  pastDays: 7,
  windowMonths: 12,
  // Event status codes to bring in; empty brings every status.
  eventStatuses: [],
  // Only events with an order for one of `departments`.
  onlyWithOrders: false,
  // The AV department code(s) whose orders become project lines.
  departments: [],
  prepHours: 2,
  returnHours: 2,
  // Momentus status code → R2 project status.
  statusMap: {},
  pullEvents: true,
  pullOrders: true,
  pushQuotes: false,
  // The order R2 creates for a quote.
  orderDepartment: "",
  orderType: "",
  // For quote lines with no matching resource (custom lines, items not in Momentus).
  miscResource: "",
  pushInventory: false,
  // Category ids to send; empty sends every active item.
  inventoryCategories: [],
  conflictRule: "remote",
  // Path overrides for lib/momentus.js ENDPOINTS, once checked against the instance.
  endpoints: {},
};

const FIELDS = require("./momentus.js").FIELDS;

function clientFor(org, cfg) {
  const { getSecret } = require("./settings.js");
  const { createMomentusClient } = require("./momentus.js");
  return createMomentusClient(org, cfg, getSecret(org, "momentusApiSecret"));
}

// ------------------------------------------------------------ pure parts

// A Momentus status → an R2 project status: the venue's own mapping first,
// then by the status's name, then enquiry (which holds no stock).
function statusFor(code, name, statusMap) {
  const mapped = (statusMap || {})[String(code)];
  if (mapped) return mapped;
  const n = String(name || code || "").toLowerCase();
  if (/cancel|lost|declin|turned down/.test(n)) return "cancelled";
  if (/definite|confirm|contract|booked/.test(n)) return "confirmed";
  if (/tentative|hold|option|pencil|provisional/.test(n)) return "provisional";
  return "enquiry";
}

// "2026-11-02T00:00:00" + "1900-01-01T18:30:00" → [2026, 11, 2, 18, 30].
// Momentus keeps the day and the time of day in separate fields; a date
// with its own time and no time field is used as it is.
function wallTime(date, time) {
  const d = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(date || ""));
  if (!d) return null;
  const t = /(?:^|[T ])(\d{1,2}):(\d{2})/.exec(String(time || ""));
  const hour = t ? Number(t[1]) : d[4] ? Number(d[4]) : 0;
  const minute = t ? Number(t[2]) : d[5] ? Number(d[5]) : 0;
  return [Number(d[1]), Number(d[2]), Number(d[3]), hour, minute];
}

// A quote's lines → Momentus order items. Every line with a price, at a
// unit price that makes its amount (days and discounts included) come out
// the same. resourceFor(line) → a resource code or "".
function orderItemsFor(snapshotLines, resourceFor, miscResource) {
  const out = [];
  const missing = [];
  for (const l of snapshotLines || []) {
    const quantity = Number(l.quantity) || 0;
    const amount = Number(l.amount) || 0;
    if (quantity <= 0 || (amount === 0 && l.parentLine)) continue;
    const resource = resourceFor(l) || miscResource || "";
    if (!resource) {
      missing.push(l.name);
      continue;
    }
    out.push({
      resource: resource,
      quantity: quantity,
      price: Math.round((amount / quantity) * 100) / 100,
      note: [l.name, l.description].filter(Boolean).join(": ").slice(0, 250),
    });
  }
  return { items: out, missing: missing };
}

// ---------------------------------------------------------- time zones

function zoneOf(org) {
  const { publicSettings } = require("./settings.js");
  try {
    return new Timezone(publicSettings(org).timezone || "UTC");
  } catch (_) {
    return new Timezone("UTC");
  }
}

// A venue's local wall time → ms (same approach as lib/maintenance.js).
function localMs(org, parts) {
  const { toPbDate } = require("./time.js");
  if (!parts) return NaN;
  const base = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  try {
    const zone = zoneOf(org);
    const offset = (ms) => {
      const z = new DateTime(toPbDate(ms)).time().in(zone).format("-0700");
      return (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60000;
    };
    return base - offset(base - offset(base));
  } catch (_) {
    return base;
  }
}

// ------------------------------------------------------------------ poll

function pollDue(cfg, state, now) {
  return now - (state.lastPollAt || 0) >= Math.max(5, Number(cfg.pollMinutes) || 15) * 60000;
}

function poll(org, cfg, state, run) {
  const { toPbDate } = require("./time.js");
  if (!cfg.pullEvents) return {};
  const client = clientFor(org, cfg);
  const now = Date.now();
  const from = new Date(now - (Number(cfg.pastDays) || 0) * 86400000).toISOString().slice(0, 19);
  const to = new Date(now + (Number(cfg.windowMonths) || 12) * 31 * 86400000).toISOString().slice(0, 19);
  const statuses = (cfg.eventStatuses || []).map(String);
  const departments = (cfg.departments || []).map((d) => String(d).toLowerCase());
  const seen = Object.assign({}, state.seenStatuses || {});
  const pushedOrders = pushedOrderNumbers(org);

  for (const ev of client.events(from, to)) {
    const f = FIELDS.event;
    const id = String(pick(ev, f.id) || "");
    if (!id) continue;
    const status = String(pick(ev, f.status) || "");
    const statusName = String(pick(ev, f.statusName) || "");
    if (status && Object.keys(seen).length < 100) seen[status] = statusName || seen[status] || status;
    const linked = !!sync.findLink(org, "momentus", "jobs", { remoteId: id });
    if (statuses.length && statuses.indexOf(status) === -1 && !linked) continue;
    try {
      let orders = null;
      if (cfg.pullOrders || cfg.onlyWithOrders) {
        orders = client.orders(id).filter((o) => {
          const dep = String(pick(o, FIELDS.order.department) || "").toLowerCase();
          return !departments.length || departments.indexOf(dep) !== -1;
        });
        if (cfg.onlyWithOrders && !orders.length && !linked) continue;
      }
      const job = pullEvent(org, cfg, client, ev, status, statusName, run, toPbDate);
      if (job && cfg.pullOrders && orders) pullOrders(org, cfg, client, job, orders, pushedOrders, run);
    } catch (err) {
      run.fail("event", id, String(pick(ev, f.name) || ""), err);
    }
  }
  return { seenStatuses: seen };
}

// Orders R2 itself created from quotes, which aren't pulled back in.
function pushedOrderNumbers(org) {
  const { decodeJson } = require("./records.js");
  const out = {};
  for (const link of $app.findRecordsByFilter("sync_links", "org = {:org} && provider = 'momentus' && collection = 'jobs'", "", 0, 0, { org: org })) {
    const extra = decodeJson(link.get("extra"), {});
    if (extra.orderNumber) out[String(extra.orderNumber)] = true;
  }
  return out;
}

function pullEvent(org, cfg, client, ev, status, statusName, run, toPbDate) {
  const f = FIELDS.event;
  const id = String(pick(ev, f.id));
  const name = String(pick(ev, f.name) || "").trim() || "Momentus event " + id;

  // Times: the event's own, widened to its functions'.
  let start = localMs(org, wallTime(pick(ev, f.startDate), pick(ev, f.startTime)));
  let end = localMs(org, wallTime(pick(ev, f.endDate), pick(ev, f.endTime)));
  let spaceCode = pick(ev, f.space);
  let functions = [];
  try {
    functions = client.functions(id);
  } catch (err) {
    run.fail("functions", id, name, err);
  }
  for (const fn of functions) {
    const ff = FIELDS.func;
    const s = localMs(org, wallTime(pick(fn, ff.startDate), pick(fn, ff.startTime)));
    const e = localMs(org, wallTime(pick(fn, ff.endDate), pick(fn, ff.endTime)));
    if (Number.isFinite(s) && (!Number.isFinite(start) || s < start)) start = s;
    if (Number.isFinite(e) && (!Number.isFinite(end) || e > end)) end = e;
    if (!spaceCode) spaceCode = pick(fn, ff.space);
  }
  // An event given as whole days runs to the end of its last day.
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) end = start + 86400000;
  if (!(start < end)) {
    run.fail("event", id, name, "No dates in Momentus");
    return null;
  }

  const clientId = pullAccount(org, cfg, client, pick(ev, f.account), run);
  const venueId = pullSpace(org, cfg, client, spaceCode, run);
  const prep = start - (Number(cfg.prepHours) || 0) * 3600000;
  const ret = end + (Number(cfg.returnHours) || 0) * 3600000;
  const result = sync.reconcile(
    org,
    "momentus",
    cfg,
    {
      collection: "jobs",
      remoteType: "events",
      remoteId: id,
      remote: {
        name: name,
        status: statusFor(status, statusName, cfg.statusMap),
        client: clientId,
        venue: venueId,
        reference: "Momentus " + id,
        showStart: toPbDate(start),
        showEnd: toPbDate(end),
      },
      remoteModified: pick(ev, f.modified) || "",
      direction: "in",
      newRecord: { prepAt: toPbDate(prep), returnAt: toPbDate(ret), billingStart: toPbDate(start), billingEnd: toPbDate(end) },
    },
    run,
  );
  if (!result.record) return null;
  if (result.created) run.count("projects created");
  else {
    // Dates follow Momentus while the schedule is still the one it gave.
    const { updatePeriods } = require("./imports.js");
    updatePeriods(result.record.id, toPbDate(prep), toPbDate(ret), toPbDate(start), toPbDate(end));
    if (result.changed) run.count("projects updated");
  }
  return result.record;
}

function pullAccount(org, cfg, client, code, run) {
  if (!code) return "";
  code = String(code);
  const existing = sync.findLink(org, "momentus", "contacts", { remoteId: code });
  // Accounts change rarely: re-read one at most once a day.
  if (existing && Date.now() - Date.parse(existing.getString("syncedAt").replace(" ", "T")) < 86400000) return existing.getString("record");
  let account = null;
  try {
    account = client.account(code);
  } catch (err) {
    run.fail("account", code, "", err);
  }
  if (!account) return existing ? existing.getString("record") : "";
  const f = FIELDS.account;
  const address = f.address.map((k) => String(account[k] || "").trim()).filter(Boolean).join("\n");
  const email = String(pick(account, f.email) || "").trim();
  const { EMAIL } = require("./rentmanMap.js");
  const result = sync.reconcile(
    org,
    "momentus",
    cfg,
    {
      collection: "contacts",
      remoteType: "accounts",
      remoteId: code,
      remote: { name: String(pick(account, f.name) || code).trim(), email: EMAIL.test(email) ? email : "", phone: String(pick(account, f.phone) || "").trim(), billingAddress: address },
      direction: "in",
      newRecord: { kind: "company" },
    },
    run,
  );
  if (result.created) run.count("contacts created");
  return result.record ? result.record.id : "";
}

function pullSpace(org, cfg, client, code, run) {
  if (!code) return "";
  code = String(code);
  const existing = sync.findLink(org, "momentus", "venues", { remoteId: code });
  if (existing) return existing.getString("record");
  let space = null;
  try {
    space = client.space(code);
  } catch (err) {
    run.fail("space", code, "", err);
  }
  const result = sync.reconcile(
    org,
    "momentus",
    cfg,
    { collection: "venues", remoteType: "spaces", remoteId: code, remote: { name: String(pick(space, FIELDS.space.name) || code).trim() }, direction: "in" },
    run,
  );
  if (result.created) run.count("locations created");
  return result.record ? result.record.id : "";
}

// R2 item for a Momentus resource code: one R2 sent there, else the same code.
function itemForResource(org, code, cache) {
  if (!code) return "";
  if (cache[code] !== undefined) return cache[code];
  const link = sync.findLink(org, "momentus", "items", { remoteId: code });
  let id = link ? link.getString("record") : "";
  if (!id) {
    const item = $app.findRecordsByFilter("items", "org = {:org} && code = {:code}", "", 1, 0, { org: org, code: code })[0];
    id = item ? item.id : "";
  }
  cache[code] = id;
  return id;
}

function pullOrders(org, cfg, client, job, orders, pushedOrders, run) {
  const cache = {};
  const kept = {};
  let complete = true;
  for (const order of orders) {
    const number = String(pick(order, FIELDS.order.number) || "");
    if (!number || pushedOrders[number]) continue;
    const label = String(pick(order, FIELDS.order.name) || "").trim() || "Momentus order " + number;
    let items = [];
    try {
      items = client.orderItems(number);
    } catch (err) {
      run.fail("order", number, label, err);
      complete = false;
      continue;
    }
    items.forEach((oi, index) => {
      const f = FIELDS.orderItem;
      const line = String(pick(oi, f.line) || index + 1);
      const remoteId = number + "-" + line;
      const resource = String(pick(oi, f.resource) || "");
      const itemId = itemForResource(org, resource, cache);
      const quantity = Math.max(0, Number(pick(oi, f.quantity)) || 0);
      if (quantity === 0) return;
      const amount = Number(pick(oi, f.amount));
      const price = Number(pick(oi, f.price)) || (Number.isFinite(amount) ? amount / quantity : 0);
      const name = String(pick(oi, f.name) || resource || "Momentus item").trim();
      try {
        sync.reconcile(
          org,
          "momentus",
          cfg,
          {
            collection: "job_lines",
            remoteType: "orderitems",
            remoteId: remoteId,
            remote: {
              job: job.id,
              item: itemId,
              lineType: itemId ? "item" : "custom",
              description: itemId ? "" : name,
              quantity: itemId ? Math.round(quantity) : quantity,
              unitPrice: Math.round(price * 100) / 100,
              group: label,
              notes: String(pick(oi, f.note) || "").trim(),
            },
            direction: "in",
            newRecord: { priceMode: "fixed", sortOrder: Number(number) * 1000 + index },
          },
          run,
        );
        kept[remoteId] = true;
        run.count("lines");
      } catch (err) {
        run.fail("order item", remoteId, name, err);
      }
    });
  }
  // Lines from this project's orders that Momentus no longer has (only
  // when every order was read, so a failed read never removes anything).
  if (!complete) return;
  const linked = arrayOf(new DynamicModel({ link: "", remoteId: "", line: "" }));
  $app
    .db()
    .newQuery(
      "SELECT l.id AS link, l.remoteId AS remoteId, j.id AS line FROM sync_links l JOIN job_lines j ON j.id = l.record " +
        "WHERE l.org = {:org} AND l.provider = 'momentus' AND l.collection = 'job_lines' AND j.job = {:job}",
    )
    .bind({ org: org, job: job.id })
    .all(linked);
  for (const row of linked) {
    if (kept[row.remoteId]) continue;
    try {
      sync.quietDelete($app.findRecordById("job_lines", row.line));
      $app.delete($app.findRecordById("sync_links", row.link));
      run.count("lines removed");
    } catch (err) {
      run.fail("line", row.line, "", err);
    }
  }
}

// ----------------------------------------------------------------- queue

function handle(job, cfg, run) {
  const org = job.getString("org");
  const action = job.getString("action");
  if (action === "pull") return sync.runPoll(org, "momentus", cfg, null, "manual");
  if (action === "pushQuote") return pushQuote(org, cfg, run, job.getString("record"));
  if (action === "pushItem") return pushItem(org, cfg, run, job.getString("record"), clientFor(org, cfg));
  if (action === "pushInventory") return pushInventory(org, cfg, run);
}

// An issued quote → its event's order, created the first time and its
// items replaced after.
function pushQuote(org, cfg, run, quoteId) {
  const { decodeJson, findOrNull } = require("./records.js");
  const quote = findOrNull($app, "quotes", quoteId);
  if (!quote) return;
  const jobId = quote.getString("job");
  const link = sync.findLink(org, "momentus", "jobs", { record: jobId });
  if (!link) throw sync.permanentError("This project didn't come from a Momentus event, so there's no event to send the quote to");
  const extra = decodeJson(link.get("extra"), {});
  if (extra.quoteVersion && extra.quoteVersion > quote.getInt("version")) return; // a newer quote went already
  const snapshot = decodeJson(quote.get("snapshot"), {});
  const codes = {};
  for (const l of snapshot.lines || []) {
    if (!l.code || codes[l.code] !== undefined) continue;
    const item = $app.findRecordsByFilter("items", "org = {:org} && code = {:code}", "", 1, 0, { org: org, code: l.code })[0];
    const itemLink = item && sync.findLink(org, "momentus", "items", { record: item.id });
    codes[l.code] = itemLink ? itemLink.getString("remoteId") : cfg.pushInventory ? l.code : "";
  }
  const plan = orderItemsFor(snapshot.lines, (l) => (l.code ? codes[l.code] : ""), cfg.miscResource);
  if (plan.missing.length) {
    throw sync.permanentError(
      "No Momentus resource for " + plan.missing.slice(0, 5).join(", ") + (plan.missing.length > 5 ? "…" : "") + ": send your inventory to Momentus or set a resource for other lines",
    );
  }
  const client = clientFor(org, cfg);
  const eventId = link.getString("remoteId");
  let number = extra.orderNumber ? String(extra.orderNumber) : "";
  const description = ("R2 quote " + (snapshot.job && snapshot.job.number ? snapshot.job.number + " " : "") + "v" + quote.getInt("version")).slice(0, 100);
  if (number) {
    for (const oi of client.orderItems(number)) {
      const line = pick(oi, FIELDS.orderItem.line);
      if (line !== undefined) client.deleteOrderItem(number, line);
    }
    client.updateOrder(number, { Description: description });
  } else {
    const event = client.event(eventId);
    const created = client.createOrder({
      Event: Number(eventId) || eventId,
      Account: event ? pick(event, FIELDS.event.account) : undefined,
      Department: cfg.orderDepartment || undefined,
      OrderType: cfg.orderType || undefined,
      Description: description,
    });
    number = String(pick(created, FIELDS.order.number) || "");
    if (!number) throw new Error("Momentus didn't return the new order's number");
    // Remember it straight away, so a failure adding items doesn't make a second order next try.
    sync.saveLink(org, "momentus", "jobs", jobId, "events", eventId, undefined, undefined, Object.assign(extra, { orderNumber: number }));
  }
  for (const item of plan.items) {
    client.addOrderItem({ OrderNumber: Number(number) || number, Resource: item.resource, Quantity: item.quantity, Price: item.price, Note: item.note });
  }
  sync.saveLink(org, "momentus", "jobs", jobId, "events", eventId, undefined, undefined, Object.assign(extra, { orderNumber: number, quoteVersion: quote.getInt("version"), pushedAt: sync.nowPb() }));
  run.count("quotes sent");
}

function inventoryWanted(cfg, item) {
  if (item.getBool("archived")) return false;
  const categories = cfg.inventoryCategories || [];
  return !categories.length || categories.indexOf(item.getString("category")) !== -1;
}

function resourceBody(cfg, item) {
  return {
    Code: item.getString("code"),
    Description: item.getString("name").slice(0, 100),
    Department: cfg.orderDepartment || undefined,
    Price: item.getFloat("price"),
    Active: !item.getBool("archived"),
  };
}

function pushItem(org, cfg, run, itemId, client) {
  const { findOrNull } = require("./records.js");
  const item = findOrNull($app, "items", itemId);
  if (!item) return;
  const code = item.getString("code");
  if (!code) return;
  const link = sync.findLink(org, "momentus", "items", { record: item.id });
  if (!inventoryWanted(cfg, item) && !link) return;
  const body = resourceBody(cfg, item);
  try {
    if (link || client.resource(code)) client.updateResource(link ? link.getString("remoteId") : code, body);
    else client.createResource(body);
  } catch (err) {
    if (err.status === 401 || err.status === 403) sync.patchState(org, "momentus", { inventoryBlocked: true });
    throw err;
  }
  sync.saveLink(org, "momentus", "items", item.id, "resources", code, { code: code, name: body.Description, price: body.Price });
  run.count("resources sent");
}

function pushInventory(org, cfg, run) {
  const client = clientFor(org, cfg);
  const items = $app.findRecordsByFilter("items", "org = {:org} && archived = false && code != ''", "name", 0, 0, { org: org });
  for (const item of items) {
    if (!inventoryWanted(cfg, item)) continue;
    try {
      pushItem(org, cfg, run, item.id, client);
    } catch (err) {
      if (err.permanent && (err.status === 401 || err.status === 403)) throw err;
      run.fail("item", item.id, item.getString("name"), err);
    }
  }
  sync.patchState(org, "momentus", { inventoryBlocked: false, lastInventoryAt: Date.now() });
}

// The spreadsheet for venues whose licence won't let R2 send resources.
function resourcesCsv(org, cfg) {
  const items = $app.findRecordsByFilter("items", "org = {:org} && archived = false", "name", 0, 0, { org: org });
  const cell = (v) => {
    const s = String(v === undefined || v === null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [["Code", "Description", "Department", "Price", "PriceUnit", "Active"].join(",")];
  for (const item of items) {
    if (!inventoryWanted(cfg, item)) continue;
    lines.push([item.getString("code"), item.getString("name"), cfg.orderDepartment || "", item.getFloat("price"), item.getString("priceUnit") || "day", "Y"].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------- R2 changes

function onLocalChange(org, cfg, event, record) {
  const collection = record.collection().name;
  if (collection === "items" && cfg.pushInventory && event !== "delete") {
    sync.enqueue(org, "momentus", "out", "pushItem", { collection: "items", record: record.id });
  }
  if (collection === "quotes" && event === "create" && cfg.pushQuotes && record.getString("status") === "issued") {
    if (sync.findLink(org, "momentus", "jobs", { record: record.getString("job") })) {
      sync.enqueue(org, "momentus", "out", "pushQuote", { collection: "quotes", record: record.id });
    }
  }
}

function test(org) {
  const cfg = sync.getConfig(org, "momentus");
  const client = clientFor(org, cfg);
  const now = new Date();
  const events = client.events(now.toISOString().slice(0, 19), new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 19));
  return { ok: true, message: "Connected to Momentus: " + events.length + " event" + (events.length === 1 ? "" : "s") + " in the next 30 days" };
}

// What changes while the organisation has projects turned off
// (lib/sync.js getConfig): no events, orders or quotes, just inventory out.
const WITHOUT_PROJECTS = { pullEvents: false, pullOrders: false, pushQuotes: false };

module.exports = {
  DEFAULTS,
  WITHOUT_PROJECTS,
  pollDue,
  poll,
  handle,
  onLocalChange,
  test,
  resourcesCsv,
  statusFor,
  wallTime,
  orderItemsFor,
};
