/// <reference path="../pb_data/types.d.ts" />

// A project's schedule: time periods, each with its own name. Every project
// has at least one of each of two kinds, plus any number of plain ones:
//
//   usage    when the equipment is booked out: it holds stock
//   billing  when the equipment is charged for (several are fine: charge
//            the show days and not the rehearsal between them)
//   other    anything else worth planning: pack in, crew calls, rehearsals
//
// The periods are the source of truth. The job's date fields become a
// summary of them, kept in step by pb_hooks/records_periods.pb.js
// (lib/periods.js), so availability, the calendar feed and the lists read
// the job as before:
//
//   prepAt / returnAt          first start / last end of the usage periods
//   startAt / endAt            first start / last end of the whole schedule
//   billingStart / billingEnd  first start / last end of the billing periods
//
// Charged days are counted per billing period (lib/jobs.js chargeDaysFor).
// The show fields go: every existing project gets a usage period over its
// prep → return window and a billing period over its show (or, for a dry
// hire, the same window), which charges exactly what it did before, plus a
// "Show" period to keep the show times on its schedule.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const jobs = app.findCollectionByNameOrId("jobs");

    for (const name of ["startAt", "endAt", "billingStart", "billingEnd"]) jobs.fields.add(new DateField({ name: name }));
    app.save(jobs);

    const periods = new Collection({
      type: "base",
      name: "job_periods",
      listRule: MEMBER,
      viewRule: MEMBER,
      // The job's org must match too: validatePeriod checks it.
      createRule: can("jobs.edit"),
      updateRule: can("jobs.edit") + " && " + SAME_ORG + " && (@request.body.job:isset = false || @request.body.job = job)",
      deleteRule: can("jobs.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "kind", required: true, values: ["usage", "billing", "other"], maxSelect: 1 },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "date", name: "start", required: true },
        { type: "date", name: "end", required: true },
        { type: "text", name: "notes", max: 2000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_job_periods_job ON job_periods (job, start)"],
    });
    app.save(periods);

    // Saving these runs the period hooks, which fill in each job's derived
    // dates.
    const rows = arrayOf(new DynamicModel({ id: "", org: "", prepAt: "", returnAt: "", showStart: "", showEnd: "" }));
    app.db().newQuery("SELECT id, org, prepAt, returnAt, showStart, showEnd FROM jobs WHERE org != ''").all(rows);
    for (const j of rows) {
      const add = (kind, name, start, end) => app.save(new Record(periods, { org: j.org, job: j.id, kind: kind, name: name, start: start, end: end }));
      const show = j.showStart && j.showEnd;
      add("usage", "Equipment booked", j.prepAt, j.returnAt);
      add("billing", "Billed", show ? j.showStart : j.prepAt, show ? j.showEnd : j.returnAt);
      if (show) add("other", "Show", j.showStart, j.showEnd);
    }

    const fresh = app.findCollectionByNameOrId("jobs");
    fresh.fields.removeByName("showStart");
    fresh.fields.removeByName("showEnd");
    app.save(fresh);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("job_periods"));
    const jobs = app.findCollectionByNameOrId("jobs");
    for (const name of ["startAt", "endAt", "billingStart", "billingEnd"]) jobs.fields.removeByName(name);
    jobs.fields.add(new DateField({ name: "showStart" }));
    jobs.fields.add(new DateField({ name: "showEnd" }));
    app.save(jobs);
  },
);
