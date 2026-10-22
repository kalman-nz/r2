/// <reference path="../pb_data/types.d.ts" />

// Project statuses become each organisation's own (Settings → Project
// statuses, lib/jobStatuses.js): named, ordered and coloured for how it
// works, each on one of the six fixed stages that availability, scanning
// and the rest run on (jobs.status keeps the stage). Projects point at
// theirs with jobStatus.
//
// Every organisation starts with Enquiry (the default), Provisional,
// Confirmed, Prepped, Out, Returned and Cancelled; projects move to the one
// for their stage (Confirmed for confirmed ones). Changed only through
// PUT /api/job-statuses; members can read them.
//
// Status colours get orange and teal, for repair statuses too.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const STAGES = ["enquiry", "provisional", "confirmed", "out", "returned", "cancelled"];
const COLOURS = ["gray", "amber", "orange", "blue", "teal", "violet", "green", "red"];
const DEFAULTS = [
  { name: "Enquiry", stage: "enquiry", colour: "gray", isDefault: true },
  { name: "Provisional", stage: "provisional", colour: "amber" },
  { name: "Confirmed", stage: "confirmed", colour: "blue" },
  { name: "Prepped", stage: "confirmed", colour: "teal" },
  { name: "Out", stage: "out", colour: "violet" },
  { name: "Returned", stage: "returned", colour: "green" },
  { name: "Cancelled", stage: "cancelled", colour: "gray" },
];

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const statuses = new Collection({
      type: "base",
      name: "job_statuses",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 60 },
        { type: "select", name: "stage", required: true, values: STAGES, maxSelect: 1 },
        { type: "select", name: "colour", values: COLOURS, maxSelect: 1 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "bool", name: "isDefault" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_job_statuses_org ON job_statuses (org, sortOrder)"],
    });
    app.save(statuses);

    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.add(new RelationField({ name: "jobStatus", collectionId: statuses.id, maxSelect: 1 }));
    const indexes = [];
    for (const index of jobs.indexes) indexes.push(index);
    indexes.push("CREATE INDEX idx_jobs_jobStatus ON jobs (jobStatus)");
    jobs.indexes = indexes;
    app.save(jobs);

    const repairStatuses = app.findCollectionByNameOrId("repair_statuses");
    repairStatuses.fields.getByName("colour").values = COLOURS;
    app.save(repairStatuses);

    for (const org of app.findAllRecords("organisations")) {
      const firstOfStage = {};
      DEFAULTS.forEach((d, i) => {
        const record = new Record(statuses, { org: org.id, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, isDefault: !!d.isDefault });
        app.save(record);
        if (!firstOfStage[d.stage]) firstOfStage[d.stage] = record.id;
      });
      for (const stage in firstOfStage) {
        app
          .db()
          .newQuery("UPDATE jobs SET jobStatus = {:id} WHERE org = {:org} AND status = {:stage}")
          .bind({ id: firstOfStage[stage], org: org.id, stage: stage })
          .execute();
      }
    }
  },
  (app) => {
    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.removeByName("jobStatus");
    const indexes = [];
    for (const index of jobs.indexes) if (index.indexOf("idx_jobs_jobStatus") === -1) indexes.push(index);
    jobs.indexes = indexes;
    app.save(jobs);
    app.db().newQuery("UPDATE repair_statuses SET colour = 'gray' WHERE colour IN ('orange', 'teal')").execute();
    const repairStatuses = app.findCollectionByNameOrId("repair_statuses");
    repairStatuses.fields.getByName("colour").values = ["gray", "amber", "blue", "violet", "green", "red"];
    app.save(repairStatuses);
    app.delete(app.findCollectionByNameOrId("job_statuses"));
  },
);
