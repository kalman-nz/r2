/// <reference path="../pb_data/types.d.ts" />
// Keeps maintenance plans' scheduled jobs in step with the kit they cover
// (lib/maintenance.js): new units get theirs, lost and retired ones lose
// theirs, archived items too, and changing a unit's "Next test & tag" by
// hand moves its test. New organisations get their repair statuses here
// too. Same require()-inside-the-handler rule as the other hook files.

onRecordAfterCreateSuccess((e) => {
  const { syncAsset } = require(`${__hooks}/lib/maintenance.js`);
  if (e.record.getString("org")) syncAsset(e.app, e.record.getString("item"), e.record.id);
  e.next();
}, "serials");

// Status changes come from the status route, repairs and imports as well
// as the API, so this is the model hook.
onRecordUpdate((e) => {
  const before = e.record.original().getString("status");
  e.next();
  if (e.record.getString("org") && e.record.getString("status") !== before) {
    const { syncAsset } = require(`${__hooks}/lib/maintenance.js`);
    syncAsset(e.app, e.record.getString("item"), e.record.id);
  }
}, "serials");

// Only someone editing the unit: the plans set this date themselves.
onRecordUpdateRequest((e) => {
  const before = e.record.original().getString("nextInspection");
  e.next();
  if (e.record.getString("nextInspection") !== before) {
    const { moveTestTo } = require(`${__hooks}/lib/maintenance.js`);
    moveTestTo(e.app, e.record);
  }
}, "serials");

onRecordUpdate((e) => {
  const before = e.record.original();
  const changed = ["archived", "kind", "tracking"].some((f) => String(before.get(f)) !== String(e.record.get(f)));
  e.next();
  if (changed && e.record.getString("org")) {
    const { plansCovering, syncPlan } = require(`${__hooks}/lib/maintenance.js`);
    for (const plan of plansCovering(e.app, e.record.id)) syncPlan(e.app, plan);
  }
}, "items");

// Every organisation starts with the default repair statuses, however it's
// made (first-run setup, the admin panel, a script).
onRecordAfterCreateSuccess((e) => {
  const { createDefaultStatuses } = require(`${__hooks}/lib/repairs.js`);
  createDefaultStatuses(e.app, e.record.id);
  e.next();
}, "organisations");
