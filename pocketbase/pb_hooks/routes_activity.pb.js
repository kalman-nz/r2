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

// Page views from the web app, filed under the current organisation. Only
// genuine client-side events come through here, and only for an
// organisation the person is in: everything the audit log counts as
// evidence (logins, prints, member and role changes, repairs…) is written
// by the server itself (lib/log.js), never from the browser. So the client
// can't forge one of those by sending its type, write a platform-wide
// (org "") entry, or spam large rows.
routerAdd(
  "POST",
  "/api/activity",
  (e) => {
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const { requestOrg, membershipOf } = require(`${__hooks}/lib/orgs.js`);
    // The events the browser is allowed to file. Declared in the handler:
    // the JSVM doesn't keep this file's outer scope when a request runs.
    const CLIENT_EVENTS = ["page_view"];
    const data = e.requestInfo().body || {};
    if (CLIENT_EVENTS.indexOf(data.type) === -1) throw new BadRequestError("Unknown event");
    const org = requestOrg(e);
    if (!org || !membershipOf($app, e.auth.id, org)) throw new ForbiddenError("You're not a member of this organisation");
    const details = data.details && typeof data.details === "object" && !Array.isArray(data.details) ? data.details : {};
    if (JSON.stringify(details).length > 2048) throw new BadRequestError("Too much detail on that event");
    const who = e.auth.get("name") || e.auth.get("email");
    const record = logEvent(org, data.type, who, details);
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
