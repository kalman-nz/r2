/// <reference path="../pb_data/types.d.ts" />

// Reconciliation safety net. The Rentman webhook (routes_webhook_rentman.pb.js)
// gives near-instant updates for whatever it actually catches, but webhooks
// can be missed (Rentman retry exhausted, this container was briefly down,
// an unrecognized payload shape) — this catches anything that leaves stale
// within 15 minutes regardless. Same require()-inside-the-handler-body
// rule as routerAdd handlers applies here too (see routes_assets.pb.js).
cronAdd("rentmanFullSync", "*/15 * * * *", () => {
  const { syncAll } = require(`${__hooks}/lib/sync.js`);
  try {
    syncAll($app);
  } catch (err) {
    console.error("[cron rentmanFullSync] " + err);
  }
});
