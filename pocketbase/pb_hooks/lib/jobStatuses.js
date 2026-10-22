// Each organisation's own project statuses (Settings → Project statuses,
// pb_migrations/0035_job_statuses.js): named, ordered and coloured for how
// it works — Confirmed → Prepping → Prepped → Loaded → Out, say — on top of
// six fixed stages that everything else runs on:
//
//   enquiry      a price check: holds no kit
//   provisional  pencilled in: holds kit, but other bookings can see it
//                would go if released
//   confirmed    booked: holds kit
//   out          the kit's left the warehouse
//   returned     done: nothing held
//   cancelled    nothing held
//
// A project has both: jobStatus (one of the organisation's statuses) and
// status (its stage), which availability, scanning, the calendar feed and
// the Xero export read. syncJobStatus() keeps them together on every save:
// picking a status sets the stage, and code that sets a stage (the first
// scan out, an import) moves the project to the organisation's first
// status with that stage.

const STAGES = ["enquiry", "provisional", "confirmed", "out", "returned", "cancelled"];
// Where new projects can start.
const STARTING = ["enquiry", "provisional", "confirmed"];
const COLOURS = ["gray", "amber", "orange", "blue", "teal", "violet", "green", "red"];
// What every organisation starts with (the same as migration 0035).
const DEFAULT_JOB_STATUSES = [
  { name: "Enquiry", stage: "enquiry", colour: "gray", isDefault: true },
  { name: "Provisional", stage: "provisional", colour: "amber" },
  { name: "Confirmed", stage: "confirmed", colour: "blue" },
  { name: "Prepped", stage: "confirmed", colour: "teal" },
  { name: "Out", stage: "out", colour: "violet" },
  { name: "Returned", stage: "returned", colour: "green" },
  { name: "Cancelled", stage: "cancelled", colour: "gray" },
];

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function statusesOf(app, org) {
  return app.findRecordsByFilter("job_statuses", "org = {:org}", "sortOrder,created", 0, 0, { org: org });
}

function createDefaultJobStatuses(app, org) {
  if (statusesOf(app, org).length > 0) return;
  const collection = app.findCollectionByNameOrId("job_statuses");
  DEFAULT_JOB_STATUSES.forEach((d, i) => {
    app.save(new Record(collection, { org: org, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, isDefault: !!d.isDefault }));
  });
}

// Keeps a project's status and stage together; see the top of this file.
// Runs before every save of a project (records_validation.pb.js).
function syncJobStatus(app, record) {
  const org = record.getString("org");
  if (!org) return;
  const statuses = statusesOf(app, org);
  if (statuses.length === 0) return;
  const byId = {};
  for (const s of statuses) byId[s.id] = s;
  const isNew = record.isNew();
  const original = isNew ? null : record.original();
  const pickedId = record.getString("jobStatus");
  const picked = pickedId ? byId[pickedId] : null;
  if (pickedId && !picked) throw new BadRequestError("Pick one of the project statuses");
  const pickedChanged = isNew ? !!pickedId : pickedId !== original.getString("jobStatus");
  const stageChanged = isNew ? !!record.getString("status") : record.getString("status") !== original.getString("status");

  if (picked && (pickedChanged || !stageChanged)) {
    record.set("status", picked.getString("stage"));
    return;
  }
  const stage = record.getString("status");
  if (stage) {
    if (picked && picked.getString("stage") === stage) return;
    const first = statuses.find((s) => s.getString("stage") === stage);
    record.set("jobStatus", first ? first.id : "");
    return;
  }
  // A new project with neither: the organisation's default.
  const start = statuses.find((s) => s.getBool("isDefault")) || statuses.find((s) => STARTING.indexOf(s.getString("stage")) !== -1) || statuses[0];
  record.set("jobStatus", start.id);
  record.set("status", start.getString("stage"));
}

// Replaces the organisation's statuses with `list`, in order:
// [{ id?, name, stage, colour, isDefault }]. moves: { removedId: keptId }
// says where a removed status's projects go (to one that already exists).
// A status whose stage changes takes its projects with it, so their kit is
// held or released to match. There's always a status for new projects to
// start in, and exactly one default. Returns the saved list.
function saveJobStatuses(app, org, list, moves) {
  if (!Array.isArray(list) || list.length === 0) throw new BadRequestError("Add some statuses");
  if (list.length > 30) throw new BadRequestError("There can be up to 30 statuses");
  const seen = {};
  const clean = list.map((s, i) => {
    const name = text(s && s.name, 60);
    if (!name) throw new BadRequestError("Every status needs a name");
    if (seen[name.toLowerCase()]) throw new BadRequestError("There are two statuses called " + name);
    seen[name.toLowerCase()] = true;
    if (STAGES.indexOf(s.stage) === -1) throw new BadRequestError("Pick what " + name + " means for the kit");
    return {
      id: s.id ? String(s.id) : "",
      name: name,
      stage: s.stage,
      colour: COLOURS.indexOf(s.colour) !== -1 ? s.colour : "gray",
      isDefault: !!s.isDefault,
      sortOrder: (i + 1) * 10,
    };
  });
  const startable = clean.filter((s) => STARTING.indexOf(s.stage) !== -1);
  if (startable.length === 0) throw new BadRequestError("Keep a status for new projects to start in: an enquiry, pencilled or confirmed one");
  const def = startable.find((s) => s.isDefault) || startable[0];
  for (const s of clean) s.isDefault = s === def;
  const moving = moves && typeof moves === "object" ? moves : {};

  app.runInTransaction((tx) => {
    const count = (id) => {
      const rows = arrayOf(new DynamicModel({ n: 0 }));
      tx.db().newQuery("SELECT COUNT(*) AS n FROM jobs WHERE jobStatus = {:id}").bind({ id: id }).all(rows);
      return rows[0].n;
    };
    const existing = {};
    for (const r of statusesOf(tx, org)) existing[r.id] = r;
    const collection = tx.findCollectionByNameOrId("job_statuses");
    const kept = {};
    for (const s of clean) {
      let record;
      if (s.id) {
        record = existing[s.id];
        if (!record) throw new BadRequestError("One of those statuses doesn't exist");
        kept[s.id] = s;
        if (record.getString("stage") !== s.stage) {
          // Its projects change stage with it (raw: they're consistent).
          tx.db().newQuery("UPDATE jobs SET status = {:stage} WHERE jobStatus = {:id}").bind({ stage: s.stage, id: s.id }).execute();
        }
      } else {
        record = new Record(collection, { org: org });
      }
      record.set("name", s.name);
      record.set("stage", s.stage);
      record.set("colour", s.colour);
      record.set("sortOrder", s.sortOrder);
      record.set("isDefault", s.isDefault);
      tx.save(record);
    }
    for (const id in existing) {
      if (kept[id]) continue;
      const n = count(id);
      if (n > 0) {
        const to = kept[moving[id]];
        if (!to) {
          throw new BadRequestError(n + (n === 1 ? " project is " : " projects are ") + existing[id].getString("name") + ": say which status " + (n === 1 ? "it goes" : "they go") + " to");
        }
        tx.db().newQuery("UPDATE jobs SET jobStatus = {:to}, status = {:stage} WHERE jobStatus = {:id}").bind({ to: to.id, stage: to.stage, id: id }).execute();
      }
      tx.delete(existing[id]);
    }
  });
  return statusesOf(app, org);
}

module.exports = { STAGES, STARTING, COLOURS, DEFAULT_JOB_STATUSES, statusesOf, createDefaultJobStatuses, syncJobStatus, saveJobStatuses };
