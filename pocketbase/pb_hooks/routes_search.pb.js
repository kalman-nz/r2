/// <reference path="../pb_data/types.d.ts" />
// Backs the header's global search box (web/src/components/GlobalSearch.tsx)
// — one endpoint across the app's core named entities (equipment types,
// individual serialized assets, label templates) instead of three separate
// lookups. Reads come from the same local mirror the list pages already
// use (lib/mirror.js), so this is instant regardless of Rentman API
// latency. Every match is a case-insensitive substring check, not fuzzy —
// fine at this dataset's size, and predictable for barcode-scanned exact
// values too.
routerAdd(
  "GET",
  "/api/search",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    const { enrichSerialNumbersLocal } = require(`${__hooks}/lib/enrich.js`);
    const term = (e.requestInfo().query.q || "").trim().toLowerCase();
    if (!term) return e.json(200, { equipment: [], assets: [], labels: [] });

    const LIMIT = 8;
    function includesTerm(fields) {
      return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(term));
    }

    const allEquipment = allData($app, "rm_equipment");
    const equipment = allEquipment
      .filter((eq) => !eq.in_archive)
      .filter((eq) => includesTerm([eq.displayname, eq.name, eq.code, eq.tags, eq.type]))
      .slice(0, LIMIT)
      .map((eq) => ({
        id: String(eq.id),
        name: eq.displayname || eq.name,
        subtitle: [eq.code, eq.location_in_warehouse].filter(Boolean).join(" · "),
      }));

    const allSerials = allData($app, "rm_serialnumbers");
    const matchedSerials = allSerials
      .filter((s) => includesTerm([s.displayname, s.serial, s.ref, s.qrcodes, s.tags]))
      .slice(0, LIMIT);
    const allLocations = allData($app, "rm_stocklocations");
    const allFolders = allData($app, "rm_folders");
    const assets = enrichSerialNumbersLocal(allEquipment, allLocations, allFolders, matchedSerials).map((s) => ({
      id: String(s.id),
      name: s.displayname,
      subtitle: [s._location ? s._location.displayname : null, s.serial].filter(Boolean).join(" · "),
    }));

    const labels = $app
      .findAllRecords("label_templates")
      .filter((l) => includesTerm([l.get("name")]))
      .slice(0, LIMIT)
      .map((l) => ({
        id: l.id,
        name: l.get("name"),
        subtitle: `${l.get("widthMm")} × ${l.get("heightMm")} mm`,
      }));

    return e.json(200, { equipment, assets, labels });
  },
  $apis.requireAuth(),
);
