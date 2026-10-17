/// <reference path="../pb_data/types.d.ts" />
// Custom fields for the label designer's data field picker
// (web/src/pages/LabelEditor.tsx) and the "From template" manual fill-in form
// (web/src/pages/CustomLabelPage.tsx) — lets someone print a custom field
// without a code change. Definitions live in custom_fields (filled by the
// Rentman importer); the per-item values ride along in each item's or
// serial's own `custom` object, keyed the same "custom_<id>" way.
routerAdd(
  "GET",
  "/api/custom-fields",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e);
    const fields = $app.findRecordsByFilter("custom_fields", "org = {:org}", "label", 0, 0, { org: ctx.orgId }).map((f) => ({
      key: f.getString("key"),
      label: f.getString("label"),
      appliesTo: f.getString("appliesTo"),
    }));
    return e.json(200, fields);
  },
  $apis.requireAuth("users"),
);
