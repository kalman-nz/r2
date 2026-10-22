/// <reference path="../pb_data/types.d.ts" />
// Warehouse routes any member can use, techs included: looking up a scanned
// code, scanning kit out/in against a job (lib/scan.js), and flagging gear
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
    const id = e.request.pathValue("id");
    const body = e.requestInfo().body || {};
    const ctx = requireRecordOrg(e, requireJob($app, id), body.direction === "in" ? "scan.in" : "scan.out");
    const result = scan(id, body, e.auth);
    logEvent(ctx.orgId, "scan_" + body.direction, whoName(e.auth), { job: id, code: String(body.code || ""), message: result.message });
    return e.json(200, { message: result.message, item: result.item, serial: result.serial, summary: buildSummary($app, id, summaryAccess(ctx)) });
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
