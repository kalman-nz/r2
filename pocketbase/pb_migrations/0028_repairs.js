/// <reference path="../pb_data/types.d.ts" />

// Repair jobs: kit that's broken, what's wrong with it and who's fixing it.
// One repair is for one item: some of its units (serialised) or a quantity
// of it (bulk). While a repair is open the kit is out of service, using the
// same fields availability already reads (lib/availabilityData.js):
//
//   serialised  each unit's status is "repair" (not "active", so not stock)
//   bulk        the quantity is added to the item's outOfServiceQty
//
// Closing it puts the kit back (fixed) or retires it (written off): units
// become "retired", bulk stock goes down. lib/repairs.js does all of this,
// so repairs are changed only through routes_repairs.pb.js; members can
// read them.
//
// status: open (reported), in_progress (being repaired), completed (fixed,
// back in service), written_off.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const items = app.findCollectionByNameOrId("items");
    const serials = app.findCollectionByNameOrId("serials");
    const users = app.findCollectionByNameOrId("users");
    const repairs = new Collection({
      type: "base",
      name: "repairs",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "number", name: "number", onlyInt: true, min: 0 },
        { type: "relation", name: "item", required: true, collectionId: items.id, maxSelect: 1 },
        { type: "relation", name: "serials", collectionId: serials.id, maxSelect: 999 },
        { type: "number", name: "quantity", onlyInt: true, min: 0 },
        { type: "select", name: "status", required: true, values: ["open", "in_progress", "completed", "written_off"], maxSelect: 1 },
        { type: "text", name: "fault", required: true, max: 2000 },
        { type: "text", name: "repairer", max: 200 },
        { type: "number", name: "cost", min: 0 },
        { type: "date", name: "dueAt" },
        { type: "date", name: "closedAt" },
        { type: "text", name: "notes", max: 5000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_repairs_org_number ON repairs (org, number)",
        "CREATE INDEX idx_repairs_item ON repairs (item)",
        "CREATE INDEX idx_repairs_status ON repairs (org, status)",
      ],
    });
    app.save(repairs);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("repairs"));
  },
);
