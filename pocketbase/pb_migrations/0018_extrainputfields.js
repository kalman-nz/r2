/// <reference path="../pb_data/types.d.ts" />

// Mirrors Rentman's "extrainputfields" resource — the account's custom
// field *definitions* (name, which item type they're on, data type).
// Same { rentmanId, data } shape as the other rm_* mirrors (0014) — see
// lib/sync.js's syncExtraInputFields. This is what lets
// routes_custom_fields.pb.js turn a raw "custom_12" key on an
// equipment/serialnumber record into a real field name for the label
// designer's field picker.
migrate(
  (app) => {
    const authRule = "@request.auth.id != ''";
    const collection = new Collection({
      type: "base",
      name: "rm_extrainputfields",
      listRule: authRule,
      viewRule: authRule,
      fields: [
        { type: "text", name: "rentmanId", required: true },
        { type: "json", name: "data", required: true, maxSize: 2000000 },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_rm_extrainputfields_rentmanId ON rm_extrainputfields (rentmanId)"],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("rm_extrainputfields"));
  },
);
