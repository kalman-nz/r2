// Repair jobs (pb_migrations/0028_repairs.js has the model). Opening one
// takes the kit out of service and closing it puts it back or retires it,
// in the same transaction as the repair itself, so stock and repairs can't
// disagree.

const OPEN = ["open", "in_progress"];
const STATUSES = ["open", "in_progress", "completed", "written_off"];

function isOpen(status) {
  return OPEN.indexOf(status) !== -1;
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

// The units on open repairs other than `exceptId`, as { serialId: number }.
function unitsUnderRepair(tx, org, exceptId) {
  const busy = {};
  const open = tx.findRecordsByFilter("repairs", "org = {:org} && (status = 'open' || status = 'in_progress') && id != {:id}", "", 0, 0, {
    org: org,
    id: exceptId || "",
  });
  for (const r of open) for (const s of r.getStringSlice("serials")) busy[s] = r.getInt("number");
  return busy;
}

// body: { item, serials: [ids] (serialised) | quantity (bulk), fault,
// repairer, dueAt, notes }. Returns the new repair.
function openRepair(app, org, body, who) {
  const fault = text(body.fault, 2000);
  if (!fault) throw new BadRequestError("Say what's wrong with it");
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

    const collection = tx.findCollectionByNameOrId("repairs");
    repair = new Record(collection, {
      org: org,
      item: item.id,
      status: "open",
      fault: fault,
      repairer: text(body.repairer, 200),
      dueAt: text(body.dueAt, 40),
      notes: text(body.notes, 5000),
      createdBy: who ? who.id : "",
    });

    if (item.getString("tracking") === "serial") {
      const ids = Array.isArray(body.serials) ? body.serials.map(String) : [];
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
      if (qty > usable) throw new BadRequestError("Only " + usable + " of " + item.getString("name") + " are in service");
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

// Puts a closed repair's kit back in service (fixed) or retires it
// (written off). Units someone has since marked lost or retired are left.
function release(tx, repair, writtenOff) {
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
      unit.set("status", writtenOff ? "retired" : "active");
      tx.save(unit);
    }
  } else {
    const qty = repair.getInt("quantity");
    item.set("outOfServiceQty", Math.max(0, item.getInt("outOfServiceQty") - qty));
    if (writtenOff) item.set("stockQty", Math.max(0, item.getInt("stockQty") - qty));
    tx.save(item);
  }
}

// body: any of { fault, repairer, cost, dueAt, notes, status }. A closed
// repair's details can still be filled in, but it can't be reopened: its
// kit is already back (or gone).
function updateRepair(app, repair, body) {
  app.runInTransaction((tx) => {
    const record = tx.findRecordById("repairs", repair.id);
    if (body.fault !== undefined) {
      const fault = text(body.fault, 2000);
      if (!fault) throw new BadRequestError("Say what's wrong with it");
      record.set("fault", fault);
    }
    if (body.repairer !== undefined) record.set("repairer", text(body.repairer, 200));
    if (body.cost !== undefined) record.set("cost", money(body.cost, "Cost"));
    if (body.dueAt !== undefined) record.set("dueAt", text(body.dueAt, 40));
    if (body.notes !== undefined) record.set("notes", text(body.notes, 5000));

    const from = record.getString("status");
    const to = body.status === undefined ? from : String(body.status);
    if (STATUSES.indexOf(to) === -1) throw new BadRequestError("Invalid status");
    if (to !== from) {
      if (!isOpen(from)) throw new BadRequestError("This repair is closed. Start a new one if it's broken again");
      if (!isOpen(to)) {
        release(tx, record, to === "written_off");
        record.set("closedAt", new Date().toISOString());
      }
      record.set("status", to);
    }
    tx.save(record);
  });
  return app.findRecordById("repairs", repair.id);
}

module.exports = { OPEN, STATUSES, isOpen, openRepair, updateRepair };
