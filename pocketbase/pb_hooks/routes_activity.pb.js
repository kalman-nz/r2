/// <reference path="../pb_data/types.d.ts" />
// Named /api/activity, not /api/logs — the latter is PocketBase's own
// built-in superuser request-log endpoint, unrelated to this app's
// print/login/label event feed.
//
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the same
// const name declared in other routes_*.pb.js files — see routes_labels.pb.js.
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

routerAdd(
  "GET",
  "/api/activity",
  (e) => {
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const records = $app.findRecordsByFilter("logs", "", "-createdAt", 200, 0);
    const rows = records.map((r) => ({
      id: r.id,
      type: r.get("type"),
      who: r.get("who"),
      createdAt: r.get("createdAt"),
      details: r.get("details"),
    }));
    return e.json(200, summarizeLogs(rows, { resolveSerials: true }));
  },
  $apis.requireAuth(),
  requireAdmin,
);

// Any authenticated user can log their own activity (page views, etc) —
// only reading the aggregate feed above is admin-gated.
routerAdd(
  "POST",
  "/api/activity",
  (e) => {
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const data = e.requestInfo().body || {};
    if (typeof data.type !== "string" || !data.type) throw new BadRequestError("type is required");
    const who = e.auth.get("name") || e.auth.get("email");
    const record = logEvent(data.type, who, data.details || {});
    const row = {
      id: record.id,
      type: record.get("type"),
      who: record.get("who"),
      createdAt: record.get("createdAt"),
      details: record.get("details"),
    };
    return e.json(200, summarizeLogs([row])[0]);
  },
  $apis.requireAuth(),
);
})();
