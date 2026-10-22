/// <reference path="../pb_data/types.d.ts" />

// Equipment tracking (was "check in & out") gets steps: each organisation's
// own list of where kit is on its way to a project and back (Settings →
// Equipment tracking, lib/tracking.js), each on one of three fixed stages:
//
//   prep   pulled for the project, still in the building (Prepped)
//   out    gone with the project (Loaded)
//   back   returned to stock (Returned)
//
// so every bit of equipment on a project has its own place: the audio can
// be loaded while the lighting's only prepped. A step can move the project
// to one of its statuses once everything's reached it.
//
// Scans record the step they took kit to (step) and from (fromStep, empty
// from stock). direction stays the ledger: "out" leaves stock, "move" goes
// between steps on the same project, "in" comes back.
//
// Every organisation starts with Prepped → Loaded → Returned; past scans
// out are Loaded and past scans in are Returned.
//
// A project can go without it (jobs.untracked): a small dry hire, say, with
// the feature on for everything else.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const COLOURS = ["gray", "amber", "orange", "blue", "teal", "violet", "green", "red"];
const DEFAULTS = [
  { name: "Prepped", stage: "prep", colour: "teal", status: { name: "Prepped", stage: "confirmed" } },
  { name: "Loaded", stage: "out", colour: "violet", status: { stage: "out" } },
  { name: "Returned", stage: "back", colour: "green", status: { stage: "returned" } },
];

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const jobStatuses = app.findCollectionByNameOrId("job_statuses");
    const steps = new Collection({
      type: "base",
      name: "tracking_steps",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 60 },
        { type: "select", name: "stage", required: true, values: ["prep", "out", "back"], maxSelect: 1 },
        { type: "select", name: "colour", values: COLOURS, maxSelect: 1 },
        { type: "number", name: "sortOrder", onlyInt: true },
        // Once everything on a project's reached this step, it moves to this status.
        { type: "relation", name: "jobStatus", collectionId: jobStatuses.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_tracking_steps_org ON tracking_steps (org, sortOrder)"],
    });
    app.save(steps);

    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.add(new BoolField({ name: "untracked" }));
    app.save(jobs);

    const scans = app.findCollectionByNameOrId("scans");
    scans.fields.getByName("direction").values = ["out", "move", "in"];
    scans.fields.add(new RelationField({ name: "step", collectionId: steps.id, maxSelect: 1 }));
    scans.fields.add(new RelationField({ name: "fromStep", collectionId: steps.id, maxSelect: 1 }));
    app.save(scans);

    for (const org of app.findAllRecords("organisations")) {
      const statuses = app.findRecordsByFilter("job_statuses", "org = {:org}", "sortOrder,created", 0, 0, { org: org.id });
      const ids = {};
      DEFAULTS.forEach((d, i) => {
        const status = statuses.find((s) => s.getString("stage") === d.status.stage && (!d.status.name || s.getString("name") === d.status.name));
        const record = new Record(steps, { org: org.id, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, jobStatus: status ? status.id : "" });
        app.save(record);
        ids[d.stage] = record.id;
      });
      app.db().newQuery("UPDATE scans SET step = {:step} WHERE org = {:org} AND direction = 'out'").bind({ step: ids.out, org: org.id }).execute();
      app
        .db()
        .newQuery("UPDATE scans SET step = {:step}, fromStep = {:from} WHERE org = {:org} AND direction = 'in'")
        .bind({ step: ids.back, from: ids.out, org: org.id })
        .execute();
    }
  },
  (app) => {
    app.db().newQuery("DELETE FROM scans WHERE direction = 'move'").execute();
    const scans = app.findCollectionByNameOrId("scans");
    scans.fields.removeByName("step");
    scans.fields.removeByName("fromStep");
    scans.fields.getByName("direction").values = ["out", "in"];
    app.save(scans);
    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.removeByName("untracked");
    app.save(jobs);
    app.delete(app.findCollectionByNameOrId("tracking_steps"));
  },
);
