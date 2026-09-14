/// <reference path="../pb_data/types.d.ts" />
// Each handler does its own require() at the top of its own function body —
// see routes_assets.pb.js for why (route handlers don't retain a closure
// over anything outside their own body at request time).
//
// Reads come from the local rm_equipment/rm_serialnumbers/rm_folders
// mirror (lib/mirror.js), kept current by lib/sync.js — not from Rentman
// directly, so these are instant regardless of how slow Rentman's API is.
// See routes_sync.pb.js / cron_sync.pb.js / routes_webhook_rentman.pb.js
// for how the mirror gets refreshed.

// The workshop thinks in equipment *types* first ("14-35 1000W PACIFIC", 8 in
// stock) and drills into individual serials second — this is the primary
// browse experience, with /api/assets/{id} still used for a single serial.
routerAdd(
  "GET",
  "/api/equipment",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    // The mirror includes archived items (so /api/equipment/{id} below can
    // still resolve one) — the workshop only cares about live stock here.
    const data = allData($app, "rm_equipment").filter((eq) => !eq.in_archive);
    return e.json(200, { data: data });
  },
  $apis.requireAuth(),
);

routerAdd(
  "GET",
  "/api/equipment/{id}",
  (e) => {
    const { dataById, allData } = require(`${__hooks}/lib/mirror.js`);
    const { idFromRef, enrichSerialNumbersLocal } = require(`${__hooks}/lib/enrich.js`);
    const id = e.request.pathValue("id");

    const equipment = dataById($app, "rm_equipment", id);
    if (!equipment) throw new NotFoundError("Equipment not found");

    const allSerials = allData($app, "rm_serialnumbers");
    const allFolders = allData($app, "rm_folders");
    const allLocations = allData($app, "rm_stocklocations");
    const allEquipment = allData($app, "rm_equipment");
    const serials = allSerials.filter((s) => idFromRef(s.equipment) === id);
    const folder = allFolders.find((f) => String(f.id) === idFromRef(equipment.folder));

    return e.json(
      200,
      Object.assign({}, equipment, {
        serialNumbers: enrichSerialNumbersLocal(allEquipment, allLocations, allFolders, serials),
        _folder: folder || null,
      }),
    );
  },
  $apis.requireAuth(),
);
