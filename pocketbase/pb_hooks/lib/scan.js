// Scanning kit out to a job and back in (the warehouse side of a job).
// Rules, all checked server-side so two scanners can't disagree:
// - a serialised unit can't go out twice, or while it's still out on
//   another job, or while it's flagged repair/lost/retired
// - nothing goes out beyond what the job needs (extra kit has to be added
//   to the job first)
// - a unit only comes back in on the job it went out on
// - enquiries, cancelled and returned jobs don't send kit out
// The first scan out moves a provisional/confirmed job to "out".
const { findOrNull } = require("./records.js");
const jobs = require("./jobs.js");

const NO_SCAN_OUT_STATUSES = ["enquiry", "cancelled", "returned"];

// Serial barcodes first (one code = one unit), then bulk item barcodes —
// only within one organisation (two organisations can use the same codes).
function lookupCode(app, org, code) {
  const c = String(code || "").trim();
  if (!c || !org) return null;
  const serial = app.findRecordsByFilter("serials", "org = {:org} && barcode = {:c}", "", 1, 0, { org: org, c: c })[0];
  if (serial) return { kind: "serial", serial: serial, item: findOrNull(app, "items", serial.getString("item")) };
  const item = app.findRecordsByFilter("items", "org = {:org} && barcode = {:c}", "", 1, 0, { org: org, c: c })[0];
  if (item) return { kind: "item", item: item };
  return null;
}

function latestScanOf(app, serialId) {
  return app.findRecordsByFilter("scans", "serial = {:s}", "-created", 1, 0, { s: serialId })[0] || null;
}

function serialName(serial, item) {
  const label = serial.getString("label") || serial.getString("barcode");
  return item.getString("name") + (label ? " (" + label + ")" : "");
}

// body: { code, direction: "out" | "in", quantity? (bulk only) }
// Returns a short message saying what happened.
function scan(jobId, body, auth) {
  const direction = body.direction;
  if (direction !== "out" && direction !== "in") throw new BadRequestError("direction must be out or in");
  let message = "";

  $app.runInTransaction((tx) => {
    const job = jobs.requireJob(tx, jobId);
    if (direction === "out" && NO_SCAN_OUT_STATUSES.indexOf(job.getString("status")) !== -1) {
      throw new BadRequestError("This job is " + job.getString("status") + ", so nothing can go out on it");
    }
    const found = lookupCode(tx, job.getString("org"), body.code);
    if (!found) throw new NotFoundError("Nothing has the code " + String(body.code || "").trim());
    if (!found.item) throw new NotFoundError("That code's item no longer exists");

    const lines = jobs.loadLines(tx, job.id);
    const itemsById = jobs.loadItems(tx, lines);
    const needs = {};
    for (const line of lines) {
      const item = itemsById[line.getString("item")];
      if (item && item.getString("kind") === "item") {
        needs[item.id] = (needs[item.id] || 0) + Math.round(line.getFloat("quantity"));
      }
    }
    const packing = jobs.packingState(tx, job.id, needs, itemsById);
    const item = found.item;
    const state = packing.items.find((p) => p.itemId === item.id) || { needed: 0, out: 0 };
    const scans = tx.findCollectionByNameOrId("scans");
    const record = { org: job.getString("org"), job: job.id, item: item.id, direction: direction, who: auth ? auth.id : "" };

    if (found.kind === "serial") {
      const serial = found.serial;
      const name = serialName(serial, item);
      const latest = latestScanOf(tx, serial.id);
      if (direction === "out") {
        if (serial.getString("status") !== "active") {
          throw new BadRequestError(name + " is flagged " + serial.getString("status") + " and can't go out");
        }
        if (latest && latest.getString("direction") === "out") {
          if (latest.getString("job") === job.id) throw new BadRequestError(name + " is already out on this job");
          const other = findOrNull(tx, "jobs", latest.getString("job"));
          throw new BadRequestError(name + " is still out on job " + (other ? "#" + other.getInt("number") : "(deleted)") + " — scan it back in first");
        }
        if (!state.needed) throw new BadRequestError(item.getString("name") + " isn't on this job");
        if (state.out >= state.needed) throw new BadRequestError("All " + state.needed + " × " + item.getString("name") + " are already out");
        record.serial = serial.id;
        record.quantity = 1;
        tx.save(new Record(scans, record));
        message = name + " out (" + (state.out + 1) + " of " + state.needed + ")";
      } else {
        if (!latest || latest.getString("direction") !== "out" || latest.getString("job") !== job.id) {
          throw new BadRequestError(name + " isn't out on this job");
        }
        record.serial = serial.id;
        record.quantity = 1;
        tx.save(new Record(scans, record));
        message = name + " back in (" + (state.out - 1) + " still out)";
      }
    } else {
      if (item.getString("kind") === "kit") throw new BadRequestError("Kits aren't scanned as a whole — scan what's in them");
      if (item.getString("tracking") === "serial") {
        throw new BadRequestError("That's the code for " + item.getString("name") + " as a type — scan the unit's own barcode");
      }
      const qty = body.quantity === undefined || body.quantity === null || body.quantity === "" ? 1 : Number(body.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new BadRequestError("Quantity must be a whole number, 1 or more");
      if (direction === "out") {
        if (!state.needed) throw new BadRequestError(item.getString("name") + " isn't on this job");
        if (state.out + qty > state.needed) {
          throw new BadRequestError("Only " + Math.max(0, state.needed - state.out) + " more " + item.getString("name") + " needed");
        }
        record.quantity = qty;
        tx.save(new Record(scans, record));
        message = qty + " × " + item.getString("name") + " out (" + (state.out + qty) + " of " + state.needed + ")";
      } else {
        if (qty > state.out) throw new BadRequestError("Only " + state.out + " × " + item.getString("name") + " are out");
        record.quantity = qty;
        tx.save(new Record(scans, record));
        message = qty + " × " + item.getString("name") + " back in (" + (state.out - qty) + " still out)";
      }
    }

    if (direction === "out" && (job.getString("status") === "provisional" || job.getString("status") === "confirmed")) {
      job.set("status", "out");
      tx.save(job);
    }
  });
  return message;
}

module.exports = { lookupCode, scan };
