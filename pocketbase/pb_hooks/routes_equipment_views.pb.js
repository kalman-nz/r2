/// <reference path="../pb_data/types.d.ts" />
// Saved column configurations for the Assets table — see
// pb_migrations/0016_equipment_views.js and 0017_equipment_views_shared.js
// for the collection shape. Listing returns a user's own views plus any
// view someone has shared with everyone; editing/sharing/deleting a view
// stays restricted to its owner (checked in each handler below).
(function () {
routerAdd(
  "GET",
  "/api/equipment-views",
  (e) => {
    const { toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const records = $app.findRecordsByFilter(
      "equipment_views",
      "owner = {:owner} || shared = true",
      "name",
      0,
      0,
      { owner: e.auth.id },
    );
    const ownerIds = Array.from(new Set(records.map((r) => r.get("owner"))));
    const owners = $app.findRecordsByIds("users", ownerIds);
    const ownerNames = {};
    for (const o of owners) if (o) ownerNames[o.id] = o.get("name") || o.get("email");
    return e.json(200, records.map((r) => toViewJson(r, e.auth.id, ownerNames[r.get("owner")])));
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/equipment-views",
  (e) => {
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const data = validateViewBody(e.requestInfo().body);
    const collection = $app.findCollectionByNameOrId("equipment_views");
    const record = new Record(collection, Object.assign({}, data, { owner: e.auth.id }));
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    return e.json(200, toViewJson(record, e.auth.id, who));
  },
  $apis.requireAuth(),
);

routerAdd(
  "PUT",
  "/api/equipment-views/{id}",
  (e) => {
    const { validateViewBody, toViewJson } = require(`${__hooks}/lib/equipmentViews.js`);
    const data = validateViewBody(e.requestInfo().body);
    let record;
    try {
      record = $app.findRecordById("equipment_views", e.request.pathValue("id"));
    } catch (err) {
      throw new NotFoundError("View not found");
    }
    if (record.get("owner") !== e.auth.id) throw new NotFoundError("View not found");
    record.set("name", data.name);
    record.set("columns", data.columns);
    record.set("widths", data.widths);
    record.set("sortKey", data.sortKey);
    record.set("sortDir", data.sortDir);
    record.set("shared", data.shared);
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    return e.json(200, toViewJson(record, e.auth.id, who));
  },
  $apis.requireAuth(),
);

routerAdd(
  "DELETE",
  "/api/equipment-views/{id}",
  (e) => {
    let record;
    try {
      record = $app.findRecordById("equipment_views", e.request.pathValue("id"));
    } catch (err) {
      record = null;
    }
    if (record && record.get("owner") === e.auth.id) $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
})();
