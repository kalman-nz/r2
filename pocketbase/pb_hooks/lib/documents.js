// Each organisation's project documents (pb_migrations/0040): forms printed
// from a project's Documents menu, like a technical handover or a deprep
// checklist. A template has the project's details at the top, then its
// parts, in order (`fields`), and can list the project's equipment as a
// plain list, a packing checklist or a return check. The packing list is
// built in (web/src/pages/PackingList.tsx), not a template.
//
// Must match the web app's lib/documents.ts.

const FIELD_TYPES = ["heading", "note", "text", "textarea", "checkbox", "date", "signature"];
const EQUIPMENT = ["none", "list", "checklist", "return"];

// What every organisation starts with (the same as migration 0040).
const DEFAULT_DOCUMENTS = [
  {
    name: "Technical handover",
    description: "Handing a system over to the client or venue on site",
    equipment: "list",
    schedule: true,
    notes: true,
    fields: [
      { type: "heading", label: "Handover" },
      { type: "text", label: "Handed over to" },
      { type: "text", label: "Handed over by" },
      { type: "date", label: "Date and time" },
      { type: "checkbox", label: "System powered up and tested" },
      { type: "checkbox", label: "Client shown how to operate it" },
      { type: "checkbox", label: "Shutdown and emergency procedures explained" },
      { type: "checkbox", label: "Radio mics, batteries and remotes handed over" },
      { type: "textarea", label: "Known issues or limitations" },
      { type: "heading", label: "Sign off" },
      { type: "signature", label: "Client" },
      { type: "signature", label: "Technician" },
    ],
  },
  {
    name: "Deprep checklist",
    description: "Checking kit back in after a project",
    equipment: "return",
    schedule: false,
    notes: false,
    fields: [
      { type: "heading", label: "Checks" },
      { type: "checkbox", label: "Everything counted back in" },
      { type: "checkbox", label: "Cables coiled, tested and sorted" },
      { type: "checkbox", label: "Cases cleaned and labels checked" },
      { type: "checkbox", label: "Faults reported as repairs" },
      { type: "checkbox", label: "Consumables restocked" },
      { type: "textarea", label: "Missing or damaged kit" },
      { type: "signature", label: "Deprepped by" },
      { type: "signature", label: "Checked by" },
    ],
  },
];

function createDefaultDocuments(app, org) {
  if (app.findRecordsByFilter("document_templates", "org = {:org}", "", 1, 0, { org: org }).length > 0) return;
  const collection = app.findCollectionByNameOrId("document_templates");
  DEFAULT_DOCUMENTS.forEach((d, i) => {
    app.save(
      new Record(collection, {
        org: org,
        name: d.name,
        description: d.description,
        equipment: d.equipment,
        schedule: d.schedule,
        notes: d.notes,
        fields: d.fields.map((f, j) => ({ id: "f" + (j + 1), type: f.type, label: f.label })),
        sortOrder: (i + 1) * 10,
      }),
    );
  });
}

// Keeps a template's parts tidy before it's saved: known types, a label
// on each (a note's is its text), up to 100 of them.
function cleanTemplate(record) {
  const { decodeJson } = require("./records.js");
  record.set("name", record.getString("name").trim());
  if (!record.getString("name")) throw new BadRequestError("Give the document a name");
  if (EQUIPMENT.indexOf(record.getString("equipment")) === -1) record.set("equipment", "none");
  const raw = decodeJson(record.get("fields"), []);
  if (!Array.isArray(raw)) throw new BadRequestError("A document's parts should be a list");
  if (raw.length > 100) throw new BadRequestError("That's a lot of parts: up to 100");
  const seen = {};
  const fields = raw.map((f, i) => {
    const type = f && FIELD_TYPES.indexOf(f.type) !== -1 ? f.type : "";
    if (!type) throw new BadRequestError("Part " + (i + 1) + " isn't a kind of part a document can have");
    const label = typeof f.label === "string" ? f.label.trim().slice(0, type === "note" ? 2000 : 200) : "";
    if (!label) throw new BadRequestError("Part " + (i + 1) + " needs " + (type === "note" ? "some text" : "a label"));
    let id = typeof f.id === "string" && /^[a-z0-9]{1,20}$/i.test(f.id) ? f.id : "";
    if (!id || seen[id]) id = "f" + (i + 1) + "x" + Math.floor(Math.random() * 1e6);
    seen[id] = true;
    return { id: id, type: type, label: label };
  });
  record.set("fields", fields);
}

module.exports = { FIELD_TYPES, EQUIPMENT, DEFAULT_DOCUMENTS, createDefaultDocuments, cleanTemplate };
