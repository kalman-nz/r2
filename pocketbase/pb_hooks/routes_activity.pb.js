/// <reference path="../pb_data/types.d.ts" />
// Named /api/activity, not /api/logs — the latter is PocketBase's own
// built-in superuser request-log endpoint, unrelated to this app's
// print/login/label event feed. Each organisation has its own feed, for
// its admins.

routerAdd(
  "GET",
  "/api/activity",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const ctx = requireOrg(e, "logs.view");
    const records = $app.findRecordsByFilter("logs", "org = {:org}", "-createdAt", 200, 0, { org: ctx.orgId });
    const rows = records.map((r) => ({
      id: r.id,
      type: r.get("type"),
      who: r.get("who"),
      createdAt: r.get("createdAt"),
      details: r.get("details"),
    }));
    return e.json(200, summarizeLogs(rows, { resolveNames: true }));
  },
  $apis.requireAuth("users"),
);

// Page views etc. from the web app. Filed under the current organisation
// when the person belongs to it, otherwise as a platform-wide event.
routerAdd(
  "POST",
  "/api/activity",
  (e) => {
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const { requestOrg, membershipOf } = require(`${__hooks}/lib/orgs.js`);
    const data = e.requestInfo().body || {};
    if (typeof data.type !== "string" || !data.type) throw new BadRequestError("type is required");
    const org = requestOrg(e);
    const who = e.auth.get("name") || e.auth.get("email");
    const record = logEvent(membershipOf($app, e.auth.id, org) ? org : "", data.type, who, data.details || {});
    const row = {
      id: record.id,
      type: record.get("type"),
      who: record.get("who"),
      createdAt: record.get("createdAt"),
      details: record.get("details"),
    };
    return e.json(200, summarizeLogs([row])[0]);
  },
  $apis.requireAuth("users"),
);
