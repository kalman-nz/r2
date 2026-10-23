/// <reference path="../pb_data/types.d.ts" />
// Live sync (lib/sync.js): R2 changes the connectors care about are queued
// for the background worker, never sent from inside the save. Changes the
// sync makes itself are skipped (sync.quietSave). A problem queueing never
// stops the save.

onRecordAfterCreateSuccess(
  (e) => {
    require(`${__hooks}/lib/sync.js`).onLocalChange(e.record, "create");
    e.next();
  },
  "items",
  "contacts",
  "venues",
  "quotes",
);

onRecordAfterUpdateSuccess(
  (e) => {
    require(`${__hooks}/lib/sync.js`).onLocalChange(e.record, "update");
    e.next();
  },
  "items",
  "contacts",
  "venues",
);

onRecordAfterDeleteSuccess(
  (e) => {
    require(`${__hooks}/lib/sync.js`).onLocalChange(e.record, "delete");
    e.next();
  },
  "items",
  "contacts",
  "venues",
);
