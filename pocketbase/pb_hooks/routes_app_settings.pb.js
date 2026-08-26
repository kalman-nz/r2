/// <reference path="../pb_data/types.d.ts" />
// Named /api/app-settings, not /api/settings — the latter is PocketBase's
// own built-in superuser app-config endpoint (SMTP/S3/etc), unrelated to
// this app's printerHost/businessName key-value settings.
//
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the
// same const name declared in other routes_*.pb.js files (see
// routes_labels.pb.js for the full explanation).
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

// Left open to every authenticated user, not just admins — the header shows
// the business name for everyone. Changing anything is still admin-only.
routerAdd(
  "GET",
  "/api/app-settings",
  (e) => {
    const { getAllSettings, DEFAULTS } = require(`${__hooks}/lib/settings.js`);
    return e.json(200, Object.assign({}, DEFAULTS, getAllSettings()));
  },
  $apis.requireAuth(),
);

routerAdd(
  "PUT",
  "/api/app-settings",
  (e) => {
    const { getAllSettings, setSetting, DEFAULTS } = require(`${__hooks}/lib/settings.js`);
    const data = e.requestInfo().body || {};
    for (const key of Object.keys(DEFAULTS)) {
      if (data[key] !== undefined) {
        if (typeof data[key] !== "string") throw new BadRequestError(key + " must be a string");
        setSetting(key, data[key]);
      }
    }
    return e.json(200, Object.assign({}, DEFAULTS, getAllSettings()));
  },
  $apis.requireAuth(),
  requireAdmin,
);
})();
