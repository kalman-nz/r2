/// <reference path="../pb_data/types.d.ts" />

// Manual escape hatch — the UI reads from the local Rentman mirror (see
// lib/sync.js) rather than live Rentman, so "Refresh" here means "pull
// fresh data from Rentman into that mirror right now" instead of waiting
// for the next webhook/cron tick. Open to every signed-in user (not just
// admins) — same as before, any crew member might need "I just changed
// this in Rentman" to show up immediately.
routerAdd(
  "POST",
  "/api/refresh",
  (e) => {
    const { syncAll } = require(`${__hooks}/lib/sync.js`);
    syncAll($app);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
