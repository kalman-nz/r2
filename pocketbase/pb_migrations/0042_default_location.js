/// <reference path="../pb_data/types.d.ts" />

// Every organisation has a storage location to start with, "Default", the
// way new ones do (records_maintenance.pb.js). Organisations that already
// have locations keep theirs.

migrate(
  (app) => {
    const locations = app.findCollectionByNameOrId("locations");
    for (const org of app.findAllRecords("organisations")) {
      if (app.findRecordsByFilter("locations", "org = {:org}", "", 1, 0, { org: org.id }).length > 0) continue;
      app.save(new Record(locations, { org: org.id, name: "Default" }));
    }
  },
  () => {
    // Left in place: units may be there by now.
  },
);
