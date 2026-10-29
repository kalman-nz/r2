/// <reference path="../pb_data/types.d.ts" />
// Label templates belong to an organisation. Any member can list and read
// them (printing needs them); creating, editing and deleting is for the
// organisation's admins, same as the Settings > Label templates page that's
// the only way to reach those actions.
//
// Every route HANDLER in this directory does its own require() at the top
// of its own function body — PocketBase's JSVM does not keep a handler's
// outer lexical scope alive when it actually runs a request (only its own
// body + true globals survive), so anything it needs must be re-required or
// re-declared inline every time. Anything captured from an enclosing scope
// in a *.pb.js file (even inside an IIFE) throws "X is not defined" at
// request time. require() is registry-cached, so calling it repeatedly is
// cheap. Every *.pb.js file in this directory follows this.

routerAdd(
  "GET",
  "/api/labels",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const ctx = requireOrg(e);
    const records = $app.findRecordsByFilter("label_templates", "org = {:org}", "name", 0, 0, { org: ctx.orgId });
    return e.json(200, records.map(toLabelJson));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/labels/{id}",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const record = findOrNull($app, "label_templates", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("Template not found");
    requireRecordOrg(e, record);
    return e.json(200, toLabelJson(record));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/labels",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { validateTemplateBody, toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "templates.create");
    const data = validateTemplateBody(e.requestInfo().body);
    const record = new Record($app.findCollectionByNameOrId("label_templates"), Object.assign({ org: ctx.orgId }, data));
    $app.save(record);
    logEvent(ctx.orgId, "label_created", e.auth.get("name") || e.auth.get("email"), { id: record.id, name: record.get("name") });
    return e.json(200, toLabelJson(record));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/labels/{id}",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { validateTemplateBody, toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const record = findOrNull($app, "label_templates", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("Template not found");
    const ctx = requireRecordOrg(e, record, "templates.edit");
    const data = validateTemplateBody(e.requestInfo().body);
    record.set("name", data.name);
    record.set("widthMm", data.widthMm);
    record.set("heightMm", data.heightMm);
    record.set("sizeId", data.sizeId);
    record.set("elements", data.elements);
    $app.save(record);
    logEvent(ctx.orgId, "label_updated", e.auth.get("name") || e.auth.get("email"), { id: record.id, name: record.get("name") });
    return e.json(200, toLabelJson(record));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/labels/{id}",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const record = findOrNull($app, "label_templates", e.request.pathValue("id"));
    if (!record) return e.json(200, { ok: true });
    const ctx = requireRecordOrg(e, record, "templates.delete");
    $app.delete(record);
    logEvent(ctx.orgId, "label_deleted", e.auth.get("name") || e.auth.get("email"), { id: record.id, name: record.get("name") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);
