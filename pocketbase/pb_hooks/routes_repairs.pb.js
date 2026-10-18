/// <reference path="../pb_data/types.d.ts" />
// Repair jobs (lib/repairs.js). Opening and changing them needs units.flag,
// the same permission as marking a unit for repair by hand; anyone in the
// organisation can see them through the collection.

routerAdd(
  "POST",
  "/api/repairs",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { openRepair } = require(`${__hooks}/lib/repairs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "units.flag");
    const repair = openRepair($app, ctx.orgId, e.requestInfo().body || {}, e.auth);
    logEvent(ctx.orgId, "repair_open", whoName(e.auth), {
      repair: repair.id,
      number: repair.getInt("number"),
      item: repair.getString("item"),
      quantity: repair.getInt("quantity"),
      fault: repair.getString("fault"),
    });
    return e.json(200, repair);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/repairs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { updateRepair } = require(`${__hooks}/lib/repairs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const repair = findOrNull($app, "repairs", e.request.pathValue("id"));
    if (!repair) throw new NotFoundError("Repair not found");
    const ctx = requireRecordOrg(e, repair, "units.flag");
    const from = repair.getString("status");
    const saved = updateRepair($app, repair, e.requestInfo().body || {});
    if (saved.getString("status") !== from) {
      logEvent(ctx.orgId, "repair_status", whoName(e.auth), {
        repair: saved.id,
        number: saved.getInt("number"),
        from: from,
        to: saved.getString("status"),
      });
    }
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);
