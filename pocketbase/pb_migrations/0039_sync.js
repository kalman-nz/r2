/// <reference path="../pb_data/types.d.ts" />

// Live sync with Rentman and Momentus (lib/sync.js):
// - sync_links: which R2 record is which record in the other system, and
//   `base`, its fields as last agreed, for the three-way merge (lib/merge.js)
// - sync_queue: work waiting for the background worker: R2 changes to send
//   and changes the other system told us about
// - sync_log: one row per sync pass, for Settings → Integrations
// None of them have API rules: only the sync routes read them.
//
// Records an earlier Rentman import brought in get their links now, with
// no base, so the first live sync settles any differences one way (the
// organisation picks which) instead of importing them twice.

const LINKED = {
  categories: "folders",
  locations: "stocklocations",
  items: "equipment",
  serials: "serialnumbers",
  contacts: "contacts",
  venues: "contacts",
  jobs: "projects",
  job_lines: "projectequipment",
};

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const org = { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true };
    const provider = { type: "select", name: "provider", required: true, values: ["rentman", "momentus"], maxSelect: 1 };
    const timestamps = [
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];

    const links = new Collection({
      type: "base",
      name: "sync_links",
      fields: [
        org,
        provider,
        { type: "text", name: "collection", required: true, max: 100 },
        { type: "text", name: "record", required: true, max: 50 },
        { type: "text", name: "remoteType", max: 100 },
        { type: "text", name: "remoteId", required: true, max: 200 },
        { type: "json", name: "base", maxSize: 500000 },
        // The other system's own "last changed" stamp, when it has one.
        { type: "text", name: "remoteModified", max: 100 },
        { type: "date", name: "syncedAt" },
        // Connector extras, e.g. the Momentus order a quote went to.
        { type: "json", name: "extra", maxSize: 100000 },
        ...timestamps,
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_sync_links_remote ON sync_links (org, provider, collection, remoteId)",
        "CREATE UNIQUE INDEX idx_sync_links_record ON sync_links (org, provider, collection, record)",
      ],
    });
    app.save(links);

    const queue = new Collection({
      type: "base",
      name: "sync_queue",
      fields: [
        org,
        provider,
        { type: "select", name: "direction", required: true, values: ["in", "out"], maxSelect: 1 },
        // What to do: "upsert"/"delete" a record, or a connector job such
        // as "pull" (re-read a whole list) or "pushQuote".
        { type: "text", name: "action", required: true, max: 50 },
        { type: "text", name: "collection", max: 100 },
        { type: "text", name: "record", max: 50 },
        { type: "text", name: "remoteType", max: 100 },
        { type: "text", name: "remoteId", max: 200 },
        { type: "json", name: "payload", maxSize: 100000 },
        { type: "select", name: "status", required: true, values: ["pending", "failed"], maxSelect: 1 },
        { type: "number", name: "attempts", onlyInt: true, min: 0 },
        { type: "date", name: "nextAttemptAt" },
        { type: "text", name: "lastError", max: 5000 },
        ...timestamps,
      ],
      indexes: ["CREATE INDEX idx_sync_queue_due ON sync_queue (status, nextAttemptAt)", "CREATE INDEX idx_sync_queue_org ON sync_queue (org, provider)"],
    });
    app.save(queue);

    const log = new Collection({
      type: "base",
      name: "sync_log",
      fields: [
        org,
        provider,
        // "poll", "queue", "webhook", "test", "inventory"…
        { type: "text", name: "kind", required: true, max: 50 },
        { type: "select", name: "status", required: true, values: ["ok", "partial", "failed"], maxSelect: 1 },
        { type: "json", name: "counts", maxSize: 100000 },
        { type: "json", name: "errors", maxSize: 500000 },
        { type: "json", name: "conflicts", maxSize: 500000 },
        { type: "text", name: "message", max: 5000 },
        { type: "text", name: "who", max: 200 },
        { type: "date", name: "startedAt" },
        { type: "date", name: "finishedAt" },
        ...timestamps,
      ],
      indexes: ["CREATE INDEX idx_sync_log_org ON sync_log (org, provider, created)"],
    });
    app.save(log);

    for (const collection of Object.keys(LINKED)) {
      const rows = arrayOf(new DynamicModel({ id: "", org: "", rentmanId: "" }));
      app
        .db()
        .newQuery("SELECT id, org, rentmanId FROM " + collection + " WHERE rentmanId != '' AND org != ''")
        .all(rows);
      for (const row of rows) {
        app.save(
          new Record(links, {
            org: row.org,
            provider: "rentman",
            collection: collection,
            record: row.id,
            remoteType: LINKED[collection],
            remoteId: row.rentmanId,
          }),
        );
      }
    }
  },
  (app) => {
    for (const name of ["sync_log", "sync_queue", "sync_links"]) app.delete(app.findCollectionByNameOrId(name));
  },
);
