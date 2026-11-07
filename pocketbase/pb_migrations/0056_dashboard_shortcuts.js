/// <reference path="../pb_data/types.d.ts" />

// A dashboard's shortcut buttons (New project, Track equipment, …): ids in
// order, shown next to the dashboard menu on Home. Unset means the usual
// ones (web/src/lib/home.ts DEFAULT_SHORTCUTS), so existing dashboards
// look the same until someone picks their own; [] means none.

migrate(
  (app) => {
    const dashboards = app.findCollectionByNameOrId("dashboards");
    dashboards.fields.add(new JSONField({ name: "shortcuts", maxSize: 2000 }));
    app.save(dashboards);
  },
  (app) => {
    const dashboards = app.findCollectionByNameOrId("dashboards");
    dashboards.fields.removeByName("shortcuts");
    app.save(dashboards);
  },
);
