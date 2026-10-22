/// <reference path="../pb_data/types.d.ts" />

// Repairs get:
//
//   files  anything that goes with the repair: photos of the damage, the
//          repairer's report, quotes, invoices, POs. Protected, so only the
//          organisation's members can open them (through a file token, the
//          collection's view rule). Added and removed through
//          POST/DELETE /api/repairs/{id}/files, like every other change to
//          a repair (routes_repairs.pb.js).
//   fileInfo  { storedName: { name, size, by, at } }: PocketBase renames
//          what it stores ("PO 4471.pdf" → "po_4471_x8k2m4n6p1.pdf"), so the
//          name it was uploaded with, its size, and who added it when.
//   job    the project the kit came back damaged from, if any, so the damage
//          can be followed up with the client. Cleared if the project is
//          deleted.
//
// Also: the item page shows photos at 300x300, which wasn't one of the
// photo field's thumb sizes, so PocketBase sent the full-size original.

const FILE_SIZE = 25 * 1024 * 1024;

migrate(
  (app) => {
    const repairs = app.findCollectionByNameOrId("repairs");
    const jobs = app.findCollectionByNameOrId("jobs");
    repairs.fields.add(new FileField({ name: "files", maxSelect: 99, maxSize: FILE_SIZE, protected: true, thumbs: ["200x200"] }));
    repairs.fields.add(new JSONField({ name: "fileInfo", maxSize: 200000 }));
    repairs.fields.add(new RelationField({ name: "job", collectionId: jobs.id, maxSelect: 1 }));
    const indexes = [];
    for (const index of repairs.indexes) indexes.push(index);
    indexes.push("CREATE INDEX idx_repairs_job ON repairs (job)");
    repairs.indexes = indexes;
    app.save(repairs);

    const items = app.findCollectionByNameOrId("items");
    items.fields.getByName("photo").thumbs = ["100x100", "300x300", "400x0"];
    app.save(items);
  },
  (app) => {
    const repairs = app.findCollectionByNameOrId("repairs");
    repairs.fields.removeByName("files");
    repairs.fields.removeByName("fileInfo");
    repairs.fields.removeByName("job");
    const indexes = [];
    for (const index of repairs.indexes) if (index.indexOf("idx_repairs_job") === -1) indexes.push(index);
    repairs.indexes = indexes;
    app.save(repairs);

    const items = app.findCollectionByNameOrId("items");
    items.fields.getByName("photo").thumbs = ["100x100", "400x0"];
    app.save(items);
  },
);
