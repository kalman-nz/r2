/// <reference path="../pb_data/types.d.ts" />
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the same
// const name declared in other routes_*.pb.js files — see routes_labels.pb.js.
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

routerAdd(
  "GET",
  "/api/stats",
  (e) => {
    const { rentman, quantityByEquipmentId } = require(`${__hooks}/lib/rentman.js`);
    const equipment = rentman.listAllEquipment();
    const serials = rentman.listAllSerialNumbers();
    const quantities = quantityByEquipmentId();
    // Same 1500-item cap as GET /api/projects — fine for a headline count.
    const projects = rentman.listProjects({ limit: 1500 });
    const templates = $app.findAllRecords("label_templates");
    const labelsPrinted = $app.findRecordsByFilter("logs", 'type = "print"', "", 0, 0);
    const users = $app.findAllRecords("users");

    const stats = {
      equipmentTypes: equipment.length,
      totalStockUnits: equipment.reduce(
        (sum, eq) => sum + (typeof eq.current_quantity === "number" ? eq.current_quantity : quantities.get(String(eq.id)) || 0),
        0,
      ),
      trackedSerials: serials.length,
      projects: projects.data.length,
      labelTemplates: templates.length,
      labelsPrinted: labelsPrinted.length,
      crewAccounts: users.length,
    };
    return e.json(200, stats);
  },
  $apis.requireAuth(),
  requireAdmin,
);
})();
