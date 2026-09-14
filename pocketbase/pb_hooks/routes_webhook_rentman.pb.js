/// <reference path="../pb_data/types.d.ts" />

// Receives Rentman's "Public API Webhooks" push (Settings > API in Rentman
// — register this exact URL, including the secret, as the webhook target).
// Rentman calls this with no bearer token of ours, so the secret baked into
// the URL path IS the auth check here (same idea as $apis.requireAuth(),
// just not PocketBase-user-based since the caller isn't one).
//
// Rentman's exact payload shape isn't confirmed yet — their docs site
// blocks automated fetches, so lib/sync.js's syncFromWebhookPayload() makes
// a best-effort guess and this handler logs the raw body every time so a
// real payload can be inspected (Settings > Logs, type "rentman_webhook")
// and the parsing tightened once we've seen one for real.
routerAdd("POST", "/api/webhooks/rentman/{secret}", (e) => {
  const expected = $os.getenv("RENTMAN_WEBHOOK_SECRET");
  if (!expected) throw new ForbiddenError("RENTMAN_WEBHOOK_SECRET is not configured");
  if (e.request.pathValue("secret") !== expected) throw new ForbiddenError("Invalid webhook secret");

  const body = e.requestInfo().body || {};
  const { logEvent } = require(`${__hooks}/lib/log.js`);
  logEvent("rentman_webhook", "rentman", { body: body });

  try {
    const { syncFromWebhookPayload } = require(`${__hooks}/lib/sync.js`);
    const synced = syncFromWebhookPayload($app, body);
    return e.json(200, { ok: true, synced: synced });
  } catch (err) {
    console.warn("[webhook rentman] targeted sync failed (" + err + "), falling back to full sync");
    try {
      const { syncAll } = require(`${__hooks}/lib/sync.js`);
      syncAll($app);
      return e.json(200, { ok: true, synced: "all", fallbackReason: String(err) });
    } catch (fallbackErr) {
      console.error("[webhook rentman] full-sync fallback also failed: " + fallbackErr);
      return e.json(202, { ok: false, message: "Webhook received but sync failed: " + String(fallbackErr) });
    }
  }
});
