// Local-mirror equivalent of the join lib/rentman.js used to do against
// live Rentman data (enrichSerialNumbers) — same output shape, but pure:
// callers pass in the already-loaded local equipment/location/folder
// arrays (via lib/mirror.js's allData()) instead of this module fetching
// them itself. Every *.pb.js route handler already does its own require()
// per PocketBase JSVM's per-request isolation (see routes_assets.pb.js) —
// keeping this a pure function sidesteps needing to know whether that same
// rule applies transitively to a plain lib module calling require() itself.

function idFromRef(ref) {
  return typeof ref === "string" ? ref.split("/").pop() || null : null;
}

// Mirrors lib/rentman.js's enrichSerialNumbers exactly, but joins against
// arrays the caller already loaded from the local mirror instead of doing
// 3 live Rentman list calls per request.
function enrichSerialNumbersLocal(allEquipment, allLocations, allFolders, records) {
  const equipmentById = new Map(allEquipment.map((e) => [String(e.id), e]));
  const locationById = new Map(allLocations.map((l) => [String(l.id), l]));
  const folderById = new Map(allFolders.map((f) => [String(f.id), f]));

  return records.map((r) => {
    const equipment = equipmentById.get(idFromRef(r.equipment) || "") || null;
    return Object.assign({}, r, {
      _equipment: equipment,
      _location: locationById.get(idFromRef(r.asset_location) || "") || null,
      _folder: folderById.get(idFromRef(equipment ? equipment.folder : null) || "") || null,
    });
  });
}

module.exports = { idFromRef, enrichSerialNumbersLocal };
