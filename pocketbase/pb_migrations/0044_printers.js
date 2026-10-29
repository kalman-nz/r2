/// <reference path="../pb_data/types.d.ts" />

// Printers and label sizes, set up in Settings → Printer setup.
//
// Both live in the organisation's settings as JSON lists (keys "printers"
// and "labelSizes", lib/printing.js), so settings values can now be longer
// than PocketBase's 5,000-character default. A label template gains sizeId:
// the label size it was designed for, which decides which printers can
// print it ("" for older templates — matched by their width and length).

migrate(
  (app) => {
    const settings = app.findCollectionByNameOrId("settings");
    settings.fields.getByName("value").max = 200000;
    app.save(settings);

    const templates = app.findCollectionByNameOrId("label_templates");
    templates.fields.add(new TextField({ name: "sizeId", max: 60 }));
    app.save(templates);
  },
  (app) => {
    const templates = app.findCollectionByNameOrId("label_templates");
    templates.fields.removeByName("sizeId");
    app.save(templates);
  },
);
