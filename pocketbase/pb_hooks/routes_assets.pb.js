/// <reference path="../pb_data/types.d.ts" />
// Each handler below does its own require() at the top of its own function
// body instead of closing over an outer `const` — PocketBase's JSVM only
// keeps a route handler's own local scope (plus true globals) alive when it
// actually runs a request; anything captured from an enclosing scope in the
// *.pb.js file (even inside an IIFE) throws "X is not defined" at request
// time. require() is registry-cached, so calling it repeatedly is cheap.

routerAdd(
  "GET",
  "/api/assets",
  (e) => {
    const { rentman, enrichSerialNumbers } = require(`${__hooks}/lib/rentman.js`);
    const data = rentman.listAllSerialNumbers();
    return e.json(200, { data: enrichSerialNumbers(data) });
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
    const { rentman } = require(`${__hooks}/lib/rentman.js`);
    const term = (e.requestInfo().query.q || "").trim();
    if (!term) throw new BadRequestError("Missing q");

    const data = rentman.listAllSerialNumbers();
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
    const { rentman, enrichSerialNumbers } = require(`${__hooks}/lib/rentman.js`);
    const id = e.request.pathValue("id");
    try {
      const asset = rentman.getSerialNumber(id);
      const enriched = enrichSerialNumbers([asset])[0];
      const lastSubproject = typeof asset.last_subproject === "string" ? rentman.resolveRef(asset.last_subproject) : null;
      return e.json(200, Object.assign({}, enriched, { _lastSubproject: lastSubproject }));
    } catch (err) {
      console.error(err);
      throw new NotFoundError("Asset not found");
    }
  },
  $apis.requireAuth(),
);
