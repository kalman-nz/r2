/// <reference path="../pb_data/types.d.ts" />

// R2's own data model. Until now this app read everything from a Rentman
// mirror. From here on these collections are the source of truth, and
// Rentman is only something you import from (lib/rentmanImport.js).
//
// Conventions:
// - Money is NZD dollars excluding GST (number fields). All maths happens in
//   integer cents in lib/pricing.js.
// - rentmanId is set only on records that came from a Rentman import, so
//   re-running an import updates them instead of duplicating. Partial unique
//   indexes let every hand-made record leave it blank.
// - Collections with business rules (job_lines, quotes, scans) can't be
//   written through the REST API at all (create/update/delete rules unset =
//   superuser only). The custom routes in routes_jobs.pb.js /
//   routes_scan.pb.js write them as $app after validating, so kit expansion,
//   quote numbering and scan checks can't be bypassed.
// - Plain catalogue data (items, serials, contacts, venues, ...) is written
//   straight through the PocketBase SDK, gated by role below and by the
//   validation hooks in records_*.pb.js.
migrate(
  (app) => {
    const authRule = "@request.auth.id != ''";
    const plannerRule = "(@request.auth.role = 'admin' || @request.auth.role = 'planner')";
    const adminRule = "@request.auth.role = 'admin'";
    const users = app.findCollectionByNameOrId("users");

    const timestamps = () => [
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];
    const catalogueRules = {
      listRule: authRule,
      viewRule: authRule,
      createRule: plannerRule,
      updateRule: plannerRule,
      deleteRule: plannerRule,
    };

    // Rentman calls these folders. parent makes a tree ("Audio / Speakers").
    const categories = new Collection(
      Object.assign({ type: "base", name: "categories" }, catalogueRules, {
        fields: [
          { type: "text", name: "name", required: true, max: 200 },
          { type: "number", name: "sortOrder", onlyInt: true },
          { type: "text", name: "rentmanId" },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_categories_rentmanId ON categories (rentmanId) WHERE rentmanId != ''"],
      }),
    );
    app.save(categories);
    categories.fields.add(new RelationField({ name: "parent", collectionId: categories.id, maxSelect: 1 }));
    app.save(categories);

    // Warehouses / stock locations. The MVP runs one warehouse, but serials
    // already record where they live so multi-warehouse (v2) has a place to
    // start from.
    const locations = new Collection(
      Object.assign({ type: "base", name: "locations" }, catalogueRules, {
        fields: [
          { type: "text", name: "name", required: true, max: 200 },
          { type: "text", name: "address", max: 1000 },
          { type: "text", name: "rentmanId" },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_locations_rentmanId ON locations (rentmanId) WHERE rentmanId != ''"],
      }),
    );
    app.save(locations);

    // An equipment type ("Shure SM58", "Yamaha QL5"). kind "item" is
    // physical stock, tracked either as a bulk count (stockQty) or as
    // individual serials. kind "kit" owns no stock of its own; it's a bundle
    // of item_components priced as one line and only as available as its
    // scarcest component.
    const items = new Collection(
      Object.assign({ type: "base", name: "items" }, catalogueRules, {
        fields: [
          { type: "text", name: "name", required: true, max: 300 },
          { type: "text", name: "code", max: 100 },
          { type: "relation", name: "category", collectionId: categories.id, maxSelect: 1 },
          { type: "select", name: "kind", required: true, values: ["item", "kit"], maxSelect: 1 },
          { type: "select", name: "tracking", values: ["bulk", "serial"], maxSelect: 1 },
          // Bulk items only. Serialised stock is counted from serials.
          { type: "number", name: "stockQty", onlyInt: true, min: 0 },
          // Bulk units flagged broken/unavailable (the MVP's maintenance
          // flag; serials use their own status instead).
          { type: "number", name: "outOfServiceQty", onlyInt: true, min: 0 },
          { type: "number", name: "dayRate", min: 0 },
          { type: "number", name: "replacementValue", min: 0 },
          { type: "number", name: "weightKg", min: 0 },
          { type: "number", name: "powerW", min: 0 },
          // Extra turnaround after a job returns, on top of the global
          // buffer in settings (e.g. moving heads that need testing).
          { type: "number", name: "bufferHours", min: 0 },
          // Scan code for bulk stock (one code per type, not per unit).
          { type: "text", name: "barcode", max: 200 },
          { type: "text", name: "locationInWarehouse", max: 200 },
          { type: "text", name: "tags", max: 500 },
          // description goes on quotes; notes stay internal.
          { type: "text", name: "description", max: 5000 },
          { type: "text", name: "notes", max: 10000 },
          {
            type: "file",
            name: "photo",
            maxSelect: 1,
            maxSize: 5242880,
            mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
            thumbs: ["100x100", "400x0"],
          },
          { type: "bool", name: "archived" },
          // Imported custom field values, keyed like "custom_12" — see
          // custom_fields below for their names.
          { type: "json", name: "custom", maxSize: 200000 },
          { type: "text", name: "rentmanId" },
          ...timestamps(),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_items_rentmanId ON items (rentmanId) WHERE rentmanId != ''",
          "CREATE UNIQUE INDEX idx_items_barcode ON items (barcode) WHERE barcode != ''",
          "CREATE INDEX idx_items_category ON items (category)",
        ],
      }),
    );
    app.save(items);

    // One physical unit of a serial-tracked item. Only "active" units count
    // as stock; repair/lost/retired units are kept for history.
    const serials = new Collection(
      Object.assign({ type: "base", name: "serials" }, catalogueRules, {
        fields: [
          { type: "relation", name: "item", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
          // What gets scanned — usually the asset tag R2 printed.
          { type: "text", name: "barcode", max: 200 },
          // The manufacturer's serial number.
          { type: "text", name: "serialNumber", max: 200 },
          // Optional friendly name ("Desk 2"); otherwise shown as item + barcode.
          { type: "text", name: "label", max: 200 },
          { type: "select", name: "status", required: true, values: ["active", "repair", "lost", "retired"], maxSelect: 1 },
          { type: "relation", name: "location", collectionId: locations.id, maxSelect: 1 },
          { type: "date", name: "purchaseDate" },
          { type: "number", name: "purchaseCost", min: 0 },
          // Electrical test & tag due date.
          { type: "date", name: "nextInspection" },
          { type: "text", name: "notes", max: 10000 },
          { type: "json", name: "custom", maxSize: 200000 },
          { type: "text", name: "rentmanId" },
          ...timestamps(),
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_serials_rentmanId ON serials (rentmanId) WHERE rentmanId != ''",
          "CREATE UNIQUE INDEX idx_serials_barcode ON serials (barcode) WHERE barcode != ''",
          "CREATE INDEX idx_serials_item ON serials (item)",
        ],
      }),
    );
    app.save(serials);

    // Links between items. "component" rows define what a kit is made of
    // (quantity per kit). "accessory" rows get added automatically whenever
    // the parent goes on a job (quantity per parent unit), free unless
    // chargeable is set.
    const itemComponents = new Collection(
      Object.assign({ type: "base", name: "item_components" }, catalogueRules, {
        fields: [
          { type: "relation", name: "parent", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
          { type: "relation", name: "child", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
          { type: "select", name: "kind", required: true, values: ["component", "accessory"], maxSelect: 1 },
          { type: "number", name: "quantity", required: true, onlyInt: true, min: 1 },
          { type: "bool", name: "chargeable" },
          { type: "number", name: "sortOrder", onlyInt: true },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_item_components_link ON item_components (parent, child, kind)"],
      }),
    );
    app.save(itemComponents);

    const contacts = new Collection(
      Object.assign({ type: "base", name: "contacts" }, catalogueRules, {
        fields: [
          { type: "text", name: "name", required: true, max: 300 },
          { type: "select", name: "kind", values: ["company", "person"], maxSelect: 1 },
          { type: "text", name: "contactPerson", max: 200 },
          { type: "email", name: "email" },
          { type: "text", name: "phone", max: 100 },
          { type: "text", name: "billingAddress", max: 1000 },
          { type: "text", name: "notes", max: 10000 },
          { type: "bool", name: "archived" },
          { type: "text", name: "rentmanId" },
          ...timestamps(),
        ],
        indexes: ["CREATE UNIQUE INDEX idx_contacts_rentmanId ON contacts (rentmanId) WHERE rentmanId != ''"],
      }),
    );
    app.save(contacts);

    // Where a job happens. Deliberately small: v2's space booking hangs
    // rooms/spaces off this.
    const venues = new Collection(
      Object.assign({ type: "base", name: "venues" }, catalogueRules, {
        fields: [
          { type: "text", name: "name", required: true, max: 300 },
          { type: "text", name: "address", max: 1000 },
          { type: "text", name: "contactName", max: 200 },
          { type: "text", name: "phone", max: 100 },
          { type: "text", name: "notes", max: 10000 },
          { type: "bool", name: "archived" },
          ...timestamps(),
        ],
      }),
    );
    app.save(venues);

    // A job (Rentman: project). Kit is held from prepAt (packing starts)
    // until returnAt (back in the warehouse) plus turnaround buffer — see
    // lib/availability.js. Show dates are what the client cares about and
    // what hire days are charged on (falling back to prep→return for a dry
    // hire with no show dates). number is assigned by records_jobs.pb.js.
    const jobs = new Collection({
      type: "base",
      name: "jobs",
      listRule: authRule,
      viewRule: authRule,
      createRule: plannerRule,
      updateRule: plannerRule,
      deleteRule: plannerRule,
      fields: [
        { type: "number", name: "number", onlyInt: true, min: 1 },
        { type: "text", name: "name", required: true, max: 300 },
        {
          type: "select",
          name: "status",
          required: true,
          values: ["enquiry", "provisional", "confirmed", "out", "returned", "cancelled"],
          maxSelect: 1,
        },
        { type: "relation", name: "client", collectionId: contacts.id, maxSelect: 1 },
        { type: "relation", name: "venue", collectionId: venues.id, maxSelect: 1 },
        { type: "date", name: "prepAt", required: true },
        { type: "date", name: "showStart" },
        { type: "date", name: "showEnd" },
        { type: "date", name: "returnAt", required: true },
        // Overrides the calculated number of charged days when set (> 0).
        { type: "number", name: "chargeDays", onlyInt: true, min: 0 },
        { type: "number", name: "discountPct", min: 0, max: 100 },
        // The client's PO number or similar.
        { type: "text", name: "reference", max: 200 },
        // quoteNotes are printed on quotes; notes stay internal.
        { type: "text", name: "quoteNotes", max: 5000 },
        { type: "text", name: "notes", max: 10000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "text", name: "rentmanId" },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_jobs_number ON jobs (number)",
        "CREATE INDEX idx_jobs_window ON jobs (status, prepAt, returnAt)",
        "CREATE UNIQUE INDEX idx_jobs_rentmanId ON jobs (rentmanId) WHERE rentmanId != ''",
      ],
    });
    app.save(jobs);

    // What's on a job. lineType:
    // - item: something picked from inventory (a physical item or a kit)
    // - component / accessory: added automatically under a parent line;
    //   quantity follows the parent (perParent × parent quantity)
    // - custom: free text with a price (delivery, labour, a sale item)
    // Only lines whose item is physical (kind "item") hold stock; a kit's
    // parent line is just its price.
    const jobLines = new Collection({
      type: "base",
      name: "job_lines",
      listRule: authRule,
      viewRule: authRule,
      fields: [
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "item", collectionId: items.id, maxSelect: 1 },
        {
          type: "select",
          name: "lineType",
          required: true,
          values: ["item", "component", "accessory", "custom"],
          maxSelect: 1,
        },
        { type: "text", name: "description", max: 500 },
        // Fractional for custom lines (7.5 hours of labour); the routes keep
        // inventory lines whole.
        { type: "number", name: "quantity", required: true, min: 0 },
        { type: "number", name: "perParent", onlyInt: true, min: 0 },
        // Snapshot of the item's day rate when added, editable per job.
        // Negative allowed so a custom line can be a credit.
        { type: "number", name: "unitPrice" },
        { type: "select", name: "priceMode", required: true, values: ["per_day", "fixed"], maxSelect: 1 },
        { type: "number", name: "discountPct", min: 0, max: 100 },
        // Heading the line sits under on the quote ("Audio", "Lighting").
        { type: "text", name: "group", max: 200 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "text", name: "notes", max: 2000 },
        ...timestamps(),
      ],
      indexes: ["CREATE INDEX idx_job_lines_job ON job_lines (job)", "CREATE INDEX idx_job_lines_item ON job_lines (item)"],
    });
    app.save(jobLines);
    jobLines.fields.add(
      new RelationField({ name: "parentLine", collectionId: jobLines.id, maxSelect: 1, cascadeDelete: true }),
    );
    app.save(jobLines);

    // An issued quote is a frozen snapshot of the job (lines, prices, totals,
    // business details) so it reads the same later however the job changes.
    // Each job's quotes are numbered 1, 2, 3... A job with quotes can't be
    // deleted (required relation, no cascade): cancel it instead.
    const quotes = new Collection({
      type: "base",
      name: "quotes",
      listRule: plannerRule,
      viewRule: plannerRule,
      fields: [
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1 },
        { type: "number", name: "version", required: true, onlyInt: true, min: 1 },
        { type: "select", name: "status", required: true, values: ["issued", "accepted", "declined", "void"], maxSelect: 1 },
        { type: "json", name: "snapshot", required: true, maxSize: 2000000 },
        { type: "number", name: "exGst" },
        { type: "number", name: "gst" },
        { type: "number", name: "total" },
        { type: "date", name: "issuedAt", required: true },
        { type: "date", name: "validUntil" },
        { type: "relation", name: "issuedBy", collectionId: users.id, maxSelect: 1 },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX idx_quotes_job_version ON quotes (job, version)"],
    });
    app.save(quotes);

    // Scan ledger: what physically left and came back for a job. A serial
    // is "out" while its latest scan is direction "out". Same no-cascade
    // rule as quotes, so a job with scan history can't be deleted.
    const scans = new Collection({
      type: "base",
      name: "scans",
      listRule: authRule,
      viewRule: authRule,
      fields: [
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1 },
        { type: "relation", name: "item", required: true, collectionId: items.id, maxSelect: 1 },
        { type: "relation", name: "serial", collectionId: serials.id, maxSelect: 1 },
        { type: "select", name: "direction", required: true, values: ["out", "in"], maxSelect: 1 },
        { type: "number", name: "quantity", required: true, onlyInt: true, min: 1 },
        { type: "relation", name: "who", collectionId: users.id, maxSelect: 1 },
        { type: "text", name: "note", max: 500 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: ["CREATE INDEX idx_scans_job ON scans (job)", "CREATE INDEX idx_scans_serial ON scans (serial, created)"],
    });
    app.save(scans);

    // Names for the "custom_<id>" keys inside items.custom / serials.custom,
    // so the label designer can offer "Custom: Test tag ID" instead of a raw
    // key. Filled by the Rentman importer.
    const customFields = new Collection({
      type: "base",
      name: "custom_fields",
      listRule: authRule,
      viewRule: authRule,
      fields: [
        { type: "text", name: "key", required: true, max: 100 },
        { type: "text", name: "label", required: true, max: 200 },
        { type: "select", name: "appliesTo", required: true, values: ["item", "serial"], maxSelect: 1 },
        { type: "text", name: "source", max: 50 },
        ...timestamps(),
      ],
      indexes: ["CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields (key)"],
    });
    app.save(customFields);

    // One row per import (Rentman API or CSV): what came in, what failed.
    const importRuns = new Collection({
      type: "base",
      name: "import_runs",
      listRule: adminRule,
      viewRule: adminRule,
      fields: [
        { type: "select", name: "source", required: true, values: ["rentman", "csv"], maxSelect: 1 },
        { type: "select", name: "status", required: true, values: ["running", "ok", "failed"], maxSelect: 1 },
        { type: "json", name: "counts", maxSize: 100000 },
        { type: "json", name: "errors", maxSize: 2000000 },
        { type: "text", name: "message", max: 5000 },
        { type: "text", name: "who", max: 200 },
        { type: "date", name: "finishedAt" },
        ...timestamps(),
      ],
    });
    app.save(importRuns);
  },
  (app) => {
    for (const name of [
      "import_runs",
      "custom_fields",
      "scans",
      "quotes",
      "job_lines",
      "jobs",
      "venues",
      "contacts",
      "item_components",
      "serials",
      "items",
      "locations",
      "categories",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
