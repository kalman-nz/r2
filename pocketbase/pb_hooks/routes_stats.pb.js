/// <reference path="../pb_data/types.d.ts" />
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the same
// const name declared in other routes_*.pb.js files — see routes_labels.pb.js.
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

routerAdd(
  "GET",
  "/api/stats",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    const equipment = allData($app, "rm_equipment");
    const serials = allData($app, "rm_serialnumbers");
    const templates = $app.findAllRecords("label_templates");
    const labelsPrinted = $app.findRecordsByFilter("logs", 'type = "print"', "", 0, 0);
    const users = $app.findAllRecords("users");

    const stats = {
      equipmentTypes: equipment.length,
      totalStockUnits: equipment.reduce((sum, eq) => sum + (eq.current_quantity || 0), 0),
      trackedSerials: serials.length,
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
