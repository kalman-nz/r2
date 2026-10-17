/// <reference path="../pb_data/types.d.ts" />

// The rm_* collections were a read-through cache of a Rentman account (see
// 0014/0018), refreshed every 15 minutes. R2 owns its data now (0020), and
// Rentman is a one-way importer that writes straight into items, serials,
// categories, locations and custom_fields (lib/rentmanImport.js). Nothing
// reads the mirror any more. It only ever held copies of Rentman data, so
// dropping it loses nothing that a fresh import can't fetch again.
//
// sync_state goes too: import history now lives in import_runs.
const MIRRORS = ["rm_equipment", "rm_serialnumbers", "rm_stocklocations", "rm_folders", "rm_extrainputfields"];

migrate(
  (app) => {
    for (const name of MIRRORS.concat(["sync_state"])) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
  (app) => {
    const authRule = "@request.auth.id != ''";
    for (const name of MIRRORS) {
      app.save(
        new Collection({
          type: "base",
          name: name,
          listRule: authRule,
          viewRule: authRule,
          fields: [
            { type: "text", name: "rentmanId", required: true },
            { type: "json", name: "data", required: true, maxSize: 2000000 },
          ],
          indexes: ["CREATE UNIQUE INDEX idx_" + name + "_rentmanId ON " + name + " (rentmanId)"],
        }),
      );
    }
    app.save(
      new Collection({
        type: "base",
        name: "sync_state",
        listRule: authRule,
        viewRule: authRule,
        fields: [
          { type: "text", name: "key", required: true },
          { type: "json", name: "value", maxSize: 2000000 },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_sync_state_key ON sync_state (key)"],
      }),
    );
  },
);
