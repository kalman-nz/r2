// The live sync engine shared by every connector (lib/rentmanSync.js,
// lib/momentusSync.js).
//
// - Links (sync_links) say which R2 record is which remote record, and hold
//   `base`, the fields both sides last agreed on, for the three-way merge
//   in lib/merge.js.
// - R2 never calls the other system inside someone's request. Record hooks
//   (records_sync.pb.js) and webhooks only add rows to sync_queue; the
//   worker (cron in routes_sync.pb.js) works through it every minute and
//   runs each connector's catch-up poll when it's due.
// - Writes the sync makes itself are "quiet": the record hooks skip them,
//   so pulling 5,000 items in doesn't queue 5,000 pushes back out. (The
//   merge would make those no-ops anyway; this just saves the work.)
// - Deletes never cross over. A connector archives on the other side, or
//   leaves the record and says so in the log.
//
// Each organisation's settings for a connector are one JSON settings row,
// "sync.<provider>", and its bookkeeping (last poll and so on) another,
// "sync.<provider>.state", so the worker never overwrites an admin's edit.

const { merge, isEmpty } = require("./merge.js");
const { decodeJson, errorMessage } = require("./records.js");

const PROVIDERS = ["rentman", "momentus"];
const MAX_ATTEMPTS = 8;
const MAX_LOG_ITEMS = 300;

function connector(provider) {
  if (provider === "rentman") return require(`${__hooks}/lib/rentmanSync.js`);
  if (provider === "momentus") return require(`${__hooks}/lib/momentusSync.js`);
  throw new BadRequestError("Unknown integration: " + provider);
}

function nowPb() {
  return new Date().toISOString().replace("T", " ");
}

// ---------------------------------------------------------------- settings

function readJsonSetting(org, key) {
  const row = $app.findRecordsByFilter("settings", "org = {:org} && key = {:key}", "", 1, 0, { org: org, key: key })[0];
  if (!row) return {};
  try {
    return JSON.parse(row.getString("value") || "{}") || {};
  } catch (_) {
    return {};
  }
}

function writeJsonSetting(org, key, value) {
  const { setSetting } = require("./settings.js");
  setSetting(org, key, JSON.stringify(value));
}

// The connector's settings with its defaults filled in, as the sync uses
// them: while the organisation has projects off, the connector's
// WITHOUT_PROJECTS on top (equipment only). raw: as saved, for Settings →
// Integrations to show and change, so turning projects back on picks up
// the admin's own choices.
function getConfig(org, provider, raw) {
  const { featuresOf } = require("./features.js");
  const { findOrNull } = require("./records.js");
  const defaults = connector(provider).DEFAULTS;
  const stored = readJsonSetting(org, "sync." + provider);
  const out = Object.assign({}, defaults, stored);
  // Nested objects merge one level down, so a new resource gets its default.
  for (const key of Object.keys(defaults)) {
    const d = defaults[key];
    if (d && typeof d === "object" && !Array.isArray(d)) out[key] = Object.assign({}, d, stored[key] || {});
  }
  if (!raw && !featuresOf(findOrNull($app, "organisations", org)).projects) Object.assign(out, connector(provider).WITHOUT_PROJECTS || {});
  return out;
}

function setConfig(org, provider, config) {
  writeJsonSetting(org, "sync." + provider, config);
}

function getState(org, provider) {
  return readJsonSetting(org, "sync." + provider + ".state");
}

function patchState(org, provider, changes) {
  const state = getState(org, provider);
  writeJsonSetting(org, "sync." + provider + ".state", Object.assign(state, changes));
}

// Whether the organisation still has live sync on (Settings → Features)
// and isn't suspended.
function orgAllows(org) {
  const { featuresOf } = require("./features.js");
  try {
    const record = $app.findRecordById("organisations", org);
    return !record.getBool("suspended") && featuresOf(record).integrations;
  } catch (_) {
    return false;
  }
}

// Organisations with this connector switched on and not paused.
function activeOrgs(provider) {
  const rows = $app.findRecordsByFilter("settings", "key = {:key}", "", 0, 0, { key: "sync." + provider });
  const out = [];
  for (const row of rows) {
    let cfg = {};
    try {
      cfg = JSON.parse(row.getString("value") || "{}") || {};
    } catch (_) {
      continue;
    }
    if (cfg.enabled && !cfg.paused && orgAllows(row.getString("org"))) out.push(row.getString("org"));
  }
  return out;
}

function isActive(org, provider) {
  if (!org) return false;
  const cfg = readJsonSetting(org, "sync." + provider);
  return !!cfg.enabled && !cfg.paused && orgAllows(org);
}

// Called by records_sync.pb.js after an R2 record is saved or deleted:
// each connector that's on decides whether to queue anything. Never
// throws: a sync problem mustn't stop someone saving.
function onLocalChange(record, event) {
  try {
    const org = record.getString("org");
    if (!org || isQuiet(record)) return;
    for (const provider of PROVIDERS) {
      if (isActive(org, provider)) connector(provider).onLocalChange(org, getConfig(org, provider), event, record);
    }
  } catch (err) {
    console.error("sync: couldn't queue " + record.collection().name + " " + record.id + ": " + errorMessage(err));
  }
}

// ------------------------------------------------------------------- links

function findLink(org, provider, collection, by) {
  const field = by.record !== undefined ? "record" : "remoteId";
  const value = String(by.record !== undefined ? by.record : by.remoteId);
  if (!value) return null;
  return (
    $app.findRecordsByFilter(
      "sync_links",
      "org = {:org} && provider = {:provider} && collection = {:collection} && " + field + " = {:value}",
      "",
      1,
      0,
      { org: org, provider: provider, collection: collection, value: value },
    )[0] || null
  );
}

// { remoteId: recordId } for everything linked in a collection, so a big
// pull doesn't query once per row.
function linkMap(org, provider, collection) {
  const rows = arrayOf(new DynamicModel({ record: "", remoteId: "" }));
  $app
    .db()
    .newQuery("SELECT record, remoteId FROM sync_links WHERE org = {:org} AND provider = {:provider} AND collection = {:collection}")
    .bind({ org: org, provider: provider, collection: collection })
    .all(rows);
  const map = {};
  for (const r of rows) map[r.remoteId] = r.record;
  return map;
}

function saveLink(org, provider, collection, recordId, remoteType, remoteId, base, remoteModified, extra) {
  let link = findLink(org, provider, collection, { remoteId: remoteId }) || findLink(org, provider, collection, { record: recordId });
  if (!link) link = new Record($app.findCollectionByNameOrId("sync_links"), { org: org, provider: provider, collection: collection });
  link.set("record", recordId);
  link.set("remoteType", remoteType || "");
  link.set("remoteId", String(remoteId));
  if (base !== undefined) link.set("base", base);
  if (remoteModified !== undefined) link.set("remoteModified", remoteModified || "");
  if (extra !== undefined) link.set("extra", extra);
  link.set("syncedAt", nowPb());
  $app.save(link);
  return link;
}

function linkBase(link) {
  return link ? decodeJson(link.get("base"), null) : null;
}

function hasBase(link) {
  const base = linkBase(link);
  return !!base && Object.keys(base).length > 0;
}

// ---------------------------------------------------------- quiet writes

function quietKey(id) {
  return "syncQuiet:" + id;
}

function isQuiet(record) {
  return !!$app.store().get(quietKey(record.id));
}

// Saves without the record hooks queueing it to go back out. New records
// get their id first, so the hooks can recognise them.
function quietSave(record) {
  if (!record.id) record.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
  const key = quietKey(record.id);
  $app.store().set(key, true);
  try {
    $app.save(record);
  } finally {
    $app.store().remove(key);
  }
  return record;
}

function quietDelete(record) {
  const key = quietKey(record.id);
  $app.store().set(key, true);
  try {
    $app.delete(record);
  } finally {
    $app.store().remove(key);
  }
}

// ------------------------------------------------------------ R2 values

// A record's fields in the plain shape lib/merge.js compares.
function localFields(record, fields) {
  const out = {};
  for (const key of fields) {
    const field = record.collection().fields.getByName(key);
    if (!field) continue;
    switch (field.type()) {
      case "json":
        out[key] = decodeJson(record.get(key), null);
        break;
      case "number":
        out[key] = record.getFloat(key);
        break;
      case "bool":
        out[key] = record.getBool(key);
        break;
      default:
        out[key] = record.getString(key);
    }
  }
  return out;
}

// ------------------------------------------------------------ reconcile

// Brings one record into line with its remote copy: the heart of every pull.
//   spec.collection, spec.remoteType  where it lives on each side
//   spec.remoteId                      its id over there
//   spec.remote                        the remote copy in R2's shape (or null)
//   spec.remoteModified                the remote's change stamp, if any
//   spec.newRecord                     extra fields for a record R2 creates
//                                      (org is set for you)
//   spec.record                        an R2 record to link to when there's
//                                      no link yet (e.g. matched by code)
//   spec.outFields, spec.direction     see lib/merge.js
//   spec.createLocal                   false: don't create missing records
// run is the pass's log (startRun). R2 changes that need to go out aren't
// sent from here: they're queued, and base keeps the old value for those
// fields until the push succeeds.
// Returns { record, created, changed, toRemote } (record null if skipped).
function reconcile(org, provider, cfg, spec, run) {
  let link = findLink(org, provider, spec.collection, { remoteId: spec.remoteId });
  let record = null;
  if (link) {
    try {
      record = $app.findRecordById(spec.collection, link.getString("record"));
    } catch (_) {
      // Deleted in R2 since. Deletes don't cross over, and it isn't
      // brought back either: forget the link.
      $app.delete(link);
      run.count(spec.collection + " deleted in R2, not re-created");
      return { record: null, created: false, changed: false, toRemote: {} };
    }
  } else if (spec.record) {
    record = spec.record;
  }
  if (!record && spec.createLocal === false) return { record: null, created: false, changed: false, toRemote: {} };

  const fields = Object.keys(spec.remote || {});
  const base = linkBase(link);
  const local = record ? localFields(record, fields) : null;
  const localMs = record ? Date.parse(record.getString("updated").replace(" ", "T")) : 0;
  const remoteMs = spec.remoteModified ? Date.parse(String(spec.remoteModified)) : 0;
  const m = merge(hasBase(link) ? base : null, local, spec.remote, {
    fields: fields,
    outFields: spec.outFields,
    direction: spec.direction || "in",
    rule: cfg.conflictRule || "newest",
    localNewer: localMs > remoteMs,
    firstSync: cfg.firstSync || "remote",
  });
  for (const c of m.conflicts) run.conflict(spec.collection, record ? record.id : "", spec.remoteId, c);

  let created = false;
  if (!record) {
    record = new Record($app.findCollectionByNameOrId(spec.collection), Object.assign({ org: org }, spec.newRecord || {}));
    created = true;
  }
  const changed = !isEmpty(m.toLocal) || created;
  // Rentman links also stamp the record's rentmanId, which the one-off
  // import matches on.
  const stamp =
    provider === "rentman" && record.collection().fields.getByName("rentmanId") && record.getString("rentmanId") !== String(spec.remoteId);
  if (changed || stamp) {
    for (const key of Object.keys(m.toLocal)) record.set(key, m.toLocal[key]);
    if (stamp) record.set("rentmanId", String(spec.remoteId));
    quietSave(record);
  }
  // Fields still waiting to go out keep their old base.
  const nextBase = Object.assign({}, m.base);
  for (const key of Object.keys(m.toRemote)) nextBase[key] = base ? base[key] : undefined;
  saveLink(org, provider, spec.collection, record.id, spec.remoteType, spec.remoteId, nextBase, spec.remoteModified);
  if (!isEmpty(m.toRemote)) {
    enqueue(org, provider, "out", "upsert", { collection: spec.collection, record: record.id, remoteType: spec.remoteType, remoteId: spec.remoteId });
  }
  return { record: record, created: created, changed: changed, toRemote: m.toRemote };
}

// After a push: what R2 sent is now what both sides agree on.
function agree(link, fields) {
  const base = linkBase(link) || {};
  link.set("base", Object.assign(base, fields));
  link.set("syncedAt", nowPb());
  $app.save(link);
}

// ------------------------------------------------------------------ queue

// Adds work for the worker, unless the same work is already waiting.
function enqueue(org, provider, direction, action, target, payload) {
  const t = target || {};
  const existing = $app.findRecordsByFilter(
    "sync_queue",
    "org = {:org} && provider = {:provider} && direction = {:direction} && action = {:action} && collection = {:collection} && record = {:record} && remoteType = {:remoteType} && remoteId = {:remoteId} && status = 'pending'",
    "",
    1,
    0,
    {
      org: org,
      provider: provider,
      direction: direction,
      action: action,
      collection: t.collection || "",
      record: t.record || "",
      remoteType: t.remoteType || "",
      remoteId: String(t.remoteId || ""),
    },
  )[0];
  if (existing) {
    if (payload) {
      existing.set("payload", Object.assign(decodeJson(existing.get("payload"), {}), payload));
      $app.save(existing);
    }
    return existing;
  }
  const job = new Record($app.findCollectionByNameOrId("sync_queue"), {
    org: org,
    provider: provider,
    direction: direction,
    action: action,
    collection: t.collection || "",
    record: t.record || "",
    remoteType: t.remoteType || "",
    remoteId: String(t.remoteId || ""),
    payload: payload || {},
    status: "pending",
    attempts: 0,
    nextAttemptAt: nowPb(),
  });
  $app.save(job);
  return job;
}

// A run's log: counts, errors and conflicts, saved as one sync_log row.
function startRun(org, provider, kind, who) {
  const counts = {};
  const errors = [];
  const conflicts = [];
  const startedAt = nowPb();
  return {
    org: org,
    provider: provider,
    counts: counts,
    errors: errors,
    conflicts: conflicts,
    count(key, n) {
      counts[key] = (counts[key] || 0) + (n === undefined ? 1 : n);
    },
    fail(what, id, name, err) {
      if (errors.length < MAX_LOG_ITEMS) errors.push({ what: what, id: String(id || ""), name: name || "", message: errorMessage(err) });
    },
    conflict(collection, recordId, remoteId, c) {
      if (conflicts.length < MAX_LOG_ITEMS) {
        conflicts.push({ collection: collection, record: recordId, remoteId: String(remoteId), field: c.field, local: c.local, remote: c.remote, winner: c.winner });
      }
    },
    empty() {
      return Object.keys(counts).length === 0 && errors.length === 0 && conflicts.length === 0;
    },
    finish(message, failed) {
      const log = new Record($app.findCollectionByNameOrId("sync_log"), {
        org: org,
        provider: provider,
        kind: kind,
        status: failed ? "failed" : errors.length ? "partial" : "ok",
        counts: counts,
        errors: errors,
        conflicts: conflicts,
        message: message || "",
        who: who || "",
        startedAt: startedAt,
        finishedAt: nowPb(),
      });
      $app.save(log);
      return log;
    },
  };
}

// Backoff: 1, 2, 4… minutes, capped at an hour.
function retryAt(attempts) {
  const minutes = Math.min(60, Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60000).toISOString().replace("T", " ");
}

// Works through due queue rows, a bounded batch per organisation and
// connector so one busy account can't starve the rest. One sync_log row per
// organisation and connector that had anything to do.
function drainQueue(limit) {
  const due = $app.findRecordsByFilter("sync_queue", "status = 'pending' && nextAttemptAt <= {:now}", "created", limit || 200, 0, { now: nowPb() });
  const runs = {};
  for (const job of due) {
    const org = job.getString("org");
    const provider = job.getString("provider");
    if (!isActive(org, provider)) continue;
    const key = org + ":" + provider;
    if (!runs[key]) runs[key] = { run: startRun(org, provider, "queue", ""), cfg: getConfig(org, provider) };
    const { run, cfg } = runs[key];
    try {
      connector(provider).handle(job, cfg, run);
      $app.delete(job);
    } catch (err) {
      const attempts = job.getInt("attempts") + 1;
      job.set("attempts", attempts);
      job.set("lastError", errorMessage(err).slice(0, 5000));
      if (attempts >= MAX_ATTEMPTS || (err && err.permanent)) {
        job.set("status", "failed");
        run.fail(job.getString("action") + " " + (job.getString("collection") || job.getString("remoteType")), job.getString("record") || job.getString("remoteId"), "", err);
      } else {
        job.set("nextAttemptAt", retryAt(attempts));
      }
      $app.save(job);
    }
  }
  for (const key of Object.keys(runs)) if (!runs[key].run.empty()) runs[key].run.finish("");
}

// Each connector's catch-up pass, for organisations it's due for.
function runPolls() {
  for (const provider of PROVIDERS) {
    for (const org of activeOrgs(provider)) {
      const cfg = getConfig(org, provider);
      const state = getState(org, provider);
      const c = connector(provider);
      if (!c.pollDue(cfg, state, Date.now())) continue;
      runPoll(org, provider, cfg, state, "");
    }
  }
}

function runPoll(org, provider, cfg, state, who, options) {
  const run = startRun(org, provider, "poll", who);
  try {
    const changes = connector(provider).poll(org, cfg, state || getState(org, provider), run, options || {});
    patchState(org, provider, Object.assign({ lastPollAt: Date.now(), lastError: "" }, changes || {}));
    run.finish("");
  } catch (err) {
    patchState(org, provider, { lastPollAt: Date.now(), lastError: errorMessage(err) });
    run.finish(errorMessage(err), true);
  }
  return run;
}

// The cron entry point. A lock in the app store stops a slow tick from
// overlapping the next one (stale after 30 minutes, in case one died).
function tick() {
  const store = $app.store();
  const held = store.get("syncWorkerLock");
  if (held && Date.now() - held < 30 * 60000) return;
  store.set("syncWorkerLock", Date.now());
  try {
    drainQueue(200);
    runPolls();
  } finally {
    store.remove("syncWorkerLock");
  }
}

// ---------------------------------------------------------------- errors

// A failure retrying won't fix (Rentman refusing a field, no licence for a
// Momentus endpoint): the queue row is marked failed straight away.
function permanentError(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

module.exports = {
  PROVIDERS,
  connector,
  getConfig,
  setConfig,
  getState,
  patchState,
  isActive,
  activeOrgs,
  findLink,
  linkMap,
  saveLink,
  linkBase,
  agree,
  isQuiet,
  onLocalChange,
  quietSave,
  quietDelete,
  localFields,
  reconcile,
  enqueue,
  startRun,
  drainQueue,
  runPoll,
  tick,
  permanentError,
  nowPb,
};
