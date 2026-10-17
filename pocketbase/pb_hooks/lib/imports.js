// Getting a customer's existing data into R2, the biggest switching cost:
// - runRentmanImport: pulls equipment, serials, folders, stock locations
//   and custom field names from their own Rentman account with their own
//   API token. Re-running it updates whatever it created before (matched
//   on rentmanId) and never deletes anything in R2. It does overwrite
//   imported fields edited in R2 since, so it's for the migration period.
//   Contacts and projects aren't imported yet: their Rentman field names
//   haven't been confirmed against a live account (use the CSV import for
//   contacts).
// - importCsv: items or contacts from a spreadsheet, all-or-nothing, with a
//   dry run that reports every problem row first.
// Every import is recorded in import_runs.
const { idFromRef } = require("./rentman.js");
const { errorMessage } = require("./records.js");

const MAX_ERRORS = 500;

function startRun(org, source, who) {
  const run = new Record($app.findCollectionByNameOrId("import_runs"), {
    org: org,
    source: source,
    status: "running",
    who: who,
    counts: {},
    errors: [],
  });
  $app.save(run);
  return run;
}

function finishRun(run, status, counts, errors, message) {
  run.set("status", status);
  run.set("counts", counts);
  run.set("errors", errors.slice(0, MAX_ERRORS));
  run.set("message", message || "");
  run.set("finishedAt", new Date().toISOString());
  $app.save(run);
}

// rentmanId -> R2 record id for everything this organisation previously
// imported into a collection, so the import doesn't query per row.
function importedIds(collection, org) {
  const rows = arrayOf(new DynamicModel({ id: "", rentmanId: "" }));
  $app
    .db()
    .newQuery("SELECT id, rentmanId FROM " + collection + " WHERE rentmanId != '' AND org = {:org}")
    .bind({ org: org })
    .all(rows);
  const map = {};
  for (const r of rows) map[r.rentmanId] = r.id;
  return map;
}

function upsert(org, collection, ids, rentmanId, data) {
  let record = null;
  if (ids[rentmanId]) {
    try {
      record = $app.findRecordById(collection, ids[rentmanId]);
    } catch (_) {
      record = null;
    }
  }
  if (!record) record = new Record($app.findCollectionByNameOrId(collection), { org: org });
  for (const key of Object.keys(data)) record.set(key, data[key]);
  record.set("rentmanId", rentmanId);
  $app.save(record);
  ids[rentmanId] = record.id;
  return record;
}

// Rentman references are usually "/folders/12"; accept a bare id too.
function refId(value) {
  if (typeof value === "number") return String(value);
  return idFromRef(value);
}

function runRentmanImport(org, token, who) {
  const { createRentmanClient } = require("./rentman.js");
  if (!token) throw new BadRequestError("No Rentman API token — add one in Settings > Import");
  const client = createRentmanClient(token);
  const run = startRun(org, "rentman", who);
  const counts = { categories: 0, locations: 0, customFields: 0, items: 0, serials: 0 };
  const errors = [];
  const fail = (resource, rentmanId, name, err) => {
    if (errors.length < MAX_ERRORS) errors.push({ resource: resource, rentmanId: String(rentmanId), name: name || "", message: errorMessage(err) });
  };

  try {
    // Fetch everything before writing anything, so a Rentman outage or a
    // bad token leaves R2 untouched.
    const folders = client.listAllFolders();
    const stockLocations = client.listAllStockLocations();
    const extraFields = client.listAllExtraInputFields();
    const equipment = client.listAllEquipment();
    const serialNumbers = client.listAllSerialNumbers();

    // Only the folders equipment actually sits in (and their parents), so
    // contact/project folders don't turn into inventory categories.
    const folderById = {};
    for (const f of folders) folderById[String(f.id)] = f;
    const wanted = {};
    for (const eq of equipment) {
      let id = refId(eq.folder);
      for (let depth = 0; id && folderById[id] && !wanted[id] && depth < 50; depth++) {
        wanted[id] = true;
        id = refId(folderById[id].parent);
      }
    }
    const categoryIds = importedIds("categories", org);
    for (const id of Object.keys(wanted)) {
      const f = folderById[id];
      try {
        upsert(org, "categories", categoryIds, id, { name: f.name || f.displayname || "Folder " + id });
        counts.categories++;
      } catch (err) {
        fail("folder", id, f.name, err);
      }
    }
    // Second pass once every category exists: hang each under its parent.
    for (const id of Object.keys(wanted)) {
      const parentId = refId(folderById[id].parent);
      if (!categoryIds[id] || !parentId || !categoryIds[parentId]) continue;
      try {
        const record = $app.findRecordById("categories", categoryIds[id]);
        record.set("parent", categoryIds[parentId]);
        $app.save(record);
      } catch (err) {
        fail("folder", id, folderById[id].name, err);
      }
    }

    const locationIds = importedIds("locations", org);
    for (const l of stockLocations) {
      try {
        upsert(org, "locations", locationIds, String(l.id), { name: l.displayname || l.name || "Location " + l.id });
        counts.locations++;
      } catch (err) {
        fail("stocklocation", l.id, l.displayname, err);
      }
    }

    // Rentman's itemtype "Materiaal" is equipment, "Exemplaar" a serialised
    // unit; fields on anything else (projects, contacts...) aren't used.
    const appliesTo = { Materiaal: "item", Exemplaar: "serial" };
    const fieldsCollection = $app.findCollectionByNameOrId("custom_fields");
    for (const f of extraFields) {
      if (!appliesTo[f.itemtype]) continue;
      const key = "custom_" + f.id;
      try {
        let record = $app.findRecordsByFilter("custom_fields", "org = {:org} && key = {:key}", "", 1, 0, { org: org, key: key })[0];
        if (!record) record = new Record(fieldsCollection, { org: org, key: key });
        record.set("label", f.displayname || f.name || key);
        record.set("appliesTo", appliesTo[f.itemtype]);
        record.set("source", "rentman");
        $app.save(record);
        counts.customFields++;
      } catch (err) {
        fail("extrainputfield", f.id, f.displayname, err);
      }
    }

    const serialCount = {};
    for (const s of serialNumbers) {
      const eqId = refId(s.equipment);
      if (eqId) serialCount[eqId] = (serialCount[eqId] || 0) + 1;
    }
    // Rentman's bulk equipment list leaves current_quantity empty; summing
    // stock movements gives the real count (only fetched if needed).
    let movementQty = null;
    const bulkQuantity = (eq) => {
      if (typeof eq.current_quantity === "number") return eq.current_quantity;
      if (!movementQty) {
        movementQty = {};
        for (const m of client.listAllStockMovements()) {
          const eqId = refId(m.equipment);
          if (eqId && typeof m.amount === "number") movementQty[eqId] = (movementQty[eqId] || 0) + m.amount;
        }
      }
      return movementQty[String(eq.id)] || 0;
    };

    const itemIds = importedIds("items", org);
    for (const eq of equipment) {
      const id = String(eq.id);
      const name = eq.displayname || eq.name || "Rentman item " + id;
      const serialised = (serialCount[id] || 0) > 0;
      try {
        upsert(org, "items", itemIds, id, {
          name: name,
          code: eq.code || "",
          category: categoryIds[refId(eq.folder)] || "",
          kind: "item",
          tracking: serialised ? "serial" : "bulk",
          stockQty: serialised ? 0 : Math.max(0, Math.round(bulkQuantity(eq))),
          dayRate: Number(eq.price) || 0,
          weightKg: Number(eq.weight) || 0,
          powerW: Number(eq.power) || 0,
          barcode: eq.qrcodes || "",
          locationInWarehouse: eq.location_in_warehouse || "",
          tags: eq.tags || "",
          description: eq.external_remark || "",
          notes: eq.internal_remark || "",
          archived: eq.in_archive === true,
          custom: eq.custom || {},
        });
        counts.items++;
      } catch (err) {
        fail("equipment", id, name, err);
      }
    }

    const serialIds = importedIds("serials", org);
    for (const s of serialNumbers) {
      const id = String(s.id);
      const itemId = itemIds[refId(s.equipment)];
      if (!itemId) {
        fail("serialnumber", id, s.displayname, "its equipment wasn't imported");
        continue;
      }
      try {
        upsert(org, "serials", serialIds, id, {
          item: itemId,
          barcode: s.qrcodes || s.ref || "",
          serialNumber: s.serial || "",
          label: s.displayname || "",
          status: s.active === false ? "retired" : "active",
          location: locationIds[refId(s.asset_location)] || "",
          purchaseDate: s.purchasedate || "",
          purchaseCost: Number(s.purchase_costs) || 0,
          nextInspection: s.next_inspection || "",
          notes: s.remark || "",
          custom: s.custom || {},
        });
        counts.serials++;
      } catch (err) {
        fail("serialnumber", id, s.displayname, err);
      }
    }

    finishRun(run, "ok", counts, errors, "");
  } catch (err) {
    finishRun(run, "failed", counts, errors, errorMessage(err));
    throw new BadRequestError("Rentman import failed: " + errorMessage(err));
  }
  return { runId: run.id, counts: counts, errors: errors };
}

// "$1,200.50" → 1200.5; blank → undefined (leave the default).
function csvNumber(value, what) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(what + " isn't a number: " + value);
  return n;
}

// "Audio/Speakers" or "Audio > Speakers": finds or creates each level.
function categoryForPath(app, org, path, cache) {
  const parts = String(path || "")
    .split(/\s*(?:\/|>)\s*/)
    .map((p) => p.trim())
    .filter((p) => p);
  let parentId = "";
  let key = "";
  for (const name of parts) {
    key += "/" + name.toLowerCase();
    if (!cache[key]) {
      // Not "parent = {:parent}" with an empty parent: PocketBase binds an
      // empty string placeholder as the literal '""', which never matches.
      const siblings = parentId
        ? app.findRecordsByFilter("categories", "org = {:org} && parent = {:parent}", "", 0, 0, { org: org, parent: parentId })
        : app.findRecordsByFilter("categories", "org = {:org} && parent = ''", "", 0, 0, { org: org });
      const existing = siblings.find((c) => c.getString("name").toLowerCase() === name.toLowerCase());
      if (existing) {
        cache[key] = existing.id;
      } else {
        const record = new Record(app.findCollectionByNameOrId("categories"), { org: org, name: name, parent: parentId });
        app.save(record);
        cache[key] = record.id;
      }
    }
    parentId = cache[key];
  }
  return parentId;
}

function importItemRow(app, org, row, counts, cache) {
  const name = String(row.name || "").trim();
  if (!name) throw new Error("name is required");
  const code = String(row.code || "").trim();
  if (code && app.findRecordsByFilter("items", "org = {:org} && code = {:code}", "", 1, 0, { org: org, code: code }).length > 0) {
    throw new Error("an item with code " + code + " already exists");
  }
  const barcodes = String(row.serials || "")
    .split(/[;|\n]/)
    .map((b) => b.trim())
    .filter((b) => b);
  const serialised = barcodes.length > 0;
  const item = new Record(app.findCollectionByNameOrId("items"), {
    org: org,
    name: name,
    code: code,
    category: categoryForPath(app, org, row.category, cache),
    kind: "item",
    tracking: serialised ? "serial" : "bulk",
    stockQty: serialised ? 0 : Math.max(0, Math.round(csvNumber(row.quantity, "quantity") || 0)),
    dayRate: csvNumber(row.dayRate, "day rate") || 0,
    replacementValue: csvNumber(row.replacementValue, "replacement value") || 0,
    weightKg: csvNumber(row.weightKg, "weight") || 0,
    powerW: csvNumber(row.powerW, "power") || 0,
    barcode: String(row.barcode || "").trim(),
    locationInWarehouse: String(row.locationInWarehouse || "").trim(),
    tags: String(row.tags || "").trim(),
    description: String(row.description || "").trim(),
    notes: String(row.notes || "").trim(),
  });
  app.save(item);
  counts.items++;
  const serials = app.findCollectionByNameOrId("serials");
  for (const barcode of barcodes) {
    app.save(new Record(serials, { org: org, item: item.id, barcode: barcode, status: "active" }));
    counts.serials++;
  }
}

function importContactRow(app, org, row, counts) {
  const name = String(row.name || "").trim();
  if (!name) throw new Error("name is required");
  const email = String(row.email || "").trim();
  if (
    email &&
    app.findRecordsByFilter("contacts", "org = {:org} && name = {:name} && email = {:email}", "", 1, 0, { org: org, name: name, email: email })
      .length > 0
  ) {
    throw new Error(name + " <" + email + "> already exists");
  }
  const kind = String(row.kind || "").trim().toLowerCase();
  app.save(
    new Record(app.findCollectionByNameOrId("contacts"), {
      org: org,
      name: name,
      kind: kind === "person" ? "person" : "company",
      contactPerson: String(row.contactPerson || "").trim(),
      email: email,
      phone: String(row.phone || "").trim(),
      billingAddress: String(row.billingAddress || "").trim(),
      notes: String(row.notes || "").trim(),
    }),
  );
  counts.contacts++;
}

// rows: objects keyed by R2 field names (the browser maps the spreadsheet's
// columns). Runs in one transaction: with dryRun, or if any row fails,
// nothing is kept and every problem row is reported (row numbers count the
// header as row 1, to match the spreadsheet).
function importCsv(org, kind, rows, dryRun, who) {
  if (kind !== "items" && kind !== "contacts") throw new BadRequestError("kind must be items or contacts");
  if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestError("No rows to import");
  if (rows.length > 10000) throw new BadRequestError("Split files over 10,000 rows into smaller imports");

  const counts = kind === "items" ? { items: 0, serials: 0 } : { contacts: 0 };
  const errors = [];
  let rollingBack = false;
  try {
    $app.runInTransaction((tx) => {
      const cache = {};
      rows.forEach((row, i) => {
        try {
          if (kind === "items") importItemRow(tx, org, row || {}, counts, cache);
          else importContactRow(tx, org, row || {}, counts);
        } catch (err) {
          if (errors.length < MAX_ERRORS) errors.push({ row: i + 2, message: errorMessage(err) });
        }
      });
      if (dryRun || errors.length > 0) {
        rollingBack = true;
        throw new Error("rollback");
      }
    });
  } catch (err) {
    if (!rollingBack) throw err;
  }

  const committed = !rollingBack;
  if (committed) {
    const run = startRun(org, "csv", who);
    finishRun(run, "ok", Object.assign({ kind: kind }, counts), [], "");
  }
  return { dryRun: dryRun === true, committed: committed, counts: counts, errors: errors };
}

module.exports = { runRentmanImport, importCsv };
