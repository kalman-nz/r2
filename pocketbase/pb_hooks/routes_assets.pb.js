/// <reference path="../pb_data/types.d.ts" />
// Each handler below does its own require() at the top of its own function
// body instead of closing over an outer `const` — PocketBase's JSVM only
// keeps a route handler's own local scope (plus true globals) alive when it
// actually runs a request; anything captured from an enclosing scope in the
// *.pb.js file (even inside an IIFE) throws "X is not defined" at request
// time. require() is registry-cached, so calling it repeatedly is cheap.
//
// Reads come from the local rm_serialnumbers mirror (lib/mirror.js), kept
// current by lib/sync.js — not from Rentman directly. See routes_sync.pb.js
// / cron_sync.pb.js / routes_webhook_rentman.pb.js for how it's refreshed.

routerAdd(
  "GET",
  "/api/assets",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    const { enrichSerialNumbersLocal } = require(`${__hooks}/lib/enrich.js`);
    const data = allData($app, "rm_serialnumbers");
    const allEquipment = allData($app, "rm_equipment");
    const allLocations = allData($app, "rm_stocklocations");
    const allFolders = allData($app, "rm_folders");
    // Hide serials whose equipment type is archived — matches the /api/equipment
    // list, which also drops archived items.
    const enriched = enrichSerialNumbersLocal(allEquipment, allLocations, allFolders, data).filter(
      (s) => !(s._equipment && s._equipment.in_archive),
    );
    return e.json(200, { data: enriched });
  },
  $apis.requireAuth(),
);

// For a handheld barcode/QR scanner (acts as a keyboard: types the scanned
// value, then Enter) — match against whichever field a given label template
// happened to encode (id, serial, qrcodes, ref all show up as scannable
// options in the label designer), not just one specific field.
routerAdd(
  "GET",
  "/api/assets/search",
  (e) => {
    const { allData } = require(`${__hooks}/lib/mirror.js`);
    const term = (e.requestInfo().query.q || "").trim();
    if (!term) throw new BadRequestError("Missing q");

    const data = allData($app, "rm_serialnumbers");
    const match = data.find(
      (s) => String(s.id) === term || s.serial === term || s.qrcodes === term || s.ref === term,
    );
    if (!match) throw new NotFoundError("No matching asset found");
    return e.json(200, { id: String(match.id) });
  },
  $apis.requireAuth(),
);

routerAdd(
  "GET",
  "/api/assets/{id}",
  (e) => {
    const { dataById, allData } = require(`${__hooks}/lib/mirror.js`);
    const { enrichSerialNumbersLocal } = require(`${__hooks}/lib/enrich.js`);
    const { rentman } = require(`${__hooks}/lib/rentman.js`);
    const id = e.request.pathValue("id");
    const asset = dataById($app, "rm_serialnumbers", id);
    if (!asset) throw new NotFoundError("Asset not found");
    const allEquipment = allData($app, "rm_equipment");
    const allLocations = allData($app, "rm_stocklocations");
    const allFolders = allData($app, "rm_folders");
    const enriched = enrichSerialNumbersLocal(allEquipment, allLocations, allFolders, [asset])[0];
    // Projects/subprojects aren't mirrored (this app isn't a project-planning
    // tool) — the "current project" printable label field is the one place
    // that data still matters, so it's resolved live here rather than kept
    // in sync in bulk. One occasional lookup for a single asset view, not a
    // list — doesn't cost this route its speed.
    let lastSubproject = null;
    if (typeof asset.last_subproject === "string") {
      try {
        lastSubproject = rentman.resolveRef(asset.last_subproject);
      } catch (err) {
        console.warn("[assets/" + id + "] could not resolve last_subproject: " + err);
      }
    }
    return e.json(200, Object.assign({}, enriched, { _lastSubproject: lastSubproject }));
  },
  $apis.requireAuth(),
);
