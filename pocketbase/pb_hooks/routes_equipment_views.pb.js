/// <reference path="../pb_data/types.d.ts" />
// Saved column configurations for the Inventory table — see
// pb_migrations/0016_equipment_views.js and 0017_equipment_views_shared.js
// for the collection shape. Views belong to an organisation: listing returns
// your own views there plus any shared with the organisation;
// editing/sharing/deleting stays with the owner (checked in each handler).

routerAdd(
  "GET",
  "/api/equipment-views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const ctx = requireOrg(e);
    const records = $app.findRecordsByFilter("equipment_views", "org = {:org} && (owner = {:owner} || shared = true)", "name", 0, 0, {
      org: ctx.orgId,
      owner: e.auth.id,
    });
    const ownerIds = Array.from(new Set(records.map((r) => r.get("owner"))));
    const ownerNames = {};
    for (const o of $app.findRecordsByIds("users", ownerIds)) if (o) ownerNames[o.id] = o.get("name") || o.get("email");
    return e.json(200, records.map((r) => toViewJson(r, e.auth.id, ownerNames[r.get("owner")])));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/equipment-views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const ctx = requireOrg(e);
    const data = validateViewBody(e.requestInfo().body);
    const record = new Record($app.findCollectionByNameOrId("equipment_views"), Object.assign({}, data, { org: ctx.orgId, owner: e.auth.id }));
    $app.save(record);
    return e.json(200, toViewJson(record, e.auth.id, e.auth.get("name") || e.auth.get("email")));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/equipment-views/{id}",
  (e) => {
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const data = validateViewBody(e.requestInfo().body);
    const record = findOrNull($app, "equipment_views", e.request.pathValue("id"));
    if (!record || record.get("owner") !== e.auth.id) throw new NotFoundError("View not found");
    record.set("name", data.name);
    record.set("columns", data.columns);
    record.set("widths", data.widths);
    record.set("sortKey", data.sortKey);
    record.set("sortDir", data.sortDir);
    record.set("shared", data.shared);
    $app.save(record);
    return e.json(200, toViewJson(record, e.auth.id, e.auth.get("name") || e.auth.get("email")));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/equipment-views/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const record = findOrNull($app, "equipment_views", e.request.pathValue("id"));
    if (record && record.get("owner") === e.auth.id) $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);
