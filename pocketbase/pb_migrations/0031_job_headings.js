/// <reference path="../pb_data/types.d.ts" />

// A project's equipment headings ("Audio", "Lighting", "Stage") as their own
// list, so one can be made before anything's under it and they keep the
// order they're put in. jobs.headings is [{ section, name }], section being
// a subproject's id or "" for the main project. Lines still carry their
// heading's name in job_lines.group; a line whose heading isn't in the list
// shows after the listed ones. Changed through
// POST /api/jobs/{id}/headings (lib/jobs.js headingAction).

migrate(
  (app) => {
    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.add(new JSONField({ name: "headings", maxSize: 50000 }));
    app.save(jobs);
  },
  (app) => {
    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.removeByName("headings");
    app.save(jobs);
  },
);
