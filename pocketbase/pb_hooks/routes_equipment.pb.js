/// <reference path="../pb_data/types.d.ts" />
// Each handler does its own require() at the top of its own function body —
// see routes_assets.pb.js for why (route handlers don't retain a closure
// over anything outside their own body at request time).

// The workshop thinks in equipment *types* first ("14-35 1000W PACIFIC", 8 in
// stock) and drills into individual serials second — this is the primary
// browse experience, with /api/assets/{id} still used for a single serial.
routerAdd(
  "GET",
  "/api/equipment",
  (e) => {
    const { rentman, quantityByEquipmentId } = require(`${__hooks}/lib/rentman.js`);
    // Rentman's /equipment list includes archived items — the workshop only
    // cares about live stock, so drop them here (the single-item route below
    // still resolves an archived id if something links straight to it).
    const data = rentman.listAllEquipment().filter((eq) => !eq.in_archive);
    const quantities = quantityByEquipmentId();
    return e.json(200, {
      data: data.map((eq) =>
        Object.assign({}, eq, {
          current_quantity: eq.current_quantity != null ? eq.current_quantity : quantities.get(String(eq.id)) || 0,
        }),
      ),
    });
  },
  $apis.requireAuth(),
);

routerAdd(
  "GET",
  "/api/equipment/{id}",
  (e) => {
    const { rentman, idFromRef, enrichSerialNumbers, quantityByEquipmentId } = require(`${__hooks}/lib/rentman.js`);
    const id = e.request.pathValue("id");
    const allEquipment = rentman.listAllEquipment();
    const allSerials = rentman.listAllSerialNumbers();
    const allFolders = rentman.listAllFolders();
    const quantities = quantityByEquipmentId();

    const equipment = allEquipment.find((eq) => String(eq.id) === id);
    if (!equipment) throw new NotFoundError("Equipment not found");

    const serials = allSerials.filter((s) => idFromRef(s.equipment) === id);
    const folder = allFolders.find((f) => String(f.id) === idFromRef(equipment.folder));
    return e.json(
      200,
      Object.assign({}, equipment, {
        current_quantity: equipment.current_quantity != null ? equipment.current_quantity : quantities.get(id) || 0,
        serialNumbers: enrichSerialNumbers(serials),
        _folder: folder || null,
      }),
    );
  },
  $apis.requireAuth(),
);
