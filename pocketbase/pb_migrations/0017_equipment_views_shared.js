/// <reference path="../pb_data/types.d.ts" />

// Lets a saved view be shared with every signed-in user, not just its
// owner — a "Share with everyone" toggle in the Manage Views modal
// (routes_equipment_views.pb.js). Owner still exclusively controls
// renaming/sharing/deleting; sharing only widens who can see and apply it.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("equipment_views");
    collection.fields.add(new BoolField({ name: "shared" }));
    collection.listRule = "owner = @request.auth.id || shared = true";
    collection.viewRule = "owner = @request.auth.id || shared = true";
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("equipment_views");
    collection.fields.removeByName("shared");
    collection.listRule = "owner = @request.auth.id";
    collection.viewRule = "owner = @request.auth.id";
    app.save(collection);
  },
);
