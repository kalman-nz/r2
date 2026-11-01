/// <reference path="../pb_data/types.d.ts" />

// Statuses say what they do as options, set per status (Settings → Project
// statuses and Repair statuses), instead of all of it following the stage.
//
// Project statuses: the stage still decides the kit (held, pencilled,
// out, finished, cancelled), and these three are their own:
//   rostering  its projects are on the Rostering page
//   calendar   its projects are in the calendar feed
//   invoicing  its projects can go in the Xero export
//
// Repair statuses: the stage still decides the kit (out of service, back
// in service, retired), and closes says whether the repair's finished
// (stamped closed). Kit out of service never closes.
//
// Each starts as its stage behaved until now, so nothing changes until an
// organisation changes it.

migrate(
  (app) => {
    const jobStatuses = app.findCollectionByNameOrId("job_statuses");
    jobStatuses.fields.add(new BoolField({ name: "rostering" }));
    jobStatuses.fields.add(new BoolField({ name: "calendar" }));
    jobStatuses.fields.add(new BoolField({ name: "invoicing" }));
    app.save(jobStatuses);
    app
      .db()
      .newQuery(
        "UPDATE job_statuses SET " +
          "rostering = (stage != 'cancelled'), " +
          "calendar = (stage != 'cancelled'), " +
          "invoicing = (stage NOT IN ('enquiry', 'cancelled'))",
      )
      .execute();

    const repairStatuses = app.findCollectionByNameOrId("repair_statuses");
    repairStatuses.fields.add(new BoolField({ name: "closes" }));
    app.save(repairStatuses);
    app.db().newQuery("UPDATE repair_statuses SET closes = (stage != 'open')").execute();
  },
  (app) => {
    const jobStatuses = app.findCollectionByNameOrId("job_statuses");
    for (const name of ["rostering", "calendar", "invoicing"]) jobStatuses.fields.removeByName(name);
    app.save(jobStatuses);
    const repairStatuses = app.findCollectionByNameOrId("repair_statuses");
    repairStatuses.fields.removeByName("closes");
    app.save(repairStatuses);
  },
);
