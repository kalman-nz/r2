/// <reference path="../pb_data/types.d.ts" />

// How a plan repeats (lib/maintenance.js nextDue): "" counts each next one
// from the day the last was done; "fixed" keeps to the calendar from the
// plan's start date (every month on the 15th), however early or late
// each one's done.

migrate(
  (app) => {
    const plans = app.findCollectionByNameOrId("maintenance_plans");
    plans.fields.add(new TextField({ name: "repeat", max: 10 }));
    app.save(plans);
  },
  (app) => {
    const plans = app.findCollectionByNameOrId("maintenance_plans");
    plans.fields.removeByName("repeat");
    app.save(plans);
  },
);
