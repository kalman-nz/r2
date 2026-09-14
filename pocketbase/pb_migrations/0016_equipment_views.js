/// <reference path="../pb_data/types.d.ts" />

// Saved column configurations ("views") for the Assets table — which
// columns are visible, how wide each is, and the active sort. Scoped per
// user (owner relation) so everyone can save their own set of views without
// stepping on anyone else's. Reads/writes go through the custom
// /api/equipment-views routes (routes_equipment_views.pb.js), same as
// label_templates does through /api/labels — the collection rules below
// exist for consistency/documentation, not because the REST API is used
// directly.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const ownerRule = "owner = @request.auth.id";

    const equipmentViews = new Collection({
      type: "base",
      name: "equipment_views",
      listRule: ownerRule,
      viewRule: ownerRule,
      createRule: `@request.auth.id != '' && ${ownerRule}`,
      updateRule: ownerRule,
      deleteRule: ownerRule,
      fields: [
        { type: "text", name: "name", required: true },
        {
          type: "relation",
          name: "owner",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { type: "json", name: "columns", required: true, maxSize: 20000 },
        { type: "json", name: "widths", maxSize: 20000 },
        { type: "text", name: "sortKey" },
        { type: "text", name: "sortDir" },
        { type: "autodate", name: "createdAt", onCreate: true },
        { type: "autodate", name: "updatedAt", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_equipment_views_owner ON equipment_views (owner)"],
    });
    app.save(equipmentViews);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("equipment_views"));
  },
);
