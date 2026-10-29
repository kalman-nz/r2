/// <reference path="../pb_data/types.d.ts" />
// Files on a unit (the PO, invoice, warranty, manual): multipart, as
// "files", one per request like a repair's (routes_repairs.pb.js).

routerAdd(
  "POST",
  "/api/serials/{id}/files",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { addFiles, uploadedFiles } = require(`${__hooks}/lib/files.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const serial = findOrNull($app, "serials", e.request.pathValue("id"));
    if (!serial) throw new NotFoundError("Unit not found");
    const ctx = requireRecordOrg(e, serial, "units.edit");
    const files = uploadedFiles(e);
    const saved = addFiles($app, "serials", serial.id, files, whoName(e.auth));
    logEvent(ctx.orgId, "serial_files", whoName(e.auth), {
      serial: serial.id,
      barcode: serial.getString("barcode"),
      added: files.map((f) => f.originalName),
    });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
  $apis.bodyLimit(26 * 1024 * 1024),
);

routerAdd(
  "DELETE",
  "/api/serials/{id}/files/{name}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { removeFile } = require(`${__hooks}/lib/files.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const serial = findOrNull($app, "serials", e.request.pathValue("id"));
    if (!serial) throw new NotFoundError("Unit not found");
    const ctx = requireRecordOrg(e, serial, "units.edit");
    const removed = removeFile($app, "serials", serial.id, e.request.pathValue("name"));
    logEvent(ctx.orgId, "serial_file_removed", whoName(e.auth), { serial: serial.id, barcode: serial.getString("barcode"), name: removed.name });
    return e.json(200, removed.record);
  },
  $apis.requireAuth("users"),
);
