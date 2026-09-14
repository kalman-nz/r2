/// <reference path="../pb_data/types.d.ts" />

// This app is a label-printing tool that looks up equipment/assets in
// Rentman — not a project-planning or financials tool, so those mirror
// collections (added in 0014 for pages that have since been removed:
// Projects, Project financials, Inventory audit) never needed to exist.
// rm_equipment/rm_serialnumbers/rm_stocklocations/rm_folders stay — label
// printing and asset lookup still need all four.
migrate(
  (app) => {
    const dropped = ["rm_projects", "rm_subprojects", "rm_projectequipmentgroups", "rm_projectequipment", "rm_contacts"];
    for (const name of dropped) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
  (app) => {
    const authRule = "@request.auth.id != ''";
    const restored = ["rm_projects", "rm_subprojects", "rm_projectequipmentgroups", "rm_projectequipment", "rm_contacts"];
    for (const name of restored) {
      const collection = new Collection({
        type: "base",
        name: name,
        listRule: authRule,
        viewRule: authRule,
        fields: [
          { type: "text", name: "rentmanId", required: true },
          { type: "json", name: "data", required: true, maxSize: 2000000 },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_" + name + "_rentmanId ON " + name + " (rentmanId)"],
      });
      app.save(collection);
    }
  },
);
