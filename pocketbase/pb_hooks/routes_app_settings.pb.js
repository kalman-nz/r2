/// <reference path="../pb_data/types.d.ts" />
// Named /api/app-settings, not /api/settings — the latter is PocketBase's
// own built-in superuser app-config endpoint (SMTP/S3/etc), unrelated to
// this app's key-value settings. Settings belong to an organisation (the
// X-Org header picks which).

// Any member can read them — the header shows the business name, and job
// pages need the pricing settings. Secrets (the Rentman API token) are
// never included, only whether one is set.
routerAdd(
  "GET",
  "/api/app-settings",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { publicSettings } = require(`${__hooks}/lib/settings.js`);
    const ctx = requireOrg(e);
    return e.json(200, publicSettings(ctx.orgId));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/app-settings",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { setSetting, validateSetting, publicSettings, DEFAULTS, SECRET_KEYS } = require(`${__hooks}/lib/settings.js`);
    const data = e.requestInfo().body || {};
    const keys = Object.keys(DEFAULTS).concat(SECRET_KEYS).filter((key) => data[key] !== undefined);
    // The default label template is set from Label templates, by whoever
    // edits templates; everything else is settings.edit.
    const only = (key) => keys.length > 0 && keys.every((k) => k === key);
    const ctx = requireOrg(
      e,
      only("defaultTemplateId") ? ["settings.edit", "templates.edit"] : "settings.edit",
    );

    // Validate everything before writing anything, so one bad value doesn't
    // leave the others half-saved.
    for (const key of keys) {
      if (typeof data[key] !== "string") throw new BadRequestError(key + " must be a string");
      try {
        validateSetting(key, data[key]);
      } catch (err) {
        throw new BadRequestError(String(err.message || err));
      }
    }
    for (const key of keys) setSetting(ctx.orgId, key, data[key].trim());
    return e.json(200, publicSettings(ctx.orgId));
  },
  $apis.requireAuth("users"),
);
