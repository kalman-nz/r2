/// <reference path="../pb_data/types.d.ts" />
// Saved column configurations for the Inventory table — see
// pb_migrations/0016_equipment_views.js, 0017 and 0036 for the collection
// shape. Each is its owner's, shared with people they pick or with
// everyone (that takes views.publish), like dashboards (lib/sharing.js).

routerAdd(
  "GET",
  "/api/equipment-views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { VISIBLE, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const ctx = requireOrg(e);
    const records = $app.findRecordsByFilter("equipment_views", VISIBLE, "name", 0, 0, { org: ctx.orgId, me: e.auth.id });
    const names = namesFor($app, records);
    return e.json(200, records.map((r) => toViewJson(ctx, e.auth.id, r, names)));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/equipment-views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const ctx = requireOrg(e);
    const body = e.requestInfo().body || {};
    const record = new Record($app.findCollectionByNameOrId("equipment_views"), Object.assign({}, validateViewBody(body), { org: ctx.orgId, owner: e.auth.id }));
    applySharing($app, ctx, record, body);
    $app.save(record);
    return e.json(200, toViewJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/equipment-views/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit, applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const record = findOrNull($app, "equipment_views", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("View not found");
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    const body = e.requestInfo().body || {};
    const data = validateViewBody(body);
    for (const key in data) record.set(key, data[key]);
    applySharing($app, ctx, record, body);
    $app.save(record);
    return e.json(200, toViewJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/equipment-views/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit } = require(`${__hooks}/lib/sharing.js`);
    const record = findOrNull($app, "equipment_views", e.request.pathValue("id"));
    if (!record) return e.json(200, { ok: true });
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);
