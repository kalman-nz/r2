// Maintenance plans and jobs (pb_migrations/0033_maintenance.js has the
// model; changed only through routes_maintenance.pb.js and the hooks in
// records_maintenance.pb.js).
//
// A plan covers items. Everything it covers — each active or in-repair
// unit of a serialised item, and each bulk item as a whole — always has
// exactly one scheduled job from it: syncPlan() and syncAsset() keep that
// true as plans, items and units change. Doing a plan's job schedules the
// next, `every` days/weeks/months/years after the day it was done. Kit
// that's never been done is due on the plan's first due date (or today,
// once that's passed); a test & tag plan uses a unit's own "Next test &
// tag" date first, so dates brought in from Rentman carry on.
//
// Test & tag plans also keep each unit's "Next test & tag"
// (serials.nextInspection) on its next scheduled test, so the units list
// and labels show it, and changing that date on a unit moves the test.

const { isDate, addInterval, UNITS } = require("./dates.js");
const { findOrNull } = require("./records.js");

const KINDS = ["inspection", "test_tag", "service"];

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function zoneOf(org) {
  const { publicSettings } = require("./settings.js");
  try {
    return new Timezone(publicSettings(org).timezone || "UTC");
  } catch (_) {
    return new Timezone("UTC");
  }
}

// Today in the organisation's time zone (Settings → Business).
function todayFor(org) {
  try {
    return new DateTime().time().in(zoneOf(org)).format("2006-01-02");
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

// The calendar day a stored datetime falls on in the organisation's zone,
// or "" for none.
function dayOf(datetime, org) {
  if (!datetime) return "";
  try {
    return new DateTime(String(datetime)).time().in(zoneOf(org)).format("2006-01-02");
  } catch (_) {
    return String(datetime).slice(0, 10);
  }
}

// When a calendar day starts in the organisation's zone, as PocketBase
// stores datetimes ("Next test & tag" is a datetime, set to local midnight
// like every other date picked in the app).
function startOfDay(date, org) {
  const { toPbDate } = require("./time.js");
  const p = date.split("-").map(Number);
  const base = Date.UTC(p[0], p[1] - 1, p[2]);
  try {
    const zone = zoneOf(org);
    const offset = (ms) => {
      const z = new DateTime(toPbDate(ms)).time().in(zone).format("-0700");
      return (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60000;
    };
    // Twice, so a day that daylight saving starts or ends on still lands
    // on its own midnight.
    return toPbDate(base - offset(base - offset(base)));
  } catch (_) {
    return toPbDate(base);
  }
}

// --- what a plan covers ---

// An item's assets: its units that are still around (active or in repair)
// when serialised, or the item itself. Nothing for kits and archived items.
function assetsOfItem(app, item) {
  if (!item || item.getBool("archived") || item.getString("kind") !== "item") return [];
  if (item.getString("tracking") !== "serial") return [{ key: item.id + "/", item: item, serial: null }];
  return app
    .findRecordsByFilter("serials", "item = {:item} && (status = 'active' || status = 'repair')", "barcode", 0, 0, { item: item.id })
    .map((unit) => ({ key: item.id + "/" + unit.id, item: item, serial: unit }));
}

function plansCovering(app, itemId) {
  return app.findRecordsByFilter("maintenance_plans", "items.id ?= {:item}", "", 0, 0, { item: itemId });
}

// When an asset is next due on a plan: `every` after it was last done,
// else its own "Next test & tag" (test & tag plans), else the plan's first
// due date, or today once that's passed.
function nextDue(plan, asset, lastDone, today) {
  if (lastDone) return addInterval(lastDone, plan.getInt("every"), plan.getString("unit"));
  if (plan.getString("kind") === "test_tag" && asset.serial) {
    const own = dayOf(asset.serial.getString("nextInspection"), plan.getString("org"));
    if (isDate(own)) return own;
  }
  const first = plan.getString("firstDue");
  return isDate(first) && first > today ? first : today;
}

// The last day each asset was done on a plan, by "item/serial".
function lastDoneByKey(app, plan) {
  const rows = arrayOf(new DynamicModel({ item: "", serial: "", last: "" }));
  app
    .db()
    .newQuery("SELECT item, serial, MAX(doneOn) AS last FROM maintenance_jobs WHERE plan = {:plan} AND status = 'done' GROUP BY item, serial")
    .bind({ plan: plan.id })
    .all(rows);
  const out = {};
  for (const r of rows) out[r.item + "/" + r.serial] = r.last;
  return out;
}

function newJob(app, plan, asset, dueOn) {
  const job = new Record(app.findCollectionByNameOrId("maintenance_jobs"), {
    org: plan.getString("org"),
    plan: plan.id,
    name: plan.getString("name"),
    kind: plan.getString("kind"),
    item: asset.item.id,
    serial: asset.serial ? asset.serial.id : "",
    dueOn: dueOn,
    status: "scheduled",
  });
  app.save(job);
  return job;
}

// Makes a plan's scheduled jobs match what it covers: one each, named
// after the plan. Out-of-scope jobs (an item taken off, a unit retired) go.
function syncPlan(app, plan) {
  const today = todayFor(plan.getString("org"));
  const wanted = {};
  for (const id of plan.getStringSlice("items")) {
    for (const asset of assetsOfItem(app, findOrNull(app, "items", id))) wanted[asset.key] = asset;
  }
  const have = {};
  for (const job of app.findRecordsByFilter("maintenance_jobs", "plan = {:plan} && status = 'scheduled'", "dueOn", 0, 0, { plan: plan.id })) {
    const key = job.getString("item") + "/" + job.getString("serial");
    if (!wanted[key] || have[key]) {
      app.delete(job);
      continue;
    }
    have[key] = true;
    if (job.getString("name") !== plan.getString("name") || job.getString("kind") !== plan.getString("kind")) {
      job.set("name", plan.getString("name"));
      job.set("kind", plan.getString("kind"));
      app.save(job);
    }
  }
  const last = lastDoneByKey(app, plan);
  for (const key in wanted) {
    if (!have[key]) newJob(app, plan, wanted[key], nextDue(plan, wanted[key], last[key], today));
  }
  if (plan.getString("kind") === "test_tag") {
    for (const key in wanted) if (wanted[key].serial) syncNextInspection(app, wanted[key].serial);
  }
}

// Whether a plan covering `item` covers this one asset (see assetsOfItem).
function covers(item, serial) {
  if (!item || item.getBool("archived") || item.getString("kind") !== "item") return false;
  if (item.getString("tracking") !== "serial") return !serial;
  return !!serial && serial.getString("item") === item.id && ["active", "repair"].indexOf(serial.getString("status")) !== -1;
}

// The same for one unit or bulk item on every plan covering it: after it's
// added, retired, put back or done. Cheap when no plan covers it, as for
// most units an import brings in.
function syncAsset(app, itemId, serialId) {
  const serial = serialId ? findOrNull(app, "serials", serialId) : null;
  const plans = plansCovering(app, itemId);
  if (plans.length > 0) {
    const item = findOrNull(app, "items", itemId);
    const covered = covers(item, serialId ? serial : null) && (!serialId || !!serial);
    const which = "item = {:item} && " + (serialId ? "serial = {:serial}" : "serial = ''");
    for (const plan of plans) {
      const params = { plan: plan.id, item: itemId, serial: serialId || "" };
      const scheduled = app.findRecordsByFilter("maintenance_jobs", "plan = {:plan} && status = 'scheduled' && " + which, "dueOn", 0, 0, params);
      if (!covered) {
        for (const job of scheduled) app.delete(job);
        continue;
      }
      if (scheduled.length > 0) continue;
      const last = app.findRecordsByFilter("maintenance_jobs", "plan = {:plan} && status = 'done' && " + which, "-doneOn", 1, 0, params)[0];
      const asset = { item: item, serial: serial };
      newJob(app, plan, asset, nextDue(plan, asset, last ? last.getString("doneOn") : "", todayFor(plan.getString("org"))));
    }
  }
  if (serial) syncNextInspection(app, serial);
}

// A unit's "Next test & tag" follows its next scheduled test & tag job.
// Units on no test & tag plan keep whatever date was put on them.
function syncNextInspection(app, unit) {
  const { toMs } = require("./time.js");
  const next = app.findRecordsByFilter("maintenance_jobs", "serial = {:serial} && status = 'scheduled' && kind = 'test_tag'", "dueOn", 1, 0, {
    serial: unit.id,
  })[0];
  if (!next) return;
  const fresh = app.findRecordById("serials", unit.id);
  const value = startOfDay(next.getString("dueOn"), fresh.getString("org"));
  if (toMs(fresh.getString("nextInspection")) === toMs(value)) return;
  fresh.set("nextInspection", value);
  app.save(fresh);
}

// Someone changed a unit's "Next test & tag" by hand: move its scheduled
// test there.
function moveTestTo(app, unit) {
  const day = dayOf(unit.getString("nextInspection"), unit.getString("org"));
  if (!isDate(day)) return;
  for (const job of app.findRecordsByFilter("maintenance_jobs", "serial = {:serial} && status = 'scheduled' && kind = 'test_tag'", "dueOn", 0, 0, { serial: unit.id })) {
    if (job.getString("dueOn") === day) continue;
    job.set("dueOn", day);
    app.save(job);
  }
}

// --- plans ---

// The organisation's physical items from a list of ids, for a plan.
function planItems(app, org, ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const item = findOrNull(app, "items", String(id));
    if (!item || item.getString("org") !== org) throw new BadRequestError("One of those items doesn't exist");
    if (item.getString("kind") !== "item") throw new BadRequestError(item.getString("name") + " is a kit: add the items in it instead");
    if (out.indexOf(item.id) === -1) out.push(item.id);
  }
  return out;
}

// body: { name, kind, every, unit, items: [ids], firstDue, instructions }.
// Creates (plan null) or changes a plan, then brings its jobs into line.
function savePlan(app, org, plan, body, who) {
  let saved;
  app.runInTransaction((tx) => {
    const record = plan ? tx.findRecordById("maintenance_plans", plan.id) : new Record(tx.findCollectionByNameOrId("maintenance_plans"), { org: org, createdBy: who ? who.id : "" });
    const set = (key, value) => record.set(key, value);
    if (!plan || body.name !== undefined) {
      const name = text(body.name, 200);
      if (!name) throw new BadRequestError("Give the plan a name, like Annual PPE inspection");
      set("name", name);
    }
    if (!plan || body.kind !== undefined) {
      if (KINDS.indexOf(body.kind) === -1) throw new BadRequestError("Pick what kind of work it is");
      set("kind", body.kind);
    }
    if (!plan || body.every !== undefined || body.unit !== undefined) {
      const every = Number(body.every === undefined ? record.getInt("every") : body.every);
      const unit = body.unit === undefined ? record.getString("unit") : body.unit;
      if (!Number.isInteger(every) || every < 1 || every > 1000) throw new BadRequestError("How often has to be a whole number, 1 or more");
      if (UNITS.indexOf(unit) === -1) throw new BadRequestError("Pick days, weeks, months or years");
      set("every", every);
      set("unit", unit);
    }
    if (!plan || body.items !== undefined) set("items", planItems(tx, org, body.items));
    if (!plan || body.firstDue !== undefined) {
      const first = text(body.firstDue, 10);
      if (first && !isDate(first)) throw new BadRequestError("The first due date isn't a date");
      set("firstDue", first);
    }
    if (body.instructions !== undefined) set("instructions", text(body.instructions, 5000));
    tx.save(record);
    syncPlan(tx, record);
    saved = record;
  });
  return app.findRecordById("maintenance_plans", saved.id);
}

// Its scheduled jobs go with it; done ones stay, as history.
function deletePlan(app, plan) {
  app.runInTransaction((tx) => {
    for (const job of tx.findRecordsByFilter("maintenance_jobs", "plan = {:plan} && status = 'scheduled'", "", 0, 0, { plan: plan.id })) tx.delete(job);
    tx.delete(tx.findRecordById("maintenance_plans", plan.id));
  });
}

// --- jobs ---

// body: { name, kind, item?, serials?: [ids], dueOn, notes }. One-off work:
// a job per unit picked, or one for the item, or one for nothing in
// particular. Returns the new jobs.
function scheduleJobs(app, org, body, who) {
  const name = text(body.name, 200);
  if (!name) throw new BadRequestError("Say what needs doing");
  const kind = body.kind === undefined ? "service" : body.kind;
  if (KINDS.indexOf(kind) === -1) throw new BadRequestError("Pick what kind of work it is");
  const dueOn = text(body.dueOn, 10);
  if (!isDate(dueOn)) throw new BadRequestError("Pick when it's due");
  const made = [];
  app.runInTransaction((tx) => {
    let item = null;
    if (body.item) {
      item = findOrNull(tx, "items", String(body.item));
      if (!item || item.getString("org") !== org) throw new BadRequestError("That item doesn't exist");
      if (item.getString("kind") !== "item") throw new BadRequestError(item.getString("name") + " is a kit: pick the items in it instead");
    }
    const units = [];
    for (const id of Array.isArray(body.serials) ? body.serials : []) {
      const unit = findOrNull(tx, "serials", String(id));
      if (!unit || !item || unit.getString("item") !== item.id) throw new BadRequestError("Those units aren't all " + (item ? item.getString("name") : "one item's"));
      units.push(unit);
    }
    const collection = tx.findCollectionByNameOrId("maintenance_jobs");
    const base = { org: org, name: name, kind: kind, item: item ? item.id : "", dueOn: dueOn, status: "scheduled", notes: text(body.notes, 5000), createdBy: who ? who.id : "" };
    for (const unit of units.length > 0 ? units : [null]) {
      const job = new Record(collection, base);
      if (unit) job.set("serial", unit.id);
      tx.save(job);
      made.push(job);
    }
  });
  return made.map((j) => app.findRecordById("maintenance_jobs", j.id));
}

// body: any of { name (one-off jobs), dueOn (while scheduled), notes,
// cost, doneBy (once done) }.
function updateJob(app, job, body) {
  const record = app.findRecordById("maintenance_jobs", job.id);
  const scheduled = record.getString("status") === "scheduled";
  if (body.name !== undefined) {
    if (record.getString("plan")) throw new BadRequestError("A plan's jobs take the plan's name: rename the plan");
    const name = text(body.name, 200);
    if (!name) throw new BadRequestError("Say what needs doing");
    record.set("name", name);
  }
  if (body.dueOn !== undefined) {
    if (!scheduled) throw new BadRequestError("It's already been done");
    if (!isDate(body.dueOn)) throw new BadRequestError("Pick when it's due");
    record.set("dueOn", body.dueOn);
  }
  if (body.notes !== undefined) record.set("notes", text(body.notes, 5000));
  if (body.cost !== undefined) {
    const cost = body.cost === "" || body.cost === null ? 0 : Number(body.cost);
    if (!isFinite(cost) || cost < 0) throw new BadRequestError("Cost must be 0 or more");
    record.set("cost", cost);
  }
  if (body.doneBy !== undefined) {
    if (scheduled) throw new BadRequestError("It hasn't been done yet");
    record.set("doneBy", text(body.doneBy, 200));
  }
  app.save(record);
  if (body.dueOn !== undefined && record.getString("kind") === "test_tag" && record.getString("serial")) {
    const unit = findOrNull(app, "serials", record.getString("serial"));
    if (unit) syncNextInspection(app, unit);
  }
  return record;
}

// Only one-off work that hasn't been done: a plan's jobs come back until
// the item comes off the plan, and done work is history.
function deleteJob(app, job) {
  if (job.getString("status") !== "scheduled") throw new BadRequestError("Done work stays on record: add a note to it instead");
  if (job.getString("plan")) throw new BadRequestError("This is from a plan: change its due date, or take the item off the plan");
  app.delete(job);
}

// body: { result: "pass" | "fail", doneOn, doneBy, notes, cost, failedQty
// (bulk), repair: { fault, repairer } (on a fail, to open one) }. Records
// the work as done; a fail can open a repair, which takes the kit out of
// service. A plan's job then schedules the next. Returns { job, repair }.
function completeJob(app, job, body, who) {
  const { openRepair, openRepairOf } = require("./repairs.js");
  const { whoName } = require("./auth.js");
  const org = job.getString("org");
  const result = body.result;
  if (result !== "pass" && result !== "fail") throw new BadRequestError("Say whether it passed or failed");
  const today = todayFor(org);
  const doneOn = body.doneOn ? text(body.doneOn, 10) : today;
  if (!isDate(doneOn)) throw new BadRequestError("The date it was done isn't a date");
  if (doneOn > today) throw new BadRequestError("It can't be done in the future");
  let saved;
  let repair = null;
  app.runInTransaction((tx) => {
    const record = tx.findRecordById("maintenance_jobs", job.id);
    if (record.getString("status") !== "scheduled") throw new BadRequestError("This has already been done");
    const item = findOrNull(tx, "items", record.getString("item"));
    const unit = findOrNull(tx, "serials", record.getString("serial"));
    record.set("status", "done");
    record.set("result", result);
    record.set("doneOn", doneOn);
    record.set("doneBy", text(body.doneBy, 200) || whoName(who));
    if (body.notes !== undefined) record.set("notes", text(body.notes, 5000));
    if (body.cost !== undefined && body.cost !== "" && body.cost !== null) {
      const cost = Number(body.cost);
      if (!isFinite(cost) || cost < 0) throw new BadRequestError("Cost must be 0 or more");
      record.set("cost", cost);
    }
    const bulk = item && !unit && item.getString("tracking") !== "serial";
    let failedQty = 0;
    if (result === "fail" && bulk) {
      failedQty = Number(body.failedQty === undefined ? 1 : body.failedQty);
      if (!Number.isInteger(failedQty) || failedQty < 1) throw new BadRequestError("Say how many failed");
      record.set("failedQty", failedQty);
    }

    // A fail with a fault takes it out of service. A unit already away on
    // a repair keeps that one.
    if (result === "fail" && body.repair && item) {
      const fault = text(body.repair.fault, 2000) || record.getString("name") + ": failed";
      const already = unit ? openRepairOf(tx, unit.id) : null;
      if (already) {
        repair = already;
      } else if (!unit || unit.getString("status") === "active") {
        repair = openRepair(
          tx,
          org,
          { item: item.id, serials: unit ? [unit.id] : undefined, quantity: unit ? undefined : failedQty, fault: fault, repairer: body.repair.repairer },
          who,
        );
      }
      if (repair) record.set("repair", repair.id);
    }
    tx.save(record);
    saved = record;

    if (record.getString("plan")) syncAsset(tx, record.getString("item"), record.getString("serial"));
    else if (unit && record.getString("kind") === "test_tag") syncNextInspection(tx, unit);
  });
  return { job: app.findRecordById("maintenance_jobs", saved.id), repair: repair };
}

module.exports = {
  KINDS,
  todayFor,
  syncPlan,
  syncAsset,
  plansCovering,
  moveTestTo,
  savePlan,
  deletePlan,
  scheduleJobs,
  updateJob,
  deleteJob,
  completeJob,
};
