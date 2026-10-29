/// <reference path="../pb_data/types.d.ts" />

// Units get files like a repair's (pb_migrations/0032): the PO, invoice,
// warranty, manual, test certificates. Protected, so only the
// organisation's members can open them. Added and removed through
// POST/DELETE /api/serials/{id}/files (routes_serial_files.pb.js).

const FILE_SIZE = 25 * 1024 * 1024;

migrate(
  (app) => {
    const serials = app.findCollectionByNameOrId("serials");
    serials.fields.add(new FileField({ name: "files", maxSelect: 99, maxSize: FILE_SIZE, protected: true, thumbs: ["200x200"] }));
    serials.fields.add(new JSONField({ name: "fileInfo", maxSize: 200000 }));
    app.save(serials);
  },
  (app) => {
    const serials = app.findCollectionByNameOrId("serials");
    serials.fields.removeByName("files");
    serials.fields.removeByName("fileInfo");
    app.save(serials);
  },
);
