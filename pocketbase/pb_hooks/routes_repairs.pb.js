/// <reference path="../pb_data/types.d.ts" />
// Repair jobs (lib/repairs.js). Opening and changing them, files included,
// needs units.flag, the same permission as flagging a unit lost by hand;
// anyone in the organisation can see them (and open their files) through
// the collection.

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
    const { statusName } = require(`${__hooks}/lib/repairs.js`);
    const ctx = requireRecordOrg(e, repair, "units.flag");
    const from = repair.getString("status");
    const saved = updateRepair($app, repair, e.requestInfo().body || {});
    if (saved.getString("status") !== from) {
      // Names, not ids: the history should read the same after a rename.
      logEvent(ctx.orgId, "repair_status", whoName(e.auth), {
        repair: saved.id,
        number: saved.getInt("number"),
        from: statusName($app, from),
        to: statusName($app, saved.getString("status")),
      });
    }
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);

// Files (photos, a repairer's report, quotes, POs): multipart, as "files".
// The web app sends one per request, so each can fail on its own; the body
// limit is one file at the field's size plus room for the form around it.
routerAdd(
  "POST",
  "/api/repairs/{id}/files",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { addFiles, uploadedFiles } = require(`${__hooks}/lib/files.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const repair = findOrNull($app, "repairs", e.request.pathValue("id"));
    if (!repair) throw new NotFoundError("Repair not found");
    const ctx = requireRecordOrg(e, repair, "units.flag");
    const files = uploadedFiles(e);
    const saved = addFiles($app, "repairs", repair.id, files, whoName(e.auth));
    logEvent(ctx.orgId, "repair_files", whoName(e.auth), {
      repair: repair.id,
      number: repair.getInt("number"),
      added: files.map((f) => f.originalName),
    });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
  $apis.bodyLimit(26 * 1024 * 1024),
);

routerAdd(
  "DELETE",
  "/api/repairs/{id}/files/{name}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { removeFile } = require(`${__hooks}/lib/files.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const repair = findOrNull($app, "repairs", e.request.pathValue("id"));
    if (!repair) throw new NotFoundError("Repair not found");
    const ctx = requireRecordOrg(e, repair, "units.flag");
    const removed = removeFile($app, "repairs", repair.id, e.request.pathValue("name"));
    logEvent(ctx.orgId, "repair_file_removed", whoName(e.auth), { repair: repair.id, number: repair.getInt("number"), name: removed.name });
    return e.json(200, removed.record);
  },
  $apis.requireAuth("users"),
);

// What's happened on a repair, oldest first, from the organisation's
// activity log: opened, status changes, files added and removed. Anyone who
// can see the repair can see this.
routerAdd(
  "GET",
  "/api/repairs/{id}/activity",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const repair = findOrNull($app, "repairs", e.request.pathValue("id"));
    if (!repair) throw new NotFoundError("Repair not found");
    const ctx = requireRecordOrg(e, repair);
    const records = $app.findRecordsByFilter("logs", "org = {:org} && details.repair = {:id}", "createdAt", 500, 0, { org: ctx.orgId, id: repair.id });
    const rows = records.map((r) => ({ id: r.id, type: r.get("type"), who: r.get("who"), createdAt: r.get("createdAt"), details: r.get("details") }));
    return e.json(200, summarizeLogs(rows));
  },
  $apis.requireAuth("users"),
);

// The organisation's repair statuses, in order (lib/repairs.js
// saveStatuses): { statuses: [{ id?, name, stage, colour, isDefault }] }.
routerAdd(
  "PUT",
  "/api/repair-statuses",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { saveStatuses } = require(`${__hooks}/lib/repairs.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    const saved = saveStatuses($app, ctx.orgId, (e.requestInfo().body || {}).statuses);
    logEvent(ctx.orgId, "repair_statuses", whoName(e.auth), { names: saved.map((s) => s.getString("name")) });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);
