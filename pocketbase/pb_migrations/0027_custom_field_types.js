/// <reference path="../pb_data/types.d.ts" />

// Custom fields become something an organisation sets up itself (Settings →
// Custom fields) rather than only names for what the Rentman importer
// brought in. Values still live in each item's `custom` object under the
// field's key.
//
//   custom_fields.type       text, number, yes/no, date or a dropdown.
//                            Empty means text, which is what every imported
//                            field was.
//   custom_fields.options    a dropdown's choices, a JSON list of strings
//   custom_fields.sortOrder  the order they're shown in
//
// Anyone with settings.edit can add, change and remove them. A new field's
// key is made up by the server (records_validation.pb.js).

const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

migrate(
  (app) => {
    const fields = app.findCollectionByNameOrId("custom_fields");
    fields.fields.add(new SelectField({ name: "type", values: ["text", "number", "boolean", "date", "select"], maxSelect: 1 }));
    fields.fields.add(new JSONField({ name: "options", maxSize: 20000 }));
    fields.fields.add(new NumberField({ name: "sortOrder", onlyInt: true }));
    // The server fills it in on create.
    fields.fields.getByName("key").required = false;
    fields.createRule = can("settings.edit");
    fields.updateRule = can("settings.edit") + " && " + SAME_ORG;
    fields.deleteRule = can("settings.edit");
    app.save(fields);
  },
  (app) => {
    const fields = app.findCollectionByNameOrId("custom_fields");
    fields.fields.removeByName("type");
    fields.fields.removeByName("options");
    fields.fields.removeByName("sortOrder");
    fields.fields.getByName("key").required = true;
    fields.createRule = null;
    fields.updateRule = null;
    fields.deleteRule = null;
    app.save(fields);
  },
);
