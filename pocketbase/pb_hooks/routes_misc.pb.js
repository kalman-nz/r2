/// <reference path="../pb_data/types.d.ts" />

// Manual escape hatch for the 5-minute Rentman cache — lets the UI force a
// truly fresh read instead of waiting out the window.
routerAdd(
  "POST",
  "/api/refresh",
  (e) => {
    const { clearRentmanCache } = require(`${__hooks}/lib/rentman.js`);
    clearRentmanCache();
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
);
