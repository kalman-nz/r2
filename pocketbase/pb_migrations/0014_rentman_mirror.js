/// <reference path="../pb_data/types.d.ts" />

// A local mirror of the Rentman resources this app reads — every /api/*
// route used to call Rentman's (slow) API on every request; now a
// background sync (lib/sync.js, run on a cron + on demand + from the
// Rentman webhook) keeps these collections current, and routes just read
// from here. Each row is { rentmanId, data } where `data` is the raw
// record straight from Rentman — a new Rentman field just shows up in
// `data` for free, no migration needed for that.
//
// Read/write access: listRule/viewRule let any signed-in user read (same
// as before, routes already gated that), but create/update/delete are left
// unset (superuser-only) — only the sync code (running as $app, which
// bypasses collection rules entirely) ever writes these.
migrate(
  (app) => {
    const authRule = "@request.auth.id != ''";

    const mirrors = [
      "rm_equipment",
      "rm_serialnumbers",
      "rm_projects",
      "rm_subprojects",
      "rm_projectequipmentgroups",
      "rm_projectequipment",
      "rm_stocklocations",
      "rm_folders",
      "rm_contacts",
    ];

    for (const name of mirrors) {
      const collection = new Collection({
        type: "base",
        name: name,
        listRule: authRule,
        viewRule: authRule,
        fields: [
          { type: "text", name: "rentmanId", required: true },
          { type: "json", name: "data", required: true, maxSize: 2000000 },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_" + name + "_rentmanId ON " + name + " (rentmanId)"],
      });
      app.save(collection);
    }

    // Sync bookkeeping (lastSyncedAt, lastSyncError, lastSyncCounts,
    // lastSyncDurationMs) — same key/value shape as the "settings"
    // collection. Not writable by clients; sync code writes it as $app.
    const syncState = new Collection({
      type: "base",
      name: "sync_state",
      listRule: authRule,
      viewRule: authRule,
      fields: [
        { type: "text", name: "key", required: true },
        { type: "json", name: "value", maxSize: 2000000 },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_sync_state_key ON sync_state (key)"],
    });
    app.save(syncState);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("sync_state"));
    const mirrors = [
      "rm_equipment",
      "rm_serialnumbers",
      "rm_projects",
      "rm_subprojects",
      "rm_projectequipmentgroups",
      "rm_projectequipment",
      "rm_stocklocations",
      "rm_folders",
      "rm_contacts",
    ];
    for (const name of mirrors) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
