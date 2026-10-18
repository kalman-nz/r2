/// <reference path="../pb_data/types.d.ts" />

// Subprojects: part of a project with its own schedule. A festival's main
// rig runs days 1-3, but the day 3 finale needs a second stage for a few
// hours: that stage's kit is booked and charged over its own times, and it
// all goes on the one quote.
//
//   subprojects            name and order, plus dates derived from its own
//                          periods (lib/periods.js), like a job's
//   job_periods.subproject the subproject a period belongs to; empty for
//                          the main project
//   job_lines.subproject   the same for equipment and services
//
// The main project keeps its own usage and billing periods, so jobs.prepAt
// and returnAt stay the main project's booking. jobs.startAt and endAt cover
// everything, subprojects included. Each subproject keeps at least one
// usage and one billing period too. Subprojects are created through
// POST /api/jobs/{id}/subprojects (which gives them those periods); renaming
// and deleting go through the collection.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const jobs = app.findCollectionByNameOrId("jobs");
    const subprojects = new Collection({
      type: "base",
      name: "subprojects",
      listRule: MEMBER,
      viewRule: MEMBER,
      updateRule: can("jobs.edit") + " && " + SAME_ORG + " && (@request.body.job:isset = false || @request.body.job = job)",
      deleteRule: can("jobs.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "date", name: "prepAt" },
        { type: "date", name: "returnAt" },
        { type: "date", name: "billingStart" },
        { type: "date", name: "billingEnd" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_subprojects_job ON subprojects (job, sortOrder)"],
    });
    app.save(subprojects);

    const periods = app.findCollectionByNameOrId("job_periods");
    periods.fields.add(new RelationField({ name: "subproject", collectionId: subprojects.id, maxSelect: 1, cascadeDelete: true }));
    app.save(periods);

    const lines = app.findCollectionByNameOrId("job_lines");
    lines.fields.add(new RelationField({ name: "subproject", collectionId: subprojects.id, maxSelect: 1 }));
    app.save(lines);
  },
  (app) => {
    const periods = app.findCollectionByNameOrId("job_periods");
    periods.fields.removeByName("subproject");
    app.save(periods);
    const lines = app.findCollectionByNameOrId("job_lines");
    lines.fields.removeByName("subproject");
    app.save(lines);
    app.delete(app.findCollectionByNameOrId("subprojects"));
  },
);
