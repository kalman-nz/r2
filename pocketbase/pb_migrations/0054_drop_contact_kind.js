/// <reference path="../pb_data/types.d.ts" />

// Contacts no longer say whether they're a company or a person: nothing in
// R2 used it, and GST doesn't care. Rentman keeps its own type.

migrate(
  (app) => {
    const contacts = app.findCollectionByNameOrId("contacts");
    if (contacts.fields.getByName("kind")) {
      contacts.fields.removeByName("kind");
      app.save(contacts);
    }
  },
  (app) => {
    const contacts = app.findCollectionByNameOrId("contacts");
    if (!contacts.fields.getByName("kind")) {
      contacts.fields.add(new SelectField({ name: "kind", values: ["company", "person"], maxSelect: 1 }));
      app.save(contacts);
    }
  },
);
