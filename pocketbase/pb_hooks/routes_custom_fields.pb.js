/// <reference path="../pb_data/types.d.ts" />
// Rentman account-specific custom fields, for the label designer's data
// field picker (web/src/pages/LabelEditor.tsx) and the "From template"
// manual fill-in form (web/src/pages/CustomLabelPage.tsx) — lets someone
// print a custom field they defined in Rentman without this app needing a
// code change for it. Backed by the rm_extrainputfields mirror (field
// *definitions* — see lib/sync.js's syncExtraInputFields); the per-item
// values themselves already ride along in each equipment/serialnumber's
// own `custom` object.
//
// Rentman's itemtype "Materiaal" is equipment, "Exemplaar" is an
// individual serialized unit — those are the only two item types this
// app's labels ever print, so every other itemtype (Project, Vehicle,
// Crew, ...) is filtered out.
routerAdd(
  "GET",
  "/api/custom-fields",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    const ITEMTYPE_TO_APPLIES_TO = { Materiaal: "equipment", Exemplaar: "asset" };

    const fields = allData($app, "rm_extrainputfields")
      .filter((f) => !f.hidden && ITEMTYPE_TO_APPLIES_TO[f.itemtype])
      .map((f) => ({
        key: "custom_" + f.id,
        label: f.displayname || f.name || "custom_" + f.id,
        appliesTo: ITEMTYPE_TO_APPLIES_TO[f.itemtype],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return e.json(200, fields);
  },
  $apis.requireAuth(),
);
