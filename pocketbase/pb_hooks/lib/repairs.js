// Repair jobs (pb_migrations/0028_repairs.js has the model, 0032 its files
// and project, 0034 its statuses; lib/files.js handles the files). Each
// organisation names its own statuses (Settings → Repair statuses); what a
// status does to the kit is its stage:
//
//   open          out of service while the repair's in it
//   repaired      ends it: back in service
//   unrepairable  ends it: units retired, bulk stock reduced
//
// Moving a repair from one stage to another puts its kit in or out of
// service to match, in the same transaction as the repair itself, so stock
// and repairs can't disagree.

const STAGES = ["open", "repaired", "unrepairable"];
// Must match the colour field (migrations 0034 and 0035).
const COLOURS = ["gray", "amber", "orange", "blue", "teal", "violet", "green", "red"];
// What every organisation starts with (the same as migration 0034).
const DEFAULT_STATUSES = [
  { name: "Backlog", stage: "open", colour: "gray" },
  { name: "To repair", stage: "open", colour: "amber", isDefault: true },
  { name: "In repair", stage: "open", colour: "blue" },
  { name: "Repaired", stage: "repaired", colour: "green" },
  { name: "Unrepairable", stage: "unrepairable", colour: "red" },
];
// For filters: the repairs keeping kit out of service.
const OPEN_FILTER = "status.stage = 'open'";

// An organisation's statuses, in order.
function statusesOf(app, org) {
  return app.findRecordsByFilter("repair_statuses", "org = {:org}", "sortOrder,created", 0, 0, { org: org });
}

function createDefaultStatuses(app, org) {
  if (statusesOf(app, org).length > 0) return;
  const collection = app.findCollectionByNameOrId("repair_statuses");
  DEFAULT_STATUSES.forEach((d, i) => {
    app.save(new Record(collection, { org: org, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, isDefault: !!d.isDefault }));
  });
}

// One of the organisation's statuses by id.
function statusFor(tx, org, id) {
  let status;
  try {
    status = tx.findRecordById("repair_statuses", String(id || ""));
  } catch (_) {
    throw new BadRequestError("Pick one of the repair statuses");
  }
  if (status.getString("org") !== org) throw new BadRequestError("Pick one of the repair statuses");
  return status;
}

// Where new repairs start: the default, or failing that the first open one.
function defaultStatus(tx, org) {
  createDefaultStatuses(tx, org);
  const open = statusesOf(tx, org).filter((s) => s.getString("stage") === "open");
  return open.find((s) => s.getBool("isDefault")) || open[0];
}

// A repair's stage; one with no status counts as open.
function stageOf(tx, repair) {
  const id = repair.getString("status");
  if (!id) return "open";
  try {
    return tx.findRecordById("repair_statuses", id).getString("stage");
  } catch (_) {
    return "open";
  }
}

function statusName(app, id) {
  try {
    return app.findRecordById("repair_statuses", id).getString("name");
  } catch (_) {
    return "";
  }
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value, what) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!isFinite(n) || n < 0) throw new BadRequestError(what + " must be 0 or more");
  return n;
}

// When the kit's expected back: "" for none, otherwise a date (the app
// sends the start of the day picked) no earlier than the day the repair
// was opened, both in the organisation's time zone.
function expectedBack(org, value, openedOn) {
  const { toMs, toPbDate } = require("./time.js");
  const { dayOf } = require("./maintenance.js");
  const raw = text(value, 40);
  if (!raw) return "";
  const ms = toMs(raw);
  if (!isFinite(ms)) throw new BadRequestError("Expected back isn't a date");
  const stored = toPbDate(ms);
  if (dayOf(stored, org) < openedOn) {
    throw new BadRequestError("Expected back can't be before the repair was opened (" + openedOn.split("-").reverse().join("/") + ")");
  }
  return stored;
}

// The project a repair came back from: "" for none, otherwise one of the
// organisation's own.
function projectOf(tx, org, id) {
  if (!id) return "";
  let job;
  try {
    job = tx.findRecordById("jobs", String(id));
  } catch (_) {
    throw new BadRequestError("That project doesn't exist");
  }
  if (job.getString("org") !== org) throw new BadRequestError("That project belongs to another organisation");
  return job.id;
}

// The open repair a unit is on, or null.
function openRepairOf(app, serialId) {
  return (
    app.findRecordsByFilter("repairs", "serials.id ?= {:id} && " + OPEN_FILTER, "-number", 1, 0, { id: serialId })[0] ||
    null
  );
}

// The units on open repairs other than `exceptId`, as { serialId: number }.
function unitsUnderRepair(tx, org, exceptId) {
  const busy = {};
  const open = tx.findRecordsByFilter("repairs", "org = {:org} && " + OPEN_FILTER + " && id != {:id}", "", 0, 0, {
    org: org,
    id: exceptId || "",
  });
  for (const r of open) for (const s of r.getStringSlice("serials")) busy[s] = r.getInt("number");
  return busy;
}

// body: { item, serials: [ids] (serialised) | quantity (bulk), fault,
// repairer, dueAt, notes, job, status (one of the open statuses; the
// default if not given) }. Returns the new repair.
function openRepair(app, org, body, who) {
  const fault = text(body.fault, 2000);
  if (!fault) throw new BadRequestError("Say what's wrong with it");
  const dueAt = text(body.dueAt, 40) ? expectedBack(org, body.dueAt, require("./maintenance.js").todayFor(org)) : "";
  let repair;
  app.runInTransaction((tx) => {
    let item;
    try {
      item = tx.findRecordById("items", String(body.item || ""));
    } catch (_) {
      throw new BadRequestError("Pick the item that needs repairing");
    }
    if (item.getString("org") !== org) throw new BadRequestError("That item belongs to another organisation");
    if (item.getString("kind") !== "item") throw new BadRequestError("Repairs are for physical items: pick the broken part of the kit");

    const status = body.status ? statusFor(tx, org, body.status) : defaultStatus(tx, org);
    if (status.getString("stage") !== "open") throw new BadRequestError("A new repair starts in a status that keeps the kit out of service");

    const collection = tx.findCollectionByNameOrId("repairs");
    repair = new Record(collection, {
      org: org,
      item: item.id,
      status: status.id,
      fault: fault,
      repairer: text(body.repairer, 200),
      dueAt: dueAt,
      notes: text(body.notes, 5000),
      job: projectOf(tx, org, body.job),
      createdBy: who ? who.id : "",
    });

    if (item.getString("tracking") === "serial") {
      const ids = (Array.isArray(body.serials) ? body.serials.map(String) : []).filter((id, i, all) => all.indexOf(id) === i);
      if (ids.length === 0) throw new BadRequestError("Pick the units that need repairing");
      const busy = unitsUnderRepair(tx, org, "");
      for (const id of ids) {
        let unit;
        try {
          unit = tx.findRecordById("serials", id);
        } catch (_) {
          throw new BadRequestError("One of those units doesn't exist");
        }
        const name = unit.getString("barcode") || unit.getString("label") || "A unit";
        if (unit.getString("item") !== item.id) throw new BadRequestError(name + " isn't a unit of " + item.getString("name"));
        if (busy[id]) throw new BadRequestError(name + " is already on repair R" + busy[id]);
        if (unit.getString("status") === "lost" || unit.getString("status") === "retired") {
          throw new BadRequestError(name + " is marked " + unit.getString("status"));
        }
        unit.set("status", "repair");
        tx.save(unit);
      }
      repair.set("serials", ids);
      repair.set("quantity", ids.length);
    } else {
      const qty = Number(body.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new BadRequestError("Quantity must be a whole number, 1 or more");
      const usable = item.getInt("stockQty") - item.getInt("outOfServiceQty");
      if (usable <= 0) throw new BadRequestError("None of " + item.getString("name") + " are in service");
      if (qty > usable) throw new BadRequestError("Can't repair " + qty + ": only " + usable + " of " + item.getString("name") + " are in service");
      item.set("outOfServiceQty", item.getInt("outOfServiceQty") + qty);
      tx.save(item);
      repair.set("quantity", qty);
    }

    const rows = arrayOf(new DynamicModel({ n: 0 }));
    tx.db().newQuery("SELECT COALESCE(MAX(number), 0) AS n FROM repairs WHERE org = {:org}").bind({ org: org }).all(rows);
    repair.set("number", rows[0].n + 1);
    tx.save(repair);
  });
  return repair;
}

// Puts an ended repair's kit back in service (repaired) or retires it
// (unrepairable). Units someone has since marked lost or retired are left.
function release(tx, repair, unrepairable) {
  const item = tx.findRecordById("items", repair.getString("item"));
  if (item.getString("tracking") === "serial") {
    for (const id of repair.getStringSlice("serials")) {
      let unit;
      try {
        unit = tx.findRecordById("serials", id);
      } catch (_) {
        continue; // deleted since
      }
      if (unit.getString("status") !== "repair") continue;
      unit.set("status", unrepairable ? "retired" : "active");
      tx.save(unit);
    }
  } else {
    const qty = repair.getInt("quantity");
    item.set("outOfServiceQty", Math.max(0, item.getInt("outOfServiceQty") - qty));
    if (unrepairable) item.set("stockQty", Math.max(0, item.getInt("stockQty") - qty));
    tx.save(item);
  }
}

// The reverse, for a repair moved back from repaired or unrepairable (a
// slip, or it's playing up again): its kit comes out of service again.
// Units that have moved on since (lost, deleted) are left out.
function hold(tx, repair, from) {
  const item = tx.findRecordById("items", repair.getString("item"));
  if (item.getString("tracking") === "serial") {
    const busy = unitsUnderRepair(tx, repair.getString("org"), repair.id);
    const was = from === "unrepairable" ? "retired" : "active";
    for (const id of repair.getStringSlice("serials")) {
      let unit;
      try {
        unit = tx.findRecordById("serials", id);
      } catch (_) {
        continue; // deleted since
      }
      if (busy[id]) throw new BadRequestError((unit.getString("barcode") || "A unit") + " is on repair R" + busy[id] + " now");
      if (unit.getString("status") !== was) continue;
      unit.set("status", "repair");
      tx.save(unit);
    }
  } else {
    const qty = repair.getInt("quantity");
    if (from === "unrepairable") item.set("stockQty", item.getInt("stockQty") + qty);
    const usable = item.getInt("stockQty") - item.getInt("outOfServiceQty");
    if (qty > usable) throw new BadRequestError("Only " + usable + " of " + item.getString("name") + " are in service now");
    item.set("outOfServiceQty", item.getInt("outOfServiceQty") + qty);
    tx.save(item);
  }
}

// body: any of { fault, repairer, cost, dueAt, notes, job, status (an id) }.
// Any status can follow any other; when the stage changes, the kit goes in
// or out of service to match.
function updateRepair(app, repair, body) {
  const { toMs } = require("./time.js");
  const org = repair.getString("org");
  const openedOn = body.dueAt !== undefined ? require("./maintenance.js").dayOf(repair.getString("created"), org) : "";
  app.runInTransaction((tx) => {
    const record = tx.findRecordById("repairs", repair.id);
    if (body.fault !== undefined) {
      const fault = text(body.fault, 2000);
      if (!fault) throw new BadRequestError("Say what's wrong with it");
      record.set("fault", fault);
    }
    if (body.repairer !== undefined) record.set("repairer", text(body.repairer, 200));
    if (body.cost !== undefined) record.set("cost", money(body.cost, "Cost"));
    if (body.dueAt !== undefined) {
      // Only a changed date is checked, so an older repair's can be kept.
      const was = record.getString("dueAt");
      const next = text(body.dueAt, 40);
      const same = next === was || (!!next && !!was && toMs(next) === toMs(was));
      if (!same) record.set("dueAt", expectedBack(org, next, openedOn));
    }
    if (body.notes !== undefined) record.set("notes", text(body.notes, 5000));
    if (body.job !== undefined) record.set("job", projectOf(tx, record.getString("org"), body.job));

    if (body.status !== undefined && String(body.status) !== record.getString("status")) {
      const to = statusFor(tx, record.getString("org"), body.status);
      const fromStage = stageOf(tx, record);
      const toStage = to.getString("stage");
      if (fromStage !== toStage) {
        if (fromStage !== "open") hold(tx, record, fromStage);
        if (toStage !== "open") {
          release(tx, record, toStage === "unrepairable");
          record.set("closedAt", new Date().toISOString());
        } else {
          record.set("closedAt", "");
        }
      }
      record.set("status", to.id);
    }
    tx.save(record);
  });
  return app.findRecordById("repairs", repair.id);
}

// Replaces the organisation's statuses with `list`, in order:
// [{ id?, name, stage, colour, isDefault }]. New ones are made and missing
// ones deleted. A status with repairs in it can't be deleted or change
// stage (their kit would have to move); there's always an open status for
// new repairs to start in and a repaired one to finish with, and exactly
// one default. Returns the saved list.
function saveStatuses(app, org, list) {
  if (!Array.isArray(list) || list.length === 0) throw new BadRequestError("Add some statuses");
  if (list.length > 20) throw new BadRequestError("There can be up to 20 statuses");
  const seen = {};
  const clean = list.map((s, i) => {
    const name = text(s && s.name, 60);
    if (!name) throw new BadRequestError("Every status needs a name");
    if (seen[name.toLowerCase()]) throw new BadRequestError("There are two statuses called " + name);
    seen[name.toLowerCase()] = true;
    if (STAGES.indexOf(s.stage) === -1) throw new BadRequestError("Pick what " + name + " does to the kit");
    return {
      id: s.id ? String(s.id) : "",
      name: name,
      stage: s.stage,
      colour: COLOURS.indexOf(s.colour) !== -1 ? s.colour : "gray",
      isDefault: !!s.isDefault,
      sortOrder: (i + 1) * 10,
    };
  });
  if (!clean.some((s) => s.stage === "open")) throw new BadRequestError("Keep at least one status that holds kit out of service, for new repairs to start in");
  if (!clean.some((s) => s.stage === "repaired")) throw new BadRequestError("Keep at least one status for repaired kit");
  const def = clean.find((s) => s.isDefault && s.stage === "open") || clean.find((s) => s.stage === "open");
  for (const s of clean) s.isDefault = s === def;

  app.runInTransaction((tx) => {
    const inUse = (id) => {
      const rows = arrayOf(new DynamicModel({ n: 0 }));
      tx.db().newQuery("SELECT COUNT(*) AS n FROM repairs WHERE status = {:id}").bind({ id: id }).all(rows);
      return rows[0].n;
    };
    const existing = {};
    for (const r of statusesOf(tx, org)) existing[r.id] = r;
    const collection = tx.findCollectionByNameOrId("repair_statuses");
    const kept = {};
    for (const s of clean) {
      let record;
      if (s.id) {
        record = existing[s.id];
        if (!record) throw new BadRequestError("One of those statuses doesn't exist");
        if (record.getString("stage") !== s.stage && inUse(s.id) > 0) {
          throw new BadRequestError(record.getString("name") + " has repairs in it, so what it does to the kit can't change. Add a new status instead");
        }
        kept[s.id] = true;
      } else {
        record = new Record(collection, { org: org });
      }
      record.set("name", s.name);
      record.set("stage", s.stage);
      record.set("colour", s.colour);
      record.set("sortOrder", s.sortOrder);
      record.set("isDefault", s.isDefault);
      tx.save(record);
    }
    for (const id in existing) {
      if (kept[id]) continue;
      const n = inUse(id);
      if (n > 0) {
        throw new BadRequestError(n + (n === 1 ? " repair is " : " repairs are ") + existing[id].getString("name") + ": move " + (n === 1 ? "it" : "them") + " to another status first");
      }
      tx.delete(existing[id]);
    }
  });
  return statusesOf(app, org);
}

module.exports = {
  STAGES,
  COLOURS,
  DEFAULT_STATUSES,
  OPEN_FILTER,
  statusesOf,
  createDefaultStatuses,
  statusName,
  saveStatuses,
  openRepair,
  openRepairOf,
  updateRepair,
};
