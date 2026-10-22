/// <reference path="../pb_data/types.d.ts" />

// Repair statuses become each organisation's own (Settings → Repair
// statuses): a name, a colour, an order, and a stage that decides what
// happens to the kit (lib/repairs.js):
//
//   open          out of service while the repair's in it
//   repaired      ends it: back in service
//   unrepairable  ends it: units retired, bulk stock reduced
//
// One open status is the default for new repairs. Every organisation
// starts with Backlog, To repair (the default), In repair, Repaired and
// Unrepairable; repairs move over from 0028's fixed statuses: open → To
// repair, in_progress → In repair, completed → Repaired, written_off →
// Unrepairable. Changed only through PUT /api/repair-statuses; members can
// read them.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const DEFAULTS = [
  { key: "backlog", name: "Backlog", stage: "open", colour: "gray" },
  { key: "to_repair", name: "To repair", stage: "open", colour: "amber", isDefault: true },
  { key: "in_repair", name: "In repair", stage: "open", colour: "blue" },
  { key: "repaired", name: "Repaired", stage: "repaired", colour: "green" },
  { key: "unrepairable", name: "Unrepairable", stage: "unrepairable", colour: "red" },
];
const OLD = { open: "to_repair", in_progress: "in_repair", completed: "repaired", written_off: "unrepairable" };

function withoutIndex(collection, name) {
  const indexes = [];
  for (const index of collection.indexes) if (index.indexOf(name) === -1) indexes.push(index);
  return indexes;
}

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const statuses = new Collection({
      type: "base",
      name: "repair_statuses",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 60 },
        { type: "select", name: "stage", required: true, values: ["open", "repaired", "unrepairable"], maxSelect: 1 },
        { type: "select", name: "colour", values: ["gray", "amber", "blue", "violet", "green", "red"], maxSelect: 1 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "bool", name: "isDefault" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_repair_statuses_org ON repair_statuses (org, sortOrder)"],
    });
    app.save(statuses);

    // The fixed status column makes way for a relation to the new list.
    const repairs = app.findCollectionByNameOrId("repairs");
    repairs.indexes = withoutIndex(repairs, "idx_repairs_status");
    const old = repairs.fields.getByName("status");
    old.name = "legacyStatus";
    old.required = false;
    app.save(repairs);
    repairs.fields.add(new RelationField({ name: "status", collectionId: statuses.id, maxSelect: 1 }));
    const indexes = withoutIndex(repairs, "idx_repairs_status");
    indexes.push("CREATE INDEX idx_repairs_status ON repairs (org, status)");
    repairs.indexes = indexes;
    app.save(repairs);

    for (const org of app.findAllRecords("organisations")) {
      const ids = {};
      DEFAULTS.forEach((d, i) => {
        const record = new Record(statuses, { org: org.id, name: d.name, stage: d.stage, colour: d.colour, sortOrder: (i + 1) * 10, isDefault: !!d.isDefault });
        app.save(record);
        ids[d.key] = record.id;
      });
      for (const from in OLD) {
        app
          .db()
          .newQuery("UPDATE repairs SET status = {:to} WHERE org = {:org} AND legacyStatus = {:from}")
          .bind({ to: ids[OLD[from]], org: org.id, from: from })
          .execute();
      }
    }

    repairs.fields.removeByName("legacyStatus");
    app.save(repairs);
  },
  (app) => {
    const repairs = app.findCollectionByNameOrId("repairs");
    repairs.fields.add(new SelectField({ name: "legacyStatus", values: ["open", "in_progress", "completed", "written_off"], maxSelect: 1 }));
    app.save(repairs);
    // Stages back to the fixed statuses (open ones all become "open").
    const back = { open: "open", repaired: "completed", unrepairable: "written_off" };
    for (const stage in back) {
      app
        .db()
        .newQuery("UPDATE repairs SET legacyStatus = {:value} WHERE status IN (SELECT id FROM repair_statuses WHERE stage = {:stage})")
        .bind({ value: back[stage], stage: stage })
        .execute();
    }
    repairs.indexes = withoutIndex(repairs, "idx_repairs_status");
    repairs.fields.removeByName("status");
    app.save(repairs);
    const legacy = repairs.fields.getByName("legacyStatus");
    legacy.name = "status";
    legacy.required = true;
    const indexes = withoutIndex(repairs, "idx_repairs_status");
    indexes.push("CREATE INDEX idx_repairs_status ON repairs (org, status)");
    repairs.indexes = indexes;
    app.save(repairs);
    app.delete(app.findCollectionByNameOrId("repair_statuses"));
  },
);
