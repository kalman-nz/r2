/// <reference path="../pb_data/types.d.ts" />

// Saved views work the same on every list page, the way dashboards do:
// Inventory, Projects, Contacts and Locations each have views holding the
// page's filters and column settings (lib/views.js). Everyone keeps their
// own and shares them; one shared with everyone can be the organisation's
// default for its page (list_views.isDefault), and each person's pick per
// page is kept with their membership (memberships.views: { page: id }).
//
// The Inventory's own views (equipment_views) move into list_views, ids and
// sharing kept, and that collection goes.

const PAGES = ["projects", "inventory", "contacts", "locations"];

// A JSON field's value (its raw text, parsed).
function parse(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value === null || value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

migrate(
  (app) => {
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.getByName("page").values = PAGES;
    listViews.fields.add(new BoolField({ name: "isDefault" }));
    app.save(listViews);

    const memberships = app.findCollectionByNameOrId("memberships");
    memberships.fields.add(new JSONField({ name: "views", maxSize: 5000 }));
    app.save(memberships);

    for (const old of app.findAllRecords("equipment_views")) {
      const record = new Record(listViews);
      record.set("id", old.id);
      record.set("org", old.getString("org"));
      record.set("owner", old.getString("owner"));
      record.set("page", "inventory");
      record.set("name", old.getString("name").slice(0, 60) || "Inventory view");
      record.set("config", {
        columns: parse(old.getString("columns"), []),
        widths: parse(old.getString("widths"), {}),
        sortKey: old.getString("sortKey") || "name",
        sortDir: old.getString("sortDir") === "desc" ? "desc" : "asc",
      });
      record.set("public", old.getBool("public"));
      record.set("sharedWith", old.getStringSlice("sharedWith"));
      app.save(record);
    }
    app.delete(app.findCollectionByNameOrId("equipment_views"));
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const orgs = app.findCollectionByNameOrId("organisations");
    const seen = "owner = @request.auth.id || public = true || sharedWith.id ?= @request.auth.id";
    const equipmentViews = new Collection({
      type: "base",
      name: "equipment_views",
      listRule: seen,
      viewRule: seen,
      fields: [
        { type: "relation", name: "org", collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true },
        { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { type: "json", name: "columns", required: true, maxSize: 20000 },
        { type: "json", name: "widths", maxSize: 20000 },
        { type: "text", name: "sortKey" },
        { type: "text", name: "sortDir" },
        { type: "bool", name: "public" },
        { type: "relation", name: "sharedWith", collectionId: users.id, maxSelect: 999 },
        { type: "autodate", name: "createdAt", onCreate: true },
        { type: "autodate", name: "updatedAt", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_equipment_views_owner ON equipment_views (owner, org)"],
    });
    app.save(equipmentViews);
    for (const view of app.findRecordsByFilter("list_views", "page = 'inventory'", "", 0, 0)) {
      const config = parse(view.getString("config"), {});
      const record = new Record(equipmentViews);
      record.set("id", view.id);
      record.set("org", view.getString("org"));
      record.set("owner", view.getString("owner"));
      record.set("name", view.getString("name"));
      record.set("columns", config.columns || ["name"]);
      record.set("widths", config.widths || {});
      record.set("sortKey", config.sortKey || "name");
      record.set("sortDir", config.sortDir || "asc");
      record.set("public", view.getBool("public"));
      record.set("sharedWith", view.getStringSlice("sharedWith"));
      app.save(record);
    }
    app.db().newQuery("DELETE FROM list_views WHERE page != 'projects'").execute();
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.removeByName("isDefault");
    listViews.fields.getByName("page").values = ["projects"];
    app.save(listViews);
    const memberships = app.findCollectionByNameOrId("memberships");
    memberships.fields.removeByName("views");
    app.save(memberships);
  },
);
