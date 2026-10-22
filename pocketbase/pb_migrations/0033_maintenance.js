/// <reference path="../pb_data/types.d.ts" />

// Maintenance: scheduled work on the kit, next to repairs (which are
// for when something's broken). lib/maintenance.js has the rules.
//
// maintenance_plans  Repeating work: "Annual PPE inspection, every 12 months,
//                    on these items". Each unit of a serialised item (and
//                    each bulk item as a whole) gets its own job, due on its
//                    own date. kind is inspection, test_tag (electrical test
//                    and tag, which keeps each unit's "Next test & tag" date)
//                    or service.
// maintenance_jobs   One piece of work on one unit, one bulk item or nothing
//                    in particular: from a plan, or one-off. Scheduled until
//                    it's done (with a pass or fail); a plan's job, once
//                    done, schedules the next. A fail can open a repair.
//                    files are like a repair's (pb_migrations/0032).
//
// Due and done dates are calendar days ("2026-10-22"), not instants (see
// lib/dates.js). Both are changed only through routes_maintenance.pb.js;
// members can read them.
//
// New permission maintenance.plans (setting up repeating maintenance): the
// locked Admin roles get it, and so does every role that can edit items.
// Recording and scheduling jobs uses units.flag, like repairs.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
const KINDS = ["inspection", "test_tag", "service"];
const FILE_SIZE = 25 * 1024 * 1024;

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const items = app.findCollectionByNameOrId("items");
    const serials = app.findCollectionByNameOrId("serials");
    const repairs = app.findCollectionByNameOrId("repairs");
    const users = app.findCollectionByNameOrId("users");

    const plans = new Collection({
      type: "base",
      name: "maintenance_plans",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "select", name: "kind", required: true, values: KINDS, maxSelect: 1 },
        { type: "number", name: "every", required: true, onlyInt: true, min: 1, max: 1000 },
        { type: "select", name: "unit", required: true, values: ["day", "week", "month", "year"], maxSelect: 1 },
        { type: "relation", name: "items", collectionId: items.id, maxSelect: 999 },
        // When kit that's never been done comes due.
        { type: "text", name: "firstDue", max: 10, pattern: DATE },
        { type: "text", name: "instructions", max: 5000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_maintenance_plans_org ON maintenance_plans (org)"],
    });
    app.save(plans);

    const jobs = new Collection({
      type: "base",
      name: "maintenance_jobs",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "plan", collectionId: plans.id, maxSelect: 1 },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "select", name: "kind", required: true, values: KINDS, maxSelect: 1 },
        { type: "relation", name: "item", collectionId: items.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "serial", collectionId: serials.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "dueOn", required: true, max: 10, pattern: DATE },
        { type: "select", name: "status", required: true, values: ["scheduled", "done"], maxSelect: 1 },
        { type: "select", name: "result", values: ["pass", "fail"], maxSelect: 1 },
        // Bulk items: how many of them failed.
        { type: "number", name: "failedQty", onlyInt: true, min: 0 },
        { type: "text", name: "doneOn", max: 10, pattern: DATE },
        { type: "text", name: "doneBy", max: 200 },
        { type: "text", name: "notes", max: 5000 },
        { type: "number", name: "cost", min: 0 },
        { type: "file", name: "files", maxSelect: 99, maxSize: FILE_SIZE, protected: true, thumbs: ["200x200"] },
        { type: "json", name: "fileInfo", maxSize: 200000 },
        { type: "relation", name: "repair", collectionId: repairs.id, maxSelect: 1 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_maintenance_jobs_due ON maintenance_jobs (org, status, dueOn)",
        "CREATE INDEX idx_maintenance_jobs_plan ON maintenance_jobs (plan, status)",
        "CREATE INDEX idx_maintenance_jobs_serial ON maintenance_jobs (serial)",
        "CREATE INDEX idx_maintenance_jobs_item ON maintenance_jobs (item)",
      ],
    });
    app.save(jobs);

    for (const role of app.findAllRecords("roles")) {
      const permissions = JSON.parse(role.getString("permissions") || "[]");
      if ((role.getBool("locked") || permissions.indexOf("items.edit") !== -1) && permissions.indexOf("maintenance.plans") === -1) {
        permissions.push("maintenance.plans");
        role.set("permissions", permissions);
        app.saveNoValidate(role);
      }
    }
  },
  (app) => {
    for (const role of app.findAllRecords("roles")) {
      const permissions = JSON.parse(role.getString("permissions") || "[]");
      if (permissions.indexOf("maintenance.plans") !== -1) {
        role.set("permissions", permissions.filter((p) => p !== "maintenance.plans"));
        app.saveNoValidate(role);
      }
    }
    app.delete(app.findCollectionByNameOrId("maintenance_jobs"));
    app.delete(app.findCollectionByNameOrId("maintenance_plans"));
  },
);
