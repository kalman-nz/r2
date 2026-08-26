/// <reference path="../pb_data/types.d.ts" />
// requireAdmin is only ever referenced immediately (as a routerAdd argument,
// resolved once at file-load/registration time), so it's safe as a
// file-scoped const — wrapped in an IIFE purely to avoid colliding with the
// same const name in the other routes_*.pb.js files (every *.pb.js file
// shares one concatenated top-level scope at boot).
//
// Every route HANDLER below, on the other hand, does its own require() at
// the top of its own function body — PocketBase's JSVM does not keep a
// handler's outer lexical scope alive when it actually runs a request (only
// its own body + true globals survive), so anything it needs must be
// re-required or re-declared inline every time. See routes_assets.pb.js.
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

// GET stays open to every authenticated user — printing (any crew member)
// needs to list/read templates. Creating/editing/deleting is admin-only,
// same as the Settings > Label templates page that's the only way to reach
// those actions.
routerAdd(
  "GET",
  "/api/labels",
  (e) => {
    const { toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const records = $app.findAllRecords("label_templates");
    records.sort((a, b) => String(a.get("name")).localeCompare(String(b.get("name"))));
    return e.json(200, records.map(toLabelJson));
  },
  $apis.requireAuth(),
);

routerAdd(
  "GET",
  "/api/labels/{id}",
  (e) => {
    const { toLabelJson } = require(`${__hooks}/lib/labels.js`);
    try {
      const record = $app.findRecordById("label_templates", e.request.pathValue("id"));
      return e.json(200, toLabelJson(record));
    } catch (err) {
      throw new NotFoundError("Template not found");
    }
  },
  $apis.requireAuth(),
);

routerAdd(
  "POST",
  "/api/labels",
  (e) => {
    const { validateTemplateBody, toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const data = validateTemplateBody(e.requestInfo().body);
    const collection = $app.findCollectionByNameOrId("label_templates");
    const record = new Record(collection, data);
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("label_created", who, { id: record.id, name: record.get("name") });
    return e.json(200, toLabelJson(record));
  },
  $apis.requireAuth(),
  requireAdmin,
);

routerAdd(
  "PUT",
  "/api/labels/{id}",
  (e) => {
    const { validateTemplateBody, toLabelJson } = require(`${__hooks}/lib/labels.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const data = validateTemplateBody(e.requestInfo().body);
    let record;
    try {
      record = $app.findRecordById("label_templates", e.request.pathValue("id"));
    } catch (err) {
      throw new NotFoundError("Template not found");
    }
    record.set("name", data.name);
    record.set("widthMm", data.widthMm);
    record.set("heightMm", data.heightMm);
    record.set("elements", data.elements);
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("label_updated", who, { id: record.id, name: record.get("name") });
    return e.json(200, toLabelJson(record));
  },
  $apis.requireAuth(),
  requireAdmin,
);

routerAdd(
  "DELETE",
  "/api/labels/{id}",
  (e) => {
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const id = e.request.pathValue("id");
    let existing = null;
    try {
      existing = $app.findRecordById("label_templates", id);
    } catch (err) {
      existing = null;
    }
    if (existing) $app.delete(existing);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("label_deleted", who, { id: id, name: existing ? existing.get("name") : id });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
  requireAdmin,
);
})();
