/// <reference path="../pb_data/types.d.ts" />
// Live sync with Rentman and Momentus (lib/sync.js) and Settings →
// Integrations (lib/integrations.js). Everything but the webhook needs
// integrations.manage.

// The worker: queued work, then any catch-up passes that are due.
cronAdd("r2Sync", "* * * * *", () => {
  require(`${__hooks}/lib/sync.js`).tick();
});

routerAdd(
  "GET",
  "/api/integrations",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { summary } = require(`${__hooks}/lib/integrations.js`);
    const ctx = requireOrg(e, "integrations.manage");
    const appUrl = $os.getenv("R2_PUBLIC_API_URL") || $app.settings().meta.appURL;
    return e.json(200, { rentman: summary(ctx.orgId, "rentman", appUrl), momentus: summary(ctx.orgId, "momentus", appUrl) });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/integrations/{provider}",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { update, summary, providerOf } = require(`${__hooks}/lib/integrations.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "integrations.manage");
    const provider = providerOf(e);
    const body = e.requestInfo().body || {};
    update(ctx.orgId, provider, body);
    logEvent(ctx.orgId, "integration_settings", whoName(e.auth), { provider: provider, changed: Object.keys(body).filter((k) => k !== "secret").concat(body.secret !== undefined ? ["secret"] : []) });
    return e.json(200, summary(ctx.orgId, provider, $os.getenv("R2_PUBLIC_API_URL") || $app.settings().meta.appURL));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/integrations/{provider}/test",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const sync = require(`${__hooks}/lib/sync.js`);
    const { providerOf } = require(`${__hooks}/lib/integrations.js`);
    const { errorMessage } = require(`${__hooks}/lib/records.js`);
    const ctx = requireOrg(e, "integrations.manage");
    const provider = providerOf(e);
    try {
      return e.json(200, sync.connector(provider).test(ctx.orgId));
    } catch (err) {
      return e.json(200, { ok: false, message: errorMessage(err) });
    }
  },
  $apis.requireAuth("users"),
);

// body: { action: "sync" | "retry" | "discard" | "pushInventory" }
routerAdd(
  "POST",
  "/api/integrations/{provider}/actions",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const integrations = require(`${__hooks}/lib/integrations.js`);
    const sync = require(`${__hooks}/lib/sync.js`);
    const ctx = requireOrg(e, "integrations.manage");
    const provider = integrations.providerOf(e);
    const action = (e.requestInfo().body || {}).action;
    if (!sync.isActive(ctx.orgId, provider) && action !== "discard") throw new BadRequestError("Turn the sync on first");
    let result = {};
    if (action === "sync") integrations.syncNow(ctx.orgId, provider);
    else if (action === "retry") result.retried = integrations.retryFailed(ctx.orgId, provider);
    else if (action === "discard") result.discarded = integrations.discardFailed(ctx.orgId, provider);
    else if (action === "pushInventory" && provider === "momentus") sync.enqueue(ctx.orgId, "momentus", "out", "pushInventory", {});
    else throw new BadRequestError("Unknown action");
    return e.json(200, Object.assign({ ok: true }, result));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/integrations/{provider}/log",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { recentLog, providerOf } = require(`${__hooks}/lib/integrations.js`);
    const ctx = requireOrg(e, "integrations.manage");
    return e.json(200, recentLog(ctx.orgId, providerOf(e), 30));
  },
  $apis.requireAuth("users"),
);

// For venues whose Momentus licence won't take resources over the API.
routerAdd(
  "GET",
  "/api/integrations/momentus/resources.csv",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const sync = require(`${__hooks}/lib/sync.js`);
    const { resourcesCsv } = require(`${__hooks}/lib/momentusSync.js`);
    const ctx = requireOrg(e, "integrations.manage");
    e.response.header().set("Content-Disposition", 'attachment; filename="momentus-resources.csv"');
    return e.blob(200, "text/csv; charset=utf-8", toBytes(resourcesCsv(ctx.orgId, sync.getConfig(ctx.orgId, "momentus"))));
  },
  $apis.requireAuth("users"),
);

// Which integration a project (or other record) is synced with, for its page.
routerAdd(
  "GET",
  "/api/integrations/link/{collection}/{id}",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { linkOf } = require(`${__hooks}/lib/integrations.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const collection = e.request.pathValue("collection");
    if (["jobs", "items", "contacts", "venues"].indexOf(collection) === -1) throw new NotFoundError("Not synced");
    const record = findOrNull($app, collection, e.request.pathValue("id"));
    if (!record) throw new NotFoundError("Not found");
    const ctx = requireRecordOrg(e, record);
    const sync = require(`${__hooks}/lib/sync.js`);
    const link = linkOf(ctx.orgId, collection, record.id);
    // Whether this person can send the project to Rentman from its page.
    const canSendToRentman =
      collection === "jobs" && !link && ctx.can("jobs.edit") && sync.isActive(ctx.orgId, "rentman") && !!sync.getConfig(ctx.orgId, "rentman").projectRequests;
    const pending =
      collection === "jobs" &&
      $app.findRecordsByFilter("sync_queue", "org = {:org} && record = {:id} && action = 'projectRequest'", "", 1, 0, { org: ctx.orgId, id: record.id }).length > 0;
    return e.json(200, { link: link, canSendToRentman: canSendToRentman, sending: pending });
  },
  $apis.requireAuth("users"),
);

// Sends an R2 project to Rentman as a project request (when the
// organisation allows it).
routerAdd(
  "POST",
  "/api/integrations/rentman/project-request/{jobId}",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireJob } = require(`${__hooks}/lib/jobs.js`);
    const sync = require(`${__hooks}/lib/sync.js`);
    const job = requireJob($app, e.request.pathValue("jobId"));
    const ctx = requireRecordOrg(e, job, "jobs.edit");
    if (!sync.isActive(ctx.orgId, "rentman") || !sync.getConfig(ctx.orgId, "rentman").projectRequests) {
      throw new BadRequestError("Sending projects to Rentman is turned off (Settings → Integrations)");
    }
    if (sync.findLink(ctx.orgId, "rentman", "jobs", { record: job.id })) throw new BadRequestError("This project is already in Rentman");
    sync.enqueue(ctx.orgId, "rentman", "out", "projectRequest", { collection: "jobs", record: job.id });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// Rentman's webhook. The key in the address says which organisation; the
// body only says what to re-read, which the worker fetches from Rentman
// itself, so nothing in it is trusted. Always 200 for a known key, so
// Rentman doesn't disable the webhook over one odd message.
routerAdd("POST", "/api/sync/rentman/webhook/{key}", (e) => {
  const rentman = require(`${__hooks}/lib/rentmanSync.js`);
  const sync = require(`${__hooks}/lib/sync.js`);
  const org = rentman.orgForWebhookKey(e.request.pathValue("key"));
  if (!org) throw new NotFoundError("Unknown webhook");
  let result = { queued: 0 };
  try {
    result = rentman.onWebhook(org, sync.getConfig(org, "rentman"), e.requestInfo().body || {});
    sync.patchState(org, "rentman", { lastWebhookAt: Date.now() });
  } catch (err) {
    console.error("rentman webhook: " + err);
  }
  return e.json(200, Object.assign({ ok: true }, result));
});

// Runs the worker now instead of waiting for the next minute: for
// operations and scripts/sync-e2e.mjs. Superusers only.
routerAdd(
  "POST",
  "/api/sync/tick",
  (e) => {
    require(`${__hooks}/lib/sync.js`).tick();
    return e.json(200, { ok: true });
  },
  $apis.requireSuperuserAuth(),
);
