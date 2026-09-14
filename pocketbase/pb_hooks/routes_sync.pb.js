/// <reference path="../pb_data/types.d.ts" />
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the
// same const name declared in other routes_*.pb.js files (see
// routes_labels.pb.js for the full explanation).
(function () {
  const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

  // Manual escape hatch — pulls everything from Rentman right now instead
  // of waiting for the next cron tick. Admin-only: this hits every Rentman
  // list endpoint and can take a while against a slow account.
  routerAdd(
    "POST",
    "/api/sync/full",
    (e) => {
      const { syncAll } = require(`${__hooks}/lib/sync.js`);
      const startedAt = Date.now();
      const counts = syncAll($app);
      return e.json(200, { ok: true, counts: counts, tookMs: Date.now() - startedAt });
    },
    $apis.requireAuth(),
    requireAdmin,
  );

  // Open to any signed-in user (not just admins) — lets the UI show "last
  // synced Xm ago" / a stale-data warning anywhere, same as the old
  // /api/refresh button being available to everyone.
  routerAdd(
    "GET",
    "/api/sync/status",
    (e) => {
      const { getSyncState } = require(`${__hooks}/lib/mirror.js`);
      return e.json(200, getSyncState($app));
    },
    $apis.requireAuth(),
  );
})();
