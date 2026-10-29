/// <reference path="../pb_data/types.d.ts" />

// Where stock is, per unit of stock rather than per item.
//
// item_stock  A bulk item's quantity at one stock location, and the shelf or
//             bin it's on there ("3 SM58s in the Main store, Bay 3; 5 at the
//             Theatre"). One row per item and location. The item's stockQty
//             is their total, kept by the server (lib/stock.js), so
//             availability, repairs and imports keep reading one number.
// serials     Gain bin: the shelf or bin a unit sits on at its location.
//
// The item-wide "location in warehouse" text stops being shown: each item's
// becomes the bin of its stock row and of its units that have none. Bulk
// stock already owned starts at the organisation's first location. Units
// with no location go there too when it's the only one.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const items = app.findCollectionByNameOrId("items");
    const locations = app.findCollectionByNameOrId("locations");

    const stock = new Collection({
      type: "base",
      name: "item_stock",
      listRule: MEMBER,
      viewRule: MEMBER,
      createRule: can("items.edit"),
      updateRule: can("items.edit") + " && " + SAME_ORG,
      deleteRule: can("items.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "item", required: true, collectionId: items.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "location", required: true, collectionId: locations.id, maxSelect: 1 },
        { type: "number", name: "qty", onlyInt: true, min: 0 },
        { type: "text", name: "bin", max: 200 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_item_stock_item_location ON item_stock (item, location)",
        "CREATE INDEX idx_item_stock_org ON item_stock (org)",
      ],
    });
    app.save(stock);

    const serials = app.findCollectionByNameOrId("serials");
    serials.fields.add(new TextField({ name: "bin", max: 200 }));
    app.save(serials);

    // Straight to the database: no hooks to run while the schema moves.
    const quiet = app.unsafeWithoutHooks();
    for (const org of app.findAllRecords("organisations")) {
      const orgLocations = app.findRecordsByFilter("locations", "org = {:org}", "created", 0, 0, { org: org.id });
      const first = orgLocations[0];
      if (!first) continue;
      for (const item of app.findRecordsByFilter("items", "org = {:org} && kind = 'item'", "", 0, 0, { org: org.id })) {
        const bin = item.getString("locationInWarehouse").trim();
        if (item.getString("tracking") === "bulk") {
          if (item.getInt("stockQty") > 0 || bin) {
            const row = new Record(stock, { org: org.id, item: item.id, location: first.id, qty: item.getInt("stockQty"), bin: bin });
            row.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
            quiet.save(row);
          }
          continue;
        }
        for (const unit of app.findRecordsByFilter("serials", "item = {:item}", "", 0, 0, { item: item.id })) {
          let changed = false;
          if (bin && !unit.getString("bin")) {
            unit.set("bin", bin);
            changed = true;
          }
          if (!unit.getString("location") && orgLocations.length === 1) {
            unit.set("location", first.id);
            changed = true;
          }
          if (changed) quiet.save(unit);
        }
      }
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("item_stock"));
    const serials = app.findCollectionByNameOrId("serials");
    serials.fields.removeByName("bin");
    app.save(serials);
  },
);
