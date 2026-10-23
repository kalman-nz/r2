/// <reference path="../pb_data/types.d.ts" />
// Warehouse routes any member can use, techs included: looking up a scanned
// code, tracking kit to a step on a job (lib/scan.js), and flagging gear
// as broken. Flagging goes through here rather than the REST API so techs
// can do it without being able to edit the rest of an item or serial.

// For a handheld barcode/QR scanner (acts as a keyboard: types the scanned
// value, then Enter) or the camera scanner. Serial codes win over bulk item
// codes; the validation hooks keep the two from colliding. Only the current
// organisation's codes are searched.
routerAdd(
  "GET",
  "/api/lookup",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { lookupCode } = require(`${__hooks}/lib/scan.js`);
    const ctx = requireOrg(e);
    const code = (e.requestInfo().query.code || "").trim();
    if (!code) throw new BadRequestError("Missing code");
    const found = lookupCode($app, ctx.orgId, code);
    if (!found) throw new NotFoundError("Nothing has the code " + code);
    if (found.kind === "serial") return e.json(200, { kind: "serial", id: found.serial.id, itemId: found.serial.getString("item") });
    return e.json(200, { kind: "item", id: found.item.id, itemId: found.item.id });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/jobs/{id}/scan",
  (e) => {
    const { scan } = require(`${__hooks}/lib/scan.js`);
    const { buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { stepFor, stepsOf } = require(`${__hooks}/lib/tracking.js`);
    const id = e.request.pathValue("id");
    const body = e.requestInfo().body || {};
    const job = requireJob($app, id);
    // Bringing kit back is its own permission; every other step sends it out.
    const back = stepFor(stepsOf($app, job.getString("org")), body).getString("stage") === "back";
    const ctx = requireRecordOrg(e, job, back ? "scan.in" : "scan.out");
    const result = scan(id, body, e.auth);
    logEvent(ctx.orgId, back ? "scan_in" : "scan_out", whoName(e.auth), { job: id, code: String(body.code || ""), message: result.message });
    return e.json(200, { message: result.message, item: result.item, serial: result.serial, stage: result.stage, summary: buildSummary($app, id, summaryAccess(ctx)) });
  },
  $apis.requireAuth("users"),
);

// Takes up the status equipment tracking suggests (lib/tracking.js
// suggestion): everything's Loaded, so the project's Out. Anyone who can
// track kit can do this, but only to the status the kit's reached.
// body: { status }.
routerAdd(
  "POST",
  "/api/jobs/{id}/tracking-status",
  (e) => {
    const { buildSummary, loadItems, loadLines, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const { needsOf } = require(`${__hooks}/lib/scan.js`);
    const { stepsOf, suggestion, trackingState } = require(`${__hooks}/lib/tracking.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const job = requireJob($app, e.request.pathValue("id"));
    let ctx = requireRecordOrg(e, job);
    if (!ctx.can("scan.out") && !ctx.can("scan.in")) ctx = requireRecordOrg(e, job, "scan.out");
    const lines = loadLines($app, job.id);
    const itemsById = loadItems($app, lines);
    const steps = stepsOf($app, ctx.orgId);
    const offered = suggestion($app, job, trackingState($app, job.id, needsOf(lines, itemsById), itemsById, steps), steps);
    const status = (e.requestInfo().body || {}).status;
    if (!offered || offered.status !== status) throw new BadRequestError("The kit isn't all at a step for that status");
    job.set("jobStatus", status);
    $app.save(job);
    logEvent(ctx.orgId, "job_status_tracked", whoName(e.auth), { job: job.id, status: offered.statusName, step: offered.stepName });
    return e.json(200, buildSummary($app, job.id, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

// The equipment tracking board: every tracked project that's on its way out,
// out, or back in the last fortnight, with how many units it needs and how
// many are at each step (lib/tracking.js), soonest first.
routerAdd(
  "GET",
  "/api/tracking/projects",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireFeature } = require(`${__hooks}/lib/features.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { loadItems, loadLines } = require(`${__hooks}/lib/jobs.js`);
    const { needsOf } = require(`${__hooks}/lib/scan.js`);
    const { outstandingByJob, stepsOf, suggestion, trackingState } = require(`${__hooks}/lib/tracking.js`);
    const ctx = requireOrg(e);
    requireFeature(ctx.org, "scanning");
    const since = new Date(Date.now() - 14 * 86400000).toISOString().replace("T", " ");
    const jobs = $app.findRecordsByFilter(
      "jobs",
      "org = {:org} && (status = 'provisional' || status = 'confirmed' || status = 'out' || (status = 'returned' && returnAt >= {:since}))",
      "prepAt",
      300,
      0,
      { org: ctx.orgId, since: since },
    );
    // Returned a while ago but with kit still to come back: overdue, so
    // they stay here to be scanned in.
    const listed = {};
    for (const job of jobs) listed[job.id] = true;
    const outstanding = outstandingByJob($app, ctx.orgId);
    const late = Object.keys(outstanding).filter((id) => !listed[id] && outstanding[id].status === "returned");
    for (const job of $app.findRecordsByIds("jobs", late)) if (job) jobs.push(job);
    const steps = stepsOf($app, ctx.orgId);
    const clients = {};
    const out = [];
    for (const job of jobs) {
      const lines = loadLines($app, job.id);
      const itemsById = loadItems($app, lines);
      const state = trackingState($app, job.id, needsOf(lines, itemsById), itemsById, steps);
      const at = {};
      let needed = 0;
      for (const item of state.items) {
        needed += item.needed;
        for (const step of Object.keys(item.at)) at[step] = (at[step] || 0) + item.at[step];
      }
      const clientId = job.getString("client");
      if (clientId && clients[clientId] === undefined) {
        const client = findOrNull($app, "contacts", clientId);
        clients[clientId] = client ? client.getString("name") : "";
      }
      const offered = suggestion($app, job, state, steps);
      out.push({
        id: job.id,
        number: job.getInt("number"),
        name: job.getString("name"),
        status: job.getString("status"),
        jobStatus: job.getString("jobStatus"),
        client: clientId ? clients[clientId] : "",
        prepAt: job.getString("prepAt"),
        returnAt: job.getString("returnAt"),
        needed: needed,
        at: at,
        suggestion: offered ? offered.statusName : "",
      });
    }
    return e.json(200, out);
  },
  $apis.requireAuth("users"),
);

// Replaces the organisation's tracking steps (Settings → Equipment
// tracking, lib/tracking.js). body: { steps: [{ id?, name, stage, colour,
// jobStatus }] }.
routerAdd(
  "PUT",
  "/api/tracking-steps",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireFeature } = require(`${__hooks}/lib/features.js`);
    const { saveSteps } = require(`${__hooks}/lib/tracking.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    requireFeature(ctx.org, "scanning");
    const saved = saveSteps($app, ctx.orgId, (e.requestInfo().body || {}).steps);
    logEvent(ctx.orgId, "tracking_steps", whoName(e.auth), { names: saved.map((s) => s.getString("name")) });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/serials/{id}/status",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { openRepairOf } = require(`${__hooks}/lib/repairs.js`);
    const serial = findOrNull($app, "serials", e.request.pathValue("id"));
    if (!serial) throw new NotFoundError("Unit not found");
    const ctx = requireRecordOrg(e, serial, "units.flag");
    const body = e.requestInfo().body || {};
    if (["active", "repair", "lost", "retired"].indexOf(body.status) === -1) throw new BadRequestError("Invalid status");
    const previous = serial.getString("status");
    // With repairs on, In repair comes from opening a repair and goes when
    // it's repaired, so the repair and the unit can't disagree (lost or
    // retired can still be set while it's away: ending the repair leaves
    // those alone). With repairs off it's a plain flag.
    if (ctx.features.repairs) {
      if (body.status === "repair" && previous !== "repair") throw new BadRequestError("Open a repair to take it out of service");
      const repair = body.status === "active" ? openRepairOf($app, serial.id) : null;
      if (repair) throw new BadRequestError("It's on repair R" + repair.getInt("number") + ": mark that repaired to put it back in service");
    }
    serial.set("status", body.status);
    if (typeof body.note === "string" && body.note.trim()) {
      const stamp = new Date().toISOString().slice(0, 10) + " " + whoName(e.auth) + ": ";
      const notes = serial.getString("notes");
      serial.set("notes", (notes ? notes + "\n" : "") + stamp + body.note.trim());
    }
    $app.save(serial);
    logEvent(ctx.orgId, "serial_status", whoName(e.auth), {
      serial: serial.id,
      barcode: serial.getString("barcode"),
      from: previous,
      to: body.status,
      note: body.note || "",
    });
    return e.json(200, serial);
  },
  $apis.requireAuth("users"),
);

// Bulk stock can't be flagged unit by unit, so it's a count of units out
// of service (broken, away for repair).
routerAdd(
  "POST",
  "/api/items/{id}/out-of-service",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const item = findOrNull($app, "items", e.request.pathValue("id"));
    if (!item) throw new NotFoundError("Item not found");
    const ctx = requireRecordOrg(e, item, "units.flag");
    if (item.getString("tracking") !== "bulk") throw new BadRequestError("Only bulk items have an out-of-service count");
    const body = e.requestInfo().body || {};
    const qty = Number(body.quantity);
    if (!Number.isInteger(qty) || qty < 0) throw new BadRequestError("Quantity must be a whole number, 0 or more");
    // Repairs keep their kit out of service until they're repaired (or not).
    const { OPEN_FILTER } = require(`${__hooks}/lib/repairs.js`);
    let repairing = 0;
    for (const r of $app.findRecordsByFilter("repairs", "item = {:item} && " + OPEN_FILTER, "", 0, 0, { item: item.id })) {
      repairing += r.getInt("quantity");
    }
    if (qty < repairing) throw new BadRequestError(repairing + " are on open repairs: mark those repaired to put them back in service");
    const previous = item.getInt("outOfServiceQty");
    item.set("outOfServiceQty", qty);
    $app.save(item);
    logEvent(ctx.orgId, "item_out_of_service", whoName(e.auth), { item: item.id, name: item.getString("name"), from: previous, to: qty, note: body.note || "" });
    return e.json(200, item);
  },
  $apis.requireAuth("users"),
);
