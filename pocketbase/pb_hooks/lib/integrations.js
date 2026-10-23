// What Settings → Integrations reads and changes (routes_sync.pb.js): each
// connector's settings, whether it's healthy, and its recent history. The
// sync itself is lib/sync.js.

const sync = require("./sync.js");
const { decodeJson } = require("./records.js");

const STATUSES = ["enquiry", "provisional", "confirmed", "out", "returned", "cancelled"];

// The {provider} in a route's path.
function providerOf(e) {
  const provider = e.request.pathValue("provider");
  if (sync.PROVIDERS.indexOf(provider) === -1) throw new NotFoundError("Unknown integration");
  return provider;
}

// Everything the page shows for one connector. Secrets are never included,
// only whether one is set.
function summary(org, provider, appUrl) {
  const { getSecret } = require("./settings.js");
  const cfg = sync.getConfig(org, provider);
  const state = sync.getState(org, provider);
  const count = (status) =>
    $app.findRecordsByFilter("sync_queue", "org = {:org} && provider = {:provider} && status = {:status}", "", 0, 0, { org: org, provider: provider, status: status })
      .length;
  const failed = $app.findRecordsByFilter("sync_queue", "org = {:org} && provider = {:provider} && status = 'failed'", "-updated", 20, 0, { org: org, provider: provider });
  const out = {
    config: cfg,
    state: {
      lastPollAt: state.lastPollAt || null,
      lastLinesPollAt: state.lastLinesPollAt || null,
      lastWebhookAt: state.lastWebhookAt || null,
      lastError: state.lastError || "",
      initialDone: !!state.initialDone,
      seenStatuses: state.seenStatuses || {},
      inventoryBlocked: !!state.inventoryBlocked,
      lastInventoryAt: state.lastInventoryAt || null,
    },
    pending: count("pending"),
    failed: failed.map((j) => ({
      id: j.id,
      action: j.getString("action"),
      collection: j.getString("collection"),
      record: j.getString("record"),
      remoteId: j.getString("remoteId"),
      attempts: j.getInt("attempts"),
      error: j.getString("lastError"),
      updated: j.getString("updated"),
    })),
    links: linkCounts(org, provider),
  };
  if (provider === "rentman") {
    out.secretSet = !!(getSecret(org, "rentmanApiToken") || $os.getenv("RENTMAN_API_TOKEN"));
    out.webhookUrl = cfg.webhookKey ? (appUrl || "").replace(/\/$/, "") + "/api/sync/rentman/webhook/" + cfg.webhookKey : "";
  } else {
    out.secretSet = !!getSecret(org, "momentusApiSecret");
  }
  return out;
}

function linkCounts(org, provider) {
  const rows = arrayOf(new DynamicModel({ collection: "", n: 0 }));
  $app
    .db()
    .newQuery("SELECT collection, COUNT(*) AS n FROM sync_links WHERE org = {:org} AND provider = {:provider} GROUP BY collection")
    .bind({ org: org, provider: provider })
    .all(rows);
  const out = {};
  for (const r of rows) out[r.collection] = r.n;
  return out;
}

function recentLog(org, provider, limit) {
  return $app.findRecordsByFilter("sync_log", "org = {:org} && provider = {:provider}", "-created", limit || 20, 0, { org: org, provider: provider }).map((r) => ({
    id: r.id,
    kind: r.getString("kind"),
    status: r.getString("status"),
    counts: decodeJson(r.get("counts"), {}),
    errors: decodeJson(r.get("errors"), []),
    conflicts: decodeJson(r.get("conflicts"), []),
    message: r.getString("message"),
    who: r.getString("who"),
    startedAt: r.getString("startedAt"),
    finishedAt: r.getString("finishedAt"),
  }));
}

// ------------------------------------------------------------ validation

function bool(v, what) {
  if (typeof v !== "boolean") throw new BadRequestError(what + " must be true or false");
  return v;
}

function number(v, what, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestError(what + " must be a number from " + min + " to " + max);
  return n;
}

function oneOf(v, what, values) {
  if (values.indexOf(v) === -1) throw new BadRequestError(what + " must be one of " + values.join(", "));
  return v;
}

function text(v, what, max) {
  if (typeof v !== "string") throw new BadRequestError(what + " must be text");
  const t = v.trim();
  if (t.length > (max || 200)) throw new BadRequestError(what + " is too long");
  return t;
}

function textList(v, what) {
  if (!Array.isArray(v)) throw new BadRequestError(what + " must be a list");
  return v.map((x) => text(String(x), what, 100)).filter(Boolean).slice(0, 200);
}

// Checks each setting sent and returns the connector's new settings (keys
// not sent keep their value; unknown keys are refused).
function cleanConfig(provider, current, body) {
  const next = JSON.parse(JSON.stringify(current));
  const defaults = sync.connector(provider).DEFAULTS;
  for (const key of Object.keys(body || {})) {
    if (!(key in defaults) || key === "webhookKey") throw new BadRequestError("Unknown setting: " + key);
    const v = body[key];
    switch (key) {
      case "enabled":
      case "paused":
      case "projects":
      case "projectRequests":
      case "onlyWithOrders":
      case "pullEvents":
      case "pullOrders":
      case "pushQuotes":
      case "pushInventory":
        next[key] = bool(v, key);
        break;
      case "conflictRule":
        next[key] = oneOf(v, "Conflict rule", ["newest", "remote", "local"]);
        break;
      case "firstSync":
        next[key] = oneOf(v, "First sync", ["remote", "local"]);
        break;
      case "pollMinutes":
        next[key] = number(v, "Check every (minutes)", provider === "momentus" ? 5 : 1, 1440);
        break;
      case "linesPollHours":
        next[key] = number(v, "Project equipment check (hours)", 1, 168);
        break;
      case "pastDays":
        next[key] = number(v, "Days back", 0, 365);
        break;
      case "windowMonths":
        next[key] = number(v, "Months ahead", 1, 36);
        break;
      case "prepHours":
      case "returnHours":
        next[key] = number(v, key === "prepHours" ? "Prep hours" : "Return hours", 0, 240);
        break;
      case "sync":
      case "createInRentman": {
        if (!v || typeof v !== "object") throw new BadRequestError(key + " must be an object");
        for (const c of Object.keys(v)) {
          if (!(c in defaults[key])) throw new BadRequestError("Unknown: " + key + "." + c);
          next[key][c] = key === "sync" ? oneOf(v[c], "Sync direction", ["both", "in"]) : bool(v[c], key + "." + c);
        }
        break;
      }
      case "statusMap": {
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequestError("Status mapping must be an object");
        const map = {};
        for (const code of Object.keys(v).slice(0, 200)) if (v[code]) map[text(code, "Status code", 50)] = oneOf(v[code], "Project status", STATUSES);
        next[key] = map;
        break;
      }
      case "baseUrl": {
        const url = text(v, "Momentus address", 300).replace(/\/$/, "");
        if (url && !/^https:\/\/[^\s/]+/i.test(url) && !(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url) && $os.getenv("R2_ALLOW_HTTP_MOMENTUS"))) {
          throw new BadRequestError("The Momentus address must start with https://");
        }
        next[key] = url;
        break;
      }
      case "orgCode":
      case "apiUserId":
      case "orderDepartment":
      case "orderType":
      case "miscResource":
        next[key] = text(v, key, 100);
        break;
      case "eventStatuses":
      case "departments":
      case "inventoryCategories":
        next[key] = textList(v, key);
        break;
      case "endpoints": {
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequestError("Endpoints must be an object");
        const { ENDPOINTS } = require("./momentus.js");
        const out = {};
        for (const name of Object.keys(v)) {
          if (!(name in ENDPOINTS)) throw new BadRequestError("Unknown endpoint: " + name);
          const p = text(v[name], "Endpoint " + name, 200);
          if (p && !/^\/[A-Za-z0-9_\-/{}.]*$/.test(p)) throw new BadRequestError("Endpoint " + name + " must be a path starting with /");
          if (p) out[name] = p;
        }
        next[key] = out;
        break;
      }
      default:
        throw new BadRequestError("Unknown setting: " + key);
    }
  }
  return next;
}

// Saves settings (and the secret, when sent). Switching Rentman on the
// first time gives it a webhook address.
function update(org, provider, body) {
  const { setSetting } = require("./settings.js");
  const b = Object.assign({}, body || {});
  const secret = b.secret;
  delete b.secret;
  const cfg = cleanConfig(provider, sync.getConfig(org, provider), b);
  if (provider === "rentman" && !cfg.webhookKey) cfg.webhookKey = $security.randomStringWithAlphabet(32, "abcdefghijklmnopqrstuvwxyz0123456789");
  if (secret !== undefined) {
    if (typeof secret !== "string") throw new BadRequestError("The secret must be text");
    setSetting(org, provider === "rentman" ? "rentmanApiToken" : "momentusApiSecret", secret.trim());
  }
  sync.setConfig(org, provider, cfg);
  return cfg;
}

// "Sync now": a full pass, run by the worker within the minute.
function syncNow(org, provider) {
  sync.enqueue(org, provider, "in", "pull", {}, provider === "rentman" ? { full: true } : {});
}

function retryFailed(org, provider) {
  const failed = $app.findRecordsByFilter("sync_queue", "org = {:org} && provider = {:provider} && status = 'failed'", "", 0, 0, { org: org, provider: provider });
  for (const job of failed) {
    job.set("status", "pending");
    job.set("attempts", 0);
    job.set("nextAttemptAt", sync.nowPb());
    $app.save(job);
  }
  return failed.length;
}

function discardFailed(org, provider) {
  const failed = $app.findRecordsByFilter("sync_queue", "org = {:org} && provider = {:provider} && status = 'failed'", "", 0, 0, { org: org, provider: provider });
  for (const job of failed) $app.delete(job);
  return failed.length;
}

// Which connector a record came from, for its page ("Synced from Rentman").
function linkOf(org, collection, recordId) {
  for (const provider of sync.PROVIDERS) {
    const link = sync.findLink(org, provider, collection, { record: recordId });
    if (link) {
      return {
        provider: provider,
        remoteType: link.getString("remoteType"),
        remoteId: link.getString("remoteId"),
        syncedAt: link.getString("syncedAt"),
        extra: decodeJson(link.get("extra"), {}),
        active: sync.isActive(org, provider),
      };
    }
  }
  return null;
}

module.exports = { providerOf, summary, recentLog, cleanConfig, update, syncNow, retryFailed, discardFailed, linkOf };
