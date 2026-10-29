/// <reference path="../pb_data/types.d.ts" />
// Calendar subscription feed of jobs (lib/ical.js builds the file).
// Calendar apps can't send a login, so the feed URL carries a long random
// token instead, the same idea as a private Google Calendar address.
// Each organisation has its own; its admins see and rotate it in Settings >
// Business, and rotating breaks every existing subscription. The token lives
// in the settings table under icalToken, which GET /api/app-settings never
// returns.
//

routerAdd("GET", "/api/ical/{token}/jobs.ics", (e) => {
  const { orgForIcalToken, publicSettings } = require(`${__hooks}/lib/settings.js`);
  const { buildIcs } = require(`${__hooks}/lib/ical.js`);
  const { toMs, toPbDate, DAY_MS } = require(`${__hooks}/lib/time.js`);
  const org = orgForIcalToken(e.request.pathValue("token"));
  if (!org) throw new NotFoundError("Unknown calendar");
  // A feed of projects, so none while the organisation doesn't use them.
  const { findOrNull } = require(`${__hooks}/lib/records.js`);
  if (!require(`${__hooks}/lib/features.js`).featuresOf(findOrNull($app, "organisations", org)).projects) throw new NotFoundError("Unknown calendar");

  const now = Date.now();
  const jobs = $app.findRecordsByFilter(
    "jobs",
    "org = {:org} && status != 'cancelled' && returnAt >= {:from} && prepAt <= {:to}",
    "prepAt",
    2000,
    0,
    { org: org, from: toPbDate(now - 60 * DAY_MS), to: toPbDate(now + 366 * DAY_MS) },
  );
  const names = (collection, ids) => {
    const map = {};
    for (const r of $app.findRecordsByIds(collection, ids.filter(Boolean))) if (r) map[r.id] = r.getString("name");
    return map;
  };
  const periodsByJob = {};
  if (jobs.length > 0) {
    const periods = $app.findRecordsByFilter(
      "job_periods",
      "org = {:org} && end >= {:from} && start <= {:to}",
      "start",
      0,
      0,
      { org: org, from: toPbDate(now - 60 * DAY_MS), to: toPbDate(now + 400 * DAY_MS) },
    );
    for (const p of periods) {
      const list = (periodsByJob[p.getString("job")] = periodsByJob[p.getString("job")] || []);
      list.push({ kind: p.getString("kind"), name: p.getString("name"), start: toMs(p.getString("start")), end: toMs(p.getString("end")) });
    }
  }
  const clients = names("contacts", jobs.map((j) => j.getString("client")));
  const venues = names("venues", jobs.map((j) => j.getString("venue")));
  // The organisation's own status names (Settings → Project statuses).
  const statusNames = names("job_statuses", jobs.map((j) => j.getString("jobStatus")));
  const proto = e.request.header.get("X-Forwarded-Proto") || (e.request.tls ? "https" : "http");
  const base = proto + "://" + e.request.host;

  const settings = publicSettings(org);
  const ics = buildIcs(
    jobs.map((j) => ({
      id: j.id,
      number: j.getInt("number"),
      name: j.getString("name"),
      status: j.getString("status"),
      statusName: statusNames[j.getString("jobStatus")] || "",
      start: toMs(j.getString("prepAt")),
      end: toMs(j.getString("returnAt")),
      client: clients[j.getString("client")] || "",
      venue: venues[j.getString("venue")] || "",
      updated: toMs(j.getString("updated")),
      url: base + "/projects/" + j.id,
      periods: periodsByJob[j.id] || [],
    })),
    (settings.businessShortName || settings.businessName || "R2") + " projects",
    now,
  );
  return e.blob(200, "text/calendar; charset=utf-8", toBytes(ics));
});

// Returns the feed address for the current organisation, creating its token
// the first time. (Each handler builds the URL itself: handlers can't share
// a helper from this file's scope.)
routerAdd(
  "GET",
  "/api/ical/link",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { getSecret, setSetting } = require(`${__hooks}/lib/settings.js`);
    const ctx = requireOrg(e, "calendar.manage");
    let token = getSecret(ctx.orgId, "icalToken");
    if (!token) {
      token = $security.randomString(32);
      setSetting(ctx.orgId, "icalToken", token);
    }
    const proto = e.request.header.get("X-Forwarded-Proto") || (e.request.tls ? "https" : "http");
    return e.json(200, { url: proto + "://" + e.request.host + "/api/ical/" + token + "/jobs.ics" });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/ical/rotate",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { setSetting } = require(`${__hooks}/lib/settings.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireOrg(e, "calendar.manage");
    const token = $security.randomString(32);
    setSetting(ctx.orgId, "icalToken", token);
    logEvent(ctx.orgId, "ical_rotated", whoName(e.auth), {});
    const proto = e.request.header.get("X-Forwarded-Proto") || (e.request.tls ? "https" : "http");
    return e.json(200, { url: proto + "://" + e.request.host + "/api/ical/" + token + "/jobs.ics" });
  },
  $apis.requireAuth("users"),
);
