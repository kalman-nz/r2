// Equipment tracking: scanning kit to a step on a job — prepped, loaded,
// returned, or whatever the organisation calls its steps (lib/tracking.js).
// Rules, all checked server-side so two scanners can't disagree:
// - a serialised unit can't be with two projects at once, or go while it's
//   flagged repair/lost/retired
// - nothing goes beyond what the job needs (extra kit has to be added to
//   the job first)
// - a unit only comes back in on the job it went out on
// - enquiries, cancelled and returned jobs don't send kit out
// Kit can skip steps (straight from the shelf to the truck), and a unit can
// go back a step (unloaded to the bay). Once everything's reached a step
// that names a project status, the scan page offers it (lib/tracking.js
// suggestion); the project's status never changes by itself.
const { findOrNull } = require("./records.js");
const { typedCode } = require("./codes.js");
const jobs = require("./jobs.js");
const tracking = require("./tracking.js");

const NO_SCAN_OUT_STATUSES = ["enquiry", "cancelled", "returned"];

// Serial barcodes first (one code = one unit), then bulk item barcodes —
// only within one organisation (two organisations can use the same codes).
function lookupCode(app, org, code) {
  const c = typedCode(code);
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

// What the job needs of each physical item, across all its lines.
function needsOf(lines, itemsById) {
  const needs = {};
  for (const line of lines) {
    const item = itemsById[line.getString("item")];
    if (item && item.getString("kind") === "item") needs[item.id] = (needs[item.id] || 0) + Math.round(line.getFloat("quantity"));
  }
  return needs;
}

// body: { code, step (a tracking step's id; or the old direction: "out" |
// "in"), quantity? (bulk only) }. Returns { message, item, serial, stage }:
// a short message saying what happened, what was scanned (serial is "" for
// bulk) and the step's stage, so the scan page can offer to report a fault
// with what came back.
function scan(jobId, body, auth) {
  let message = "";
  let scanned = { item: "", serial: "", stage: "" };

  $app.runInTransaction((tx) => {
    const job = jobs.requireJob(tx, jobId);
    const steps = tracking.stepsOf(tx, job.getString("org"));
    const step = tracking.stepFor(steps, body);
    const stage = step.getString("stage");
    const going = stage !== "back";
    if (going && NO_SCAN_OUT_STATUSES.indexOf(job.getString("status")) !== -1) {
      throw new BadRequestError("This project is " + job.getString("status") + ", so nothing can go out on it");
    }
    const found = lookupCode(tx, job.getString("org"), body.code);
    if (!found) throw new NotFoundError("Nothing has the code " + String(body.code || "").trim());
    if (!found.item) throw new NotFoundError("That code's item no longer exists");

    const lines = jobs.loadLines(tx, job.id);
    const itemsById = jobs.loadItems(tx, lines);
    const needs = needsOf(lines, itemsById);
    const state = tracking.trackingState(tx, job.id, needs, itemsById, steps);
    const item = found.item;
    scanned = { item: item.id, serial: found.kind === "serial" ? found.serial.id : "", stage: stage };
    const info = state.items.find((p) => p.itemId === item.id) || { needed: 0, out: 0, active: {} };
    const rank = {};
    steps.forEach((s, i) => (rank[s.id] = i + 1));
    const scans = tx.findCollectionByNameOrId("scans");
    const save = (fields) =>
      tx.save(new Record(scans, Object.assign({ org: job.getString("org"), job: job.id, item: item.id, who: auth ? auth.id : "", step: step.id }, fields)));
    let what = "";

    if (found.kind === "serial") {
      const serial = found.serial;
      what = serialName(serial, item);
      const latest = latestScanOf(tx, serial.id);
      const isOut = !!latest && latest.getString("direction") !== "in";
      const here = isOut && latest.getString("job") === job.id;
      // Where it is on this job (scans from before steps count as the first gone one).
      const current = here ? (rank[latest.getString("step")] ? latest.getString("step") : (steps.find((s) => s.getString("stage") === "out") || step).id) : "";
      if (going) {
        if (isOut && !here) {
          const other = findOrNull(tx, "jobs", latest.getString("job"));
          throw new BadRequestError(what + " is still with project " + (other ? "#" + other.getInt("number") : "(deleted)") + " — bring it back on that first");
        }
        if (here) {
          if (current === step.id) throw new BadRequestError(what + " is already " + step.getString("name"));
          save({ serial: serial.id, quantity: 1, direction: "move", fromStep: current });
        } else {
          if (serial.getString("status") !== "active") throw new BadRequestError(what + " is flagged " + serial.getString("status") + " and can't go out");
          if (!info.needed) throw new BadRequestError(item.getString("name") + " isn't on this project");
          if (info.out >= info.needed) throw new BadRequestError("All " + info.needed + " × " + item.getString("name") + " are already with this project");
          save({ serial: serial.id, quantity: 1, direction: "out", fromStep: "" });
        }
      } else {
        if (!here) throw new BadRequestError(what + " isn't out on this project");
        save({ serial: serial.id, quantity: 1, direction: "in", fromStep: current });
      }
    } else {
      if (item.getString("kind") === "kit") throw new BadRequestError("Kits aren't scanned as a whole — scan what's in them");
      if (item.getString("tracking") === "serial") {
        throw new BadRequestError("That's the code for " + item.getString("name") + " as a type — scan the unit's own barcode");
      }
      const qty = body.quantity === undefined || body.quantity === null || body.quantity === "" ? 1 : Number(body.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new BadRequestError("Quantity must be a whole number, 1 or more");
      what = qty + " × " + item.getString("name");
      const active = info.active || {};
      // Furthest along first.
      const activeSteps = Object.keys(active)
        .filter((id) => active[id] > 0)
        .sort((a, b) => rank[b] - rank[a]);
      const moves = [];
      let left = qty;
      if (going) {
        if (!info.needed) throw new BadRequestError(item.getString("name") + " isn't on this project");
        // From the steps before this one, then from stock.
        for (const from of activeSteps) {
          if (rank[from] >= rank[step.id] || left === 0) continue;
          const n = Math.min(left, active[from]);
          moves.push({ from: from, n: n });
          left -= n;
        }
        const n = Math.min(left, Math.max(0, info.needed - info.out));
        if (n > 0) moves.push({ from: "", n: n });
        left -= n;
        if (left > 0) {
          const possible = qty - left;
          throw new BadRequestError(
            possible === 0
              ? "All " + info.needed + " × " + item.getString("name") + " are already " + step.getString("name") + " or further along"
              : "Only " + possible + " more " + item.getString("name") + " can be " + step.getString("name"),
          );
        }
      } else {
        if (qty > info.out) throw new BadRequestError("Only " + info.out + " × " + item.getString("name") + " are out");
        for (const from of activeSteps) {
          if (left === 0) break;
          const n = Math.min(left, active[from]);
          moves.push({ from: from, n: n });
          left -= n;
        }
      }
      for (const m of moves) save({ quantity: m.n, direction: !going ? "in" : m.from ? "move" : "out", fromStep: m.from });
    }

    const after = tracking.trackingState(tx, job.id, needs, itemsById, steps);
    const reached = tracking.reachedCount(after, item.id, step, steps);
    message = what + " → " + step.getString("name") + " (" + reached + " of " + (needs[item.id] || 0) + ")";
  });
  return { message: message, item: scanned.item, serial: scanned.serial, stage: scanned.stage };
}

module.exports = { lookupCode, needsOf, scan };
