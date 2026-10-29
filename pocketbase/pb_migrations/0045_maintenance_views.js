/// <reference path="../pb_data/types.d.ts" />

// Maintenance's lists get saved views like every other list page: what's
// due ("maintenance"), repairs ("repairs") and what's been done
// ("maintenance-history"). See lib/views.js.

const BEFORE = ["projects", "inventory", "contacts", "locations", "crew", "rostering"];
const ADDED = ["maintenance", "repairs", "maintenance-history"];

migrate(
  (app) => {
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.getByName("page").values = BEFORE.concat(ADDED);
    app.save(listViews);
  },
  (app) => {
    app.db().newQuery("DELETE FROM list_views WHERE page IN ('maintenance', 'repairs', 'maintenance-history')").execute();
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.getByName("page").values = BEFORE;
    app.save(listViews);
  },
);
