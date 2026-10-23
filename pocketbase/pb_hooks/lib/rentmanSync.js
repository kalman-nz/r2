// Live sync with Rentman, on the engine in lib/sync.js.
//
// Coming in (Rentman → R2): everything the import brings (lib/imports.js).
// Rentman's webhooks say something changed, and the worker re-reads it
// from Rentman with the organisation's own token; the webhook body itself
// is never trusted, so a forged call can only cause a harmless re-read. A
// catch-up pass every pollMinutes catches anything a webhook missed.
//
// Going out (R2 → Rentman): items, contacts and locations, the fields in
// lib/rentmanMap.js. Rentman's API doesn't let anyone change a project or
// its equipment, so projects only come in; a project made in R2 can be
// sent to Rentman as a project request, which someone accepts there, and
// it links back up when it comes in as a project.
//
// Deletes don't cross over: equipment or contacts removed in Rentman are
// archived in R2, and the other way round equipment is archived in Rentman.

const sync = require("./sync.js");
const { MAPS, outFields } = require("./rentmanMap.js");

const DEFAULTS = {
  enabled: false,
  paused: false,
  // Both sides changed the same field: "newest" | "remote" (Rentman) | "local" (R2)
  conflictRule: "newest",
  // The first live sync of a record imported before: who wins where they differ.
  firstSync: "remote",
  pollMinutes: 15,
  // Project equipment is by far the longest list, so its full re-read is
  // rarer; webhooks keep it current in between.
  linesPollHours: 6,
  // Which way each two-way collection syncs: "both" or "in" (Rentman's copy rules).
  sync: { items: "both", contacts: "both", venues: "both" },
  // Whether something made in R2 is created in Rentman too.
  createInRentman: { items: true, contacts: true, venues: false },
  // Pull projects and their equipment.
  projects: true,
  // Let people send R2 projects to Rentman as project requests.
  projectRequests: false,
  // The secret part of this organisation's webhook address.
  webhookKey: "",
};

const TWO_WAY = ["items", "contacts", "venues"];

function tokenFor(org) {
  const { getSecret } = require("./settings.js");
  return getSecret(org, "rentmanApiToken") || $os.getenv("RENTMAN_API_TOKEN");
}

function clientFor(org) {
  const { createRentmanClient } = require("./rentman.js");
  return createRentmanClient(tokenFor(org));
}

function directionOf(cfg, collection) {
  return TWO_WAY.indexOf(collection) !== -1 && (cfg.sync || {})[collection] === "both" ? "both" : "in";
}

// category id ↔ Rentman folder id, both ways.
function folderRefs(org) {
  const categories = sync.linkMap(org, "rentman", "categories");
  const folderOf = {};
  for (const folderId of Object.keys(categories)) folderOf[categories[folderId]] = folderId;
  return { categoryFor: (folderId) => categories[folderId] || "", folderFor: (categoryId) => folderOf[categoryId] || "" };
}

// What lib/imports.js calls instead of overwriting, in a live sync.
function syncContext(org, cfg, run) {
  return {
    reconcile(collection, remoteType, remoteId, data, newRecord, modified) {
      const direction = directionOf(cfg, collection);
      return sync.reconcile(
        org,
        "rentman",
        cfg,
        {
          collection: collection,
          remoteType: remoteType,
          remoteId: String(remoteId),
          remote: data,
          remoteModified: modified || "",
          newRecord: newRecord || {},
          direction: direction,
          outFields: direction === "both" ? outFields(collection) : [],
        },
        run,
      );
    },
    // Linked records whose Rentman copy has gone: archived, never deleted.
    archiveMissing(collection, seen) {
      const linked = sync.linkMap(org, "rentman", collection);
      for (const remoteId of Object.keys(linked)) {
        if (seen[remoteId]) continue;
        archiveLocal(org, collection, linked[remoteId], run);
      }
    },
    // A project R2 sent as a request, now accepted in Rentman: the request's
    // link moves to the project. Matched on name, as Rentman doesn't say
    // which request a project came from.
    adoptProject(p) {
      const name = String(p.displayname || p.name || "").trim().toLowerCase();
      if (!name) return null;
      const requests = $app.findRecordsByFilter(
        "sync_links",
        "org = {:org} && provider = 'rentman' && collection = 'jobs' && remoteType = 'projectrequests'",
        "",
        0,
        0,
        { org: org },
      );
      for (const link of requests) {
        const job = findOrNull("jobs", link.getString("record"));
        if (!job || job.getString("name").trim().toLowerCase() !== name) continue;
        sync.saveLink(org, "rentman", "jobs", job.id, "projects", String(p.id), {}, p.modified || "");
        job.set("rentmanId", String(p.id));
        sync.quietSave(job);
        run.count("project requests accepted");
        return job.id;
      }
      return null;
    },
  };
}

function findOrNull(collection, id) {
  const { findOrNull } = require("./records.js");
  return findOrNull($app, collection, id);
}

function archiveLocal(org, collection, recordId, run) {
  const record = findOrNull(collection, recordId);
  if (!record || !record.collection().fields.getByName("archived") || record.getBool("archived")) return;
  record.set("archived", true);
  sync.quietSave(record);
  run.count(collection + " archived (gone from Rentman)");
}

// Every linked project line Rentman no longer has (deleted, or turned into
// an option or a zero placeholder, which the import skips) goes from R2.
// Projects only come in, so their lines follow Rentman exactly.
function removeLines(org, rentmanIds, run) {
  for (const remoteId of rentmanIds) {
    const link = sync.findLink(org, "rentman", "job_lines", { remoteId: remoteId });
    if (!link) continue;
    const line = findOrNull("job_lines", link.getString("record"));
    if (line) {
      sync.quietDelete(line);
      run.count("lines removed");
    }
    try {
      $app.delete(link);
    } catch (_) {
      // gone with the line (cascade)
    }
  }
}

function pollDue(cfg, state, now) {
  return !state.initialDone || now - (state.lastPollAt || 0) >= Math.max(1, Number(cfg.pollMinutes) || 15) * 60000;
}

// The catch-up pass: the import's steps, merging instead of overwriting.
// options.steps limits it (a webhook's "pull"); lines are re-read in full
// every linesPollHours, or when asked.
function poll(org, cfg, state, run, options) {
  const imports = require("./imports.js");
  const client = clientFor(org);
  const ctx = syncContext(org, cfg, run);
  const fail = run.fail;
  const counts = run.counts;
  const steps = options.steps || { equipment: true, contacts: true, projects: !!cfg.projects };
  const now = Date.now();
  const linesDue = cfg.projects && (options.lines || (!options.steps && now - (state.lastLinesPollAt || 0) >= (Number(cfg.linesPollHours) || 6) * 3600000));

  if (steps.equipment) imports.importEquipment(client, org, counts, fail, ctx);
  if (steps.contacts || steps.projects) imports.importContacts(client, org, counts, fail, ctx);
  if (steps.projects && cfg.projects) imports.importProjects(client, org, counts, fail, ctx);
  const changes = { initialDone: true };
  if (linesDue) {
    const kept = {};
    let cursor = null;
    do {
      const page = client.page("projectequipment", cursor);
      Object.assign(kept, imports.importLines(client, org, counts, fail, page.data, ctx));
      cursor = page.next;
    } while (cursor);
    const linked = sync.linkMap(org, "rentman", "job_lines");
    removeLines(
      org,
      Object.keys(linked).filter((id) => !kept[id]),
      run,
    );
    changes.lastLinesPollAt = now;
  }
  return changes;
}

// ----------------------------------------------------------------- queue

function handle(job, cfg, run) {
  const org = job.getString("org");
  const { decodeJson } = require("./records.js");
  const payload = decodeJson(job.get("payload"), {});
  const action = job.getString("action");
  if (job.getString("direction") === "in") {
    if (action === "pull") return pull(org, cfg, run, payload);
    if (action === "delete") return remoteDeleted(org, job.getString("remoteType"), job.getString("remoteId"), run);
    return;
  }
  if (action === "upsert") return push(org, cfg, run, job.getString("collection"), job.getString("record"));
  if (action === "delete") return localDeleted(org, job.getString("collection"), job.getString("remoteId"), run);
  if (action === "projectRequest") return sendProjectRequest(org, cfg, run, job.getString("record"));
}

// What webhooks asked for: some lists re-read, some project lines re-read.
function pull(org, cfg, run, payload) {
  // "Sync now": everything, project equipment included.
  if (payload.full) return sync.runPoll(org, "rentman", cfg, null, "manual", { lines: true });
  const steps = payload.steps || {};
  if (steps.equipment || steps.contacts || steps.projects) sync.runPoll(org, "rentman", cfg, null, "webhook", { steps: steps });
  const lineIds = Object.keys(payload.lineIds || {});
  if (lineIds.length && cfg.projects) {
    const imports = require("./imports.js");
    const client = clientFor(org);
    const rows = [];
    for (const id of lineIds) {
      const row = client.get("projectequipment", id);
      if (row) rows.push(row);
    }
    const kept = imports.importLines(client, org, run.counts, run.fail, rows, syncContext(org, cfg, run));
    removeLines(
      org,
      lineIds.filter((id) => !kept[id]),
      run,
    );
  }
}

const LOCAL_FOR_REMOTE = { equipment: ["items"], contacts: ["contacts", "venues"] };

function remoteDeleted(org, remoteType, remoteId, run) {
  if (remoteType === "projectequipment") return removeLines(org, [remoteId], run);
  for (const collection of LOCAL_FOR_REMOTE[remoteType] || []) {
    const link = sync.findLink(org, "rentman", collection, { remoteId: remoteId });
    if (link) archiveLocal(org, collection, link.getString("record"), run);
  }
  if (remoteType === "projects") run.count("projects deleted in Rentman (kept in R2)");
}

// Deleted in R2: equipment is archived in Rentman, anything else stays.
function localDeleted(org, collection, remoteId, run) {
  if (collection === "items" && remoteId) {
    clientFor(org).update("equipment", remoteId, { in_archive: true });
    run.count("equipment archived in Rentman");
  } else {
    run.count(collection + " deleted in R2 (kept in Rentman)");
  }
  const link = sync.findLink(org, "rentman", collection, { remoteId: remoteId });
  if (link) $app.delete(link);
}

// One R2 record out to Rentman: created if it isn't there yet (when the
// organisation wants that), otherwise merged with Rentman's current copy.
function push(org, cfg, run, collection, recordId) {
  if (directionOf(cfg, collection) !== "both") return;
  const record = findOrNull(collection, recordId);
  if (!record) return;
  const map = MAPS[collection];
  const fields = outFields(collection);
  const refs = folderRefs(org);
  const local = sync.localFields(record, fields);
  const client = clientFor(org);
  const link = sync.findLink(org, "rentman", collection, { record: record.id });

  if (!link) {
    if (!(cfg.createInRentman || {})[collection]) return;
    const created = client.create("/" + map.remoteType, map.toRentman(local, refs));
    if (!created || created.id === undefined) throw new Error("Rentman didn't return the new " + map.remoteType + " record");
    sync.saveLink(org, "rentman", collection, record.id, map.remoteType, String(created.id), local, created.modified || "");
    record.set("rentmanId", String(created.id));
    sync.quietSave(record);
    run.count(collection + " created in Rentman");
    return;
  }

  const remoteId = link.getString("remoteId");
  const remote = client.get(map.remoteType, remoteId);
  if (!remote) {
    // Gone from Rentman since: R2 keeps it, archived, and forgets the link.
    archiveLocal(org, collection, record.id, run);
    $app.delete(link);
    return;
  }
  const { merge, isEmpty } = require("./merge.js");
  const base = sync.linkBase(link);
  const remoteMs = remote.modified ? Date.parse(String(remote.modified)) : 0;
  const localMs = Date.parse(record.getString("updated").replace(" ", "T"));
  const m = merge(base && Object.keys(base).length ? base : null, local, map.fromRentman(remote, refs, null), {
    fields: fields,
    outFields: fields,
    direction: "both",
    rule: cfg.conflictRule || "newest",
    localNewer: localMs > remoteMs,
    firstSync: cfg.firstSync === "local" ? "local" : "remote",
  });
  for (const c of m.conflicts) run.conflict(collection, record.id, remoteId, c);
  let modified = remote.modified || "";
  if (!isEmpty(m.toRemote)) {
    const updated = client.update(map.remoteType, remoteId, map.toRentman(m.toRemote, refs));
    if (updated && updated.modified) modified = updated.modified;
    run.count(collection + " updated in Rentman");
  }
  if (!isEmpty(m.toLocal)) {
    for (const key of Object.keys(m.toLocal)) record.set(key, m.toLocal[key]);
    sync.quietSave(record);
    run.count(collection + " updated from Rentman");
  }
  sync.saveLink(org, "rentman", collection, record.id, map.remoteType, remoteId, Object.assign(base || {}, m.base), modified);
}

// An R2 project → a Rentman project request, with its equipment.
function sendProjectRequest(org, cfg, run, jobId) {
  const { toMs } = require("./time.js");
  const job = findOrNull("jobs", jobId);
  if (!job) return;
  if (sync.findLink(org, "rentman", "jobs", { record: job.id })) throw sync.permanentError("This project is already in Rentman");
  const iso = (v) => (Number.isFinite(toMs(v)) ? new Date(toMs(v)).toISOString() : undefined);
  const contactRef = (collection, id) => {
    const link = id && sync.findLink(org, "rentman", collection, { record: id });
    return link ? "/contacts/" + link.getString("remoteId") : undefined;
  };
  const body = {
    name: job.getString("name"),
    planperiod_start: iso(job.getString("prepAt")),
    planperiod_end: iso(job.getString("returnAt")),
    usageperiod_start: iso(job.getString("billingStart") || job.getString("prepAt")),
    usageperiod_end: iso(job.getString("billingEnd") || job.getString("returnAt")),
    customer: contactRef("contacts", job.getString("client")),
    location: contactRef("venues", job.getString("venue")),
  };
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  const client = clientFor(org);
  const request = client.create("/projectrequests", body);
  if (!request || request.id === undefined) throw new Error("Rentman didn't return the new project request");
  const lines = $app.findRecordsByFilter("job_lines", "job = {:job} && parentLine = ''", "sortOrder", 0, 0, { job: job.id });
  let sent = 0;
  for (const line of lines) {
    const item = line.getString("item") ? findOrNull("items", line.getString("item")) : null;
    const itemLink = item && sync.findLink(org, "rentman", "items", { record: item.id });
    const row = {
      name: item ? item.getString("name") : line.getString("description") || "Item",
      quantity: line.getFloat("quantity"),
      unit_price: line.getFloat("unitPrice"),
    };
    if (itemLink) row.equipment = "/equipment/" + itemLink.getString("remoteId");
    try {
      client.create("/projectrequests/" + request.id + "/projectrequestequipment", row);
      sent++;
    } catch (err) {
      run.fail("project request line", line.id, row.name, err);
    }
  }
  sync.saveLink(org, "rentman", "jobs", job.id, "projectrequests", String(request.id), {}, "", { sentAt: sync.nowPb(), lines: sent });
  run.count("project requests sent");
}

// ---------------------------------------------------------- R2 changes

// Called by records_sync.pb.js after an R2 record is saved or deleted.
// Only queues; the worker does the talking.
function onLocalChange(org, cfg, event, record) {
  const collection = record.collection().name;
  if (TWO_WAY.indexOf(collection) === -1 || directionOf(cfg, collection) !== "both") return;
  if (event === "delete") {
    const link = sync.findLink(org, "rentman", collection, { record: record.id });
    if (link) sync.enqueue(org, "rentman", "out", "delete", { collection: collection, remoteId: link.getString("remoteId") });
    return;
  }
  if (event === "create" && !(cfg.createInRentman || {})[collection]) return;
  sync.enqueue(org, "rentman", "out", "upsert", { collection: collection, record: record.id });
}

// ------------------------------------------------------------- webhooks

// Rentman's item types, however they're spelled ("Equipment",
// "ProjectEquipment", "contactpersons"…), → what to re-read.
function kindOf(itemType) {
  const t = String(itemType || "").toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  if (["equipment", "serialnumber", "folder", "stocklocation", "stockmovement", "extrainputfield", "equipmentsetscontent"].indexOf(t) !== -1) return "equipment";
  if (t === "contact" || t === "contactperson") return "contacts";
  if (t === "project" || t === "subproject" || t === "statu" || t === "status") return "projects";
  if (t === "projectequipment") return "lines";
  if (t === "projectequipmentgroup") return "projects";
  return null;
}


// A webhook from Rentman: { eventType: create|update|delete, itemType,
// items: [{ id, ref }] }. Turned into queue work.
function onWebhook(org, cfg, body) {
  const b = body || {};
  const kind = kindOf(b.itemType || b.item_type);
  const event = String(b.eventType || b.event_type || "").toLowerCase();
  const items = Array.isArray(b.items) ? b.items : [];
  const ids = items.map((i) => String((i && (i.id !== undefined ? i.id : i.ref && String(i.ref).split("/").pop())) || "")).filter(Boolean);
  if (!kind) return { queued: 0 };
  if ((kind === "projects" || kind === "lines") && !cfg.projects) return { queued: 0 };
  // Deleted equipment, contacts and project lines are handled one by one;
  // anything else deleted (a serial number, a folder…) re-reads its list.
  const type = String(b.itemType || b.item_type || "").toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  const deleted = { equipment: "equipment", contact: "contacts", projectequipment: "projectequipment" }[type];
  if (event === "delete" && deleted) {
    for (const id of ids) sync.enqueue(org, "rentman", "in", "delete", { remoteType: deleted, remoteId: id });
    return { queued: ids.length };
  }
  queuePull(org, kind === "lines" ? null : kind, kind === "lines" ? ids : []);
  return { queued: 1 };
}

// One waiting "pull" per organisation, collecting what to re-read.
function queuePull(org, step, lineIds) {
  const { decodeJson } = require("./records.js");
  const job = sync.enqueue(org, "rentman", "in", "pull", {});
  const payload = decodeJson(job.get("payload"), {});
  payload.steps = payload.steps || {};
  payload.lineIds = payload.lineIds || {};
  if (step) payload.steps[step] = true;
  for (const id of lineIds || []) payload.lineIds[id] = true;
  job.set("payload", payload);
  $app.save(job);
}

// The organisation whose webhook address has this key.
function orgForWebhookKey(key) {
  if (!key || String(key).length < 20) return "";
  for (const org of sync.activeOrgs("rentman")) {
    if (sync.getConfig(org, "rentman").webhookKey === key) return org;
  }
  return "";
}

// Settings → Integrations "Test connection".
function test(org) {
  const client = clientFor(org);
  const page = client.page("equipment", null);
  return { ok: true, message: "Connected to Rentman" + (page.data.length ? " (" + page.data.length + (page.next ? "+" : "") + " equipment)" : "") };
}

module.exports = {
  DEFAULTS,
  TWO_WAY,
  pollDue,
  poll,
  handle,
  onLocalChange,
  onWebhook,
  orgForWebhookKey,
  test,
  kindOf,
};
