/// <reference path="../pb_data/types.d.ts" />

// Project documents: each organisation's own printable forms, picked from a
// project's Documents menu next to the built-in packing list. A technical
// handover, a deprep checklist, or anything else a business uses
// (lib/documents.js). Settings → Documents changes them (settings.edit);
// every member can read them, to print.
//
//   fields     the form's parts in order: [{ id, type, label }], type one of
//              heading, note, text, textarea, checkbox, date, signature
//   equipment  how it lists the project's kit: none, list, checklist (to
//              tick off), return (out, back, OK and notes for each)
//   schedule   show the project's schedule; notes: its internal notes
//
// Every organisation starts with Technical handover and Deprep checklist.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

// The same as DEFAULT_DOCUMENTS in lib/documents.js.
const DEFAULTS = [
  {
    name: "Technical handover",
    description: "Handing a system over to the client or venue on site",
    equipment: "list",
    schedule: true,
    notes: true,
    fields: [
      ["heading", "Handover"],
      ["text", "Handed over to"],
      ["text", "Handed over by"],
      ["date", "Date and time"],
      ["checkbox", "System powered up and tested"],
      ["checkbox", "Client shown how to operate it"],
      ["checkbox", "Shutdown and emergency procedures explained"],
      ["checkbox", "Radio mics, batteries and remotes handed over"],
      ["textarea", "Known issues or limitations"],
      ["heading", "Sign off"],
      ["signature", "Client"],
      ["signature", "Technician"],
    ],
  },
  {
    name: "Deprep checklist",
    description: "Checking kit back in after a project",
    equipment: "return",
    schedule: false,
    notes: false,
    fields: [
      ["heading", "Checks"],
      ["checkbox", "Everything counted back in"],
      ["checkbox", "Cables coiled, tested and sorted"],
      ["checkbox", "Cases cleaned and labels checked"],
      ["checkbox", "Faults reported as repairs"],
      ["checkbox", "Consumables restocked"],
      ["textarea", "Missing or damaged kit"],
      ["signature", "Deprepped by"],
      ["signature", "Checked by"],
    ],
  },
];

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const templates = new Collection({
      type: "base",
      name: "document_templates",
      listRule: MEMBER,
      viewRule: MEMBER,
      createRule: can("settings.edit") + " && " + SAME_ORG,
      updateRule: can("settings.edit") + " && " + SAME_ORG,
      deleteRule: can("settings.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 80 },
        { type: "text", name: "description", max: 300 },
        { type: "select", name: "equipment", values: ["none", "list", "checklist", "return"], maxSelect: 1 },
        { type: "bool", name: "schedule" },
        { type: "bool", name: "notes" },
        { type: "json", name: "fields", maxSize: 200000 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_document_templates_org ON document_templates (org, sortOrder)"],
    });
    app.save(templates);

    for (const org of app.findAllRecords("organisations")) {
      DEFAULTS.forEach((d, i) => {
        app.save(
          new Record(templates, {
            org: org.id,
            name: d.name,
            description: d.description,
            equipment: d.equipment,
            schedule: d.schedule,
            notes: d.notes,
            fields: d.fields.map((f, j) => ({ id: "f" + (j + 1), type: f[0], label: f[1] })),
            sortOrder: (i + 1) * 10,
          }),
        );
      });
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("document_templates"));
  },
);
