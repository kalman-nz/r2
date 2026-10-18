/// <reference path="../pb_data/types.d.ts" />

// The Rentman import brings in contacts, locations and projects with their
// lines too (lib/imports.js). Contacts and jobs already had a rentmanId;
// locations (venues) and project lines get one, so re-running the import
// updates what it brought in before instead of adding it twice.

migrate(
  (app) => {
    for (const name of ["venues", "job_lines"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(new TextField({ name: "rentmanId" }));
      // Copied out first: the index list is a Go slice underneath.
      const indexes = [];
      for (const index of collection.indexes) indexes.push(index);
      indexes.push("CREATE UNIQUE INDEX idx_" + name + "_rentmanId ON " + name + " (org, rentmanId) WHERE rentmanId != ''");
      collection.indexes = indexes;
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ["venues", "job_lines"]) {
      const collection = app.findCollectionByNameOrId(name);
      const indexes = [];
      for (const index of collection.indexes) if (index.indexOf("idx_" + name + "_rentmanId") === -1) indexes.push(index);
      collection.indexes = indexes;
      collection.fields.removeByName("rentmanId");
      app.save(collection);
    }
  },
);
