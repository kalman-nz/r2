/// <reference path="../pb_data/types.d.ts" />

// Custom fields on projects, contacts and locations as well as items
// (Settings → Projects → Custom fields): the same custom_fields records,
// appliesTo "job", "contact" or "venue", with each record's values in its
// own `custom` object under the field's key, as items keep theirs.

const SPECS = ["jobs", "contacts", "venues"];

migrate(
  (app) => {
    const fields = app.findCollectionByNameOrId("custom_fields");
    fields.fields.getByName("appliesTo").values = ["item", "serial", "job", "contact", "venue"];
    app.save(fields);
    for (const name of SPECS) {
      const collection = app.findCollectionByNameOrId(name);
      if (!collection.fields.getByName("custom")) {
        collection.fields.add(new JSONField({ name: "custom", maxSize: 200000 }));
        app.save(collection);
      }
    }
  },
  (app) => {
    app.db().newQuery("DELETE FROM custom_fields WHERE appliesTo IN ('job', 'contact', 'venue')").execute();
    const fields = app.findCollectionByNameOrId("custom_fields");
    fields.fields.getByName("appliesTo").values = ["item", "serial"];
    app.save(fields);
    for (const name of SPECS) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.removeByName("custom");
      app.save(collection);
    }
  },
);
