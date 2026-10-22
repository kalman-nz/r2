// Equipment tracking: where each bit of kit on a project is, on its way out
// and back (pb_migrations/0037_tracking_steps.js). Each organisation names
// and orders its own steps (Settings → Equipment tracking), each on one of
// three fixed stages:
//
//   prep   pulled for the project, still in the building (Prepped)
//   out    gone with the project (Loaded, Delivered)
//   back   returned to stock (Returned)
//
// A scan takes kit to a step (lib/scan.js). Every unit a project needs is
// somewhere: not started, or at a step. Lines get their units in order
// (the first line of an item gets the furthest-along ones), so each line,
// each heading and the whole project has its own progress: the audio can
// be Loaded while the lighting's only Prepped.
//
// A step can name a project status to suggest once everything's reached it
// (or gone further): all Prepped → "Prepped", all Loaded → "Out", all
// Returned → "Returned". Project status stays the planners' own: this only
// offers it, forwards.

const STAGES = ["prep", "out", "back"];
const STAGE_LABELS = { prep: "getting ready", out: "gone", back: "back" };
// What every organisation starts with (the same as migration 0037).
const DEFAULT_STEPS = [
  { name: "Prepped", stage: "prep", colour: "teal", status: { name: "Prepped", stage: "confirmed" } },
  { name: "Loaded", stage: "out", colour: "violet", status: { stage: "out" } },
  { name: "Returned", stage: "back", colour: "green", status: { stage: "returned" } },
];

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// In order: getting ready, then gone, then back; in their order within each.
function stepsOf(app, org) {
  const list = app.findRecordsByFilter("tracking_steps", "org = {:org}", "sortOrder,created", 0, 0, { org: org });
  const position = {};
  list.forEach((s, i) => (position[s.id] = i));
  return list.sort((a, b) => STAGES.indexOf(a.getString("stage")) - STAGES.indexOf(b.getString("stage")) || position[a.id] - position[b.id]);
}

function createDefaultSteps(app, org) {
  if (stepsOf(app, org).length > 0) return;
  const { statusesOf } = require("./jobStatuses.js");
  const statuses = statusesOf(app, org);
  const collection = app.findCollectionByNameOrId("tracking_steps");
  DEFAULT_STEPS.forEach((d, i) => {
    const status = statuses.find((s) => s.getString("stage") === d.status.stage && (!d.status.name || s.getString("name") === d.status.name));
    app.save(new Record(collection, { org: org, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, jobStatus: status ? status.id : "" }));
  });
}

// The step a scan's for: body.step (an id), or the old body.direction
// ("out": the first step that's gone; "in": the first that's back).
function stepFor(steps, body) {
  const id = body && typeof body.step === "string" ? body.step : "";
  if (id) {
    const step = steps.find((s) => s.id === id);
    if (!step) throw new BadRequestError("Pick one of the tracking steps");
    return step;
  }
  const direction = body ? body.direction : "";
  const stage = direction === "out" ? "out" : direction === "in" ? "back" : "";
  const step = stage ? steps.find((s) => s.getString("stage") === stage) : null;
  if (!step) throw new BadRequestError("Pick a tracking step");
  return step;
}

// Where everything on a job is. needs: { itemId: units the job needs }.
// Returns { items, packed, allBack, scanCount, unitsByItem }: per item its
// units at each step (at, up to what's needed), what's with the project
// now (out, and by step in active), what's come back (returned) and which
// units are out; unitsByItem lists each item's units, furthest along first
// ("" for not started), for sharing out to lines.
function trackingState(app, jobId, needs, itemsById, steps) {
  const { findOrNull } = require("./records.js");
  const rank = {};
  const stage = {};
  steps.forEach((s, i) => {
    rank[s.id] = i + 1;
    stage[s.id] = s.getString("stage");
  });
  // Scans from before steps, or to a step that's gone.
  const firstOf = (st) => steps.find((s) => s.getString("stage") === st);
  const fallback = (direction) => {
    const s = direction === "in" ? firstOf("back") : firstOf("out") || firstOf("prep");
    return s ? s.id : "";
  };
  const stepOf = (scan) => (rank[scan.getString("step")] ? scan.getString("step") : fallback(scan.getString("direction")));

  const scans = app.findRecordsByFilter("scans", "job = {:job}", "created", 0, 0, { job: jobId });
  const per = {};
  const ensure = (itemId) => per[itemId] || (per[itemId] = { bulk: {}, serials: {} });
  for (const itemId of Object.keys(needs)) ensure(itemId);
  for (const scan of scans) {
    const p = ensure(scan.getString("item"));
    const to = stepOf(scan);
    const serial = scan.getString("serial");
    if (serial) {
      // Its latest scan says where it is.
      p.serials[serial] = to;
      continue;
    }
    const qty = scan.getInt("quantity");
    p.bulk[to] = (p.bulk[to] || 0) + qty;
    const from = scan.getString("fromStep");
    if (rank[from]) p.bulk[from] = (p.bulk[from] || 0) - qty;
  }

  const outSerials = [];
  for (const itemId of Object.keys(per)) {
    for (const id of Object.keys(per[itemId].serials)) if (stage[per[itemId].serials[id]] !== "back") outSerials.push(id);
  }
  const serialById = {};
  for (const serial of app.findRecordsByIds("serials", outSerials)) if (serial) serialById[serial.id] = serial;

  const unitsByItem = {};
  const items = Object.keys(per).map((itemId) => {
    const p = per[itemId];
    const active = {};
    const back = {};
    const add = (map, step, n) => (map[step] = (map[step] || 0) + n);
    for (const id of Object.keys(p.serials)) add(stage[p.serials[id]] === "back" ? back : active, p.serials[id], 1);
    for (const step of Object.keys(p.bulk)) {
      const n = Math.max(0, p.bulk[step]);
      if (n > 0 && rank[step]) add(stage[step] === "back" ? back : active, step, n);
    }
    const needed = needs[itemId] || 0;
    const sum = (map) => Object.keys(map).reduce((total, k) => total + map[k], 0);
    const furthestFirst = (map) => Object.keys(map).sort((a, b) => rank[b] - rank[a]);
    // The project's units: what's with it now, then what's come back, up
    // to what it needs (a unit swapped out mid-hire leaves its replacement
    // counted, not both).
    const units = [];
    for (const step of furthestFirst(active)) for (let i = 0; i < active[step] && units.length < needed; i++) units.push(step);
    for (const step of furthestFirst(back)) for (let i = 0; i < back[step] && units.length < needed; i++) units.push(step);
    units.sort((a, b) => (rank[b] || 0) - (rank[a] || 0));
    while (units.length < needed) units.push("");
    unitsByItem[itemId] = units;
    const at = {};
    for (const u of units) if (u) at[u] = (at[u] || 0) + 1;
    const item = itemsById[itemId] || findOrNull(app, "items", itemId);
    const started = units.filter(Boolean).length;
    return {
      itemId: itemId,
      name: item ? item.getString("name") : "(deleted item)",
      tracking: item ? item.getString("tracking") : "",
      needed: needed,
      at: at,
      active: active,
      out: sum(active),
      returned: sum(back),
      // Units that have reached a step (for the packing list's "4/6").
      scannedOut: started,
      serialsOut: Object.keys(p.serials)
        .filter((id) => stage[p.serials[id]] !== "back")
        .map((id) => ({
          id: id,
          step: p.serials[id],
          barcode: serialById[id] ? serialById[id].getString("barcode") : "",
          label: serialById[id] ? serialById[id].getString("label") : "",
        })),
    };
  });
  items.sort((a, b) => a.name.localeCompare(b.name));
  const needing = items.filter((i) => i.needed > 0);
  return {
    items: items,
    packed: needing.length > 0 && needing.every((i) => i.scannedOut >= i.needed),
    allBack: items.every((i) => i.out <= 0),
    scanCount: scans.length,
    unitsByItem: unitsByItem,
  };
}

// How many of an item's units are at a step or further along.
function reachedCount(state, itemId, step, steps) {
  const r = steps.findIndex((s) => s.id === step.id) + 1;
  const rankOf = (id) => steps.findIndex((s) => s.id === id) + 1;
  return (state.unitsByItem[itemId] || []).filter((u) => u && rankOf(u) >= r).length;
}

// Gives each physical line (summary line views, in order) its share of its
// item's units: line.tracking = { at: { stepId: units } }.
function shareOutToLines(lineViews, state) {
  const used = {};
  for (const view of lineViews) {
    if (!view.item || view.item.kind !== "item") continue;
    const units = state.unitsByItem[view.item.id] || [];
    const start = used[view.item.id] || 0;
    const end = start + Math.max(0, Math.round(view.quantity));
    used[view.item.id] = end;
    const at = {};
    for (const u of units.slice(start, end)) if (u) at[u] = (at[u] || 0) + 1;
    view.tracking = { at: at };
  }
}

// What the project's status could be now: once everything's reached a
// step (or gone further) that names a status, the furthest such step's,
// if that's ahead of where the project is. Project status is never changed
// by tracking itself; the scan page and the project page offer this, and
// POST /api/jobs/{id}/tracking-status sets it. Returns { step, stepName,
// status, statusName } or null.
function suggestion(app, job, state, steps) {
  if (job.getBool("untracked") || job.getString("status") === "cancelled") return null;
  const needing = state.items.filter((i) => i.needed > 0);
  if (needing.length === 0) return null;
  let step = null;
  for (let i = steps.length - 1; i >= 0 && !step; i--) {
    const s = steps[i];
    if (s.getString("jobStatus") && needing.every((item) => reachedCount(state, item.itemId, s, steps) >= item.needed)) step = s;
  }
  if (!step || step.getString("jobStatus") === job.getString("jobStatus")) return null;
  const { STAGES: JOB_STAGES, statusesOf } = require("./jobStatuses.js");
  const statuses = statusesOf(app, job.getString("org"));
  const find = (id) => statuses.find((x) => x.id === id) || null;
  const position = (s) => (s ? [JOB_STAGES.indexOf(s.getString("stage")), s.getInt("sortOrder")] : [-1, -1]);
  const target = find(step.getString("jobStatus"));
  if (!target) return null;
  const to = position(target);
  const from = position(find(job.getString("jobStatus")));
  if (to[0] < from[0] || (to[0] === from[0] && to[1] <= from[1])) return null;
  return { step: step.id, stepName: step.getString("name"), status: target.id, statusName: target.getString("name") };
}

// A project can go without equipment tracking (jobs.untracked), but not
// while kit it's tracked is still with it: that has to come back first.
// Runs before every save of a project (records_validation.pb.js).
function checkUntracked(app, record) {
  if (!record.getBool("untracked") || record.isNew() || record.original().getBool("untracked")) return;
  const rows = arrayOf(new DynamicModel({ n: 0 }));
  app
    .db()
    .newQuery("SELECT CAST(COALESCE(SUM(CASE direction WHEN 'out' THEN quantity WHEN 'in' THEN -quantity ELSE 0 END), 0) AS INTEGER) AS n FROM scans WHERE job = {:job}")
    .bind({ job: record.id })
    .all(rows);
  if (rows[0].n > 0) throw new BadRequestError("Some of this project's kit is still out: bring it back before turning tracking off");
}

// Replaces the organisation's steps with `list`, in order: [{ id?, name,
// stage, colour, jobStatus }]. They're kept in stage order (getting ready,
// gone, back), in the order given within each. There's always a step that
// sends kit out and one that brings it back. A step kit's been tracked to
// keeps its stage; removing one moves its kit to the first remaining step
// on the same stage (or, for the last getting-ready step, the first gone
// one). Returns the saved list.
function saveSteps(app, org, list) {
  const { COLOURS, statusesOf } = require("./jobStatuses.js");
  if (!Array.isArray(list) || list.length === 0) throw new BadRequestError("Add some steps");
  if (list.length > 20) throw new BadRequestError("There can be up to 20 steps");
  const statusIds = {};
  for (const s of statusesOf(app, org)) if (s.getString("stage") !== "cancelled") statusIds[s.id] = true;
  const seen = {};
  const clean = list.map((s, i) => {
    const name = text(s && s.name, 60);
    if (!name) throw new BadRequestError("Every step needs a name");
    if (seen[name.toLowerCase()]) throw new BadRequestError("There are two steps called " + name);
    seen[name.toLowerCase()] = true;
    if (STAGES.indexOf(s.stage) === -1) throw new BadRequestError("Pick where the kit is at " + name);
    const jobStatus = s.jobStatus ? String(s.jobStatus) : "";
    if (jobStatus && !statusIds[jobStatus]) throw new BadRequestError("Pick one of the project statuses for " + name);
    return { id: s.id ? String(s.id) : "", name: name, stage: s.stage, colour: COLOURS.indexOf(s.colour) !== -1 ? s.colour : "gray", jobStatus: jobStatus, given: i };
  });
  if (!clean.some((s) => s.stage === "out")) throw new BadRequestError("Keep a step for kit going out with the project");
  if (!clean.some((s) => s.stage === "back")) throw new BadRequestError("Keep a step for kit coming back");
  clean.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.given - b.given);

  app.runInTransaction((tx) => {
    const inUse = (id) => {
      const rows = arrayOf(new DynamicModel({ n: 0 }));
      tx.db().newQuery("SELECT COUNT(*) AS n FROM scans WHERE step = {:id} OR fromStep = {:id}").bind({ id: id }).all(rows);
      return rows[0].n > 0;
    };
    const existing = {};
    for (const r of stepsOf(tx, org)) existing[r.id] = r;
    const collection = tx.findCollectionByNameOrId("tracking_steps");
    const saved = [];
    clean.forEach((s, i) => {
      let record;
      if (s.id) {
        record = existing[s.id];
        if (!record) throw new BadRequestError("One of those steps doesn't exist");
        if (record.getString("stage") !== s.stage && inUse(s.id)) {
          throw new BadRequestError("Kit has been tracked to " + record.getString("name") + ", so it stays " + STAGE_LABELS[record.getString("stage")]);
        }
      } else {
        record = new Record(collection, { org: org });
      }
      record.set("name", s.name);
      record.set("stage", s.stage);
      record.set("colour", s.colour);
      record.set("jobStatus", s.jobStatus);
      record.set("sortOrder", (i + 1) * 10);
      tx.save(record);
      saved.push(record);
    });
    const keptIds = saved.map((r) => r.id);
    for (const id in existing) {
      if (keptIds.indexOf(id) !== -1) continue;
      const st = existing[id].getString("stage");
      const to = saved.find((r) => r.getString("stage") === st) || saved.find((r) => r.getString("stage") === "out");
      tx.db().newQuery("UPDATE scans SET step = {:to} WHERE step = {:id}").bind({ to: to.id, id: id }).execute();
      tx.db().newQuery("UPDATE scans SET fromStep = {:to} WHERE fromStep = {:id}").bind({ to: to.id, id: id }).execute();
      tx.delete(existing[id]);
    }
  });
  return stepsOf(app, org);
}

module.exports = { STAGES, DEFAULT_STEPS, checkUntracked, stepsOf, createDefaultSteps, stepFor, trackingState, reachedCount, shareOutToLines, suggestion, saveSteps };
