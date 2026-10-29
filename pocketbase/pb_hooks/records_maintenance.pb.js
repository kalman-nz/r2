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

// Every organisation starts with the default project and repair statuses,
// crew roles, dashboards and project documents, however it's made (first-run setup,
// the admin panel, a script).
onRecordAfterCreateSuccess((e) => {
  const { createDefaultStatuses } = require(`${__hooks}/lib/repairs.js`);
  const { createDefaultJobStatuses } = require(`${__hooks}/lib/jobStatuses.js`);
  const { createDefaultDashboards } = require(`${__hooks}/lib/views.js`);
  const { createDefaultSteps } = require(`${__hooks}/lib/tracking.js`);
  const { createDefaultDocuments } = require(`${__hooks}/lib/documents.js`);
  const { createDefaultCrewRoles } = require(`${__hooks}/lib/crew.js`);
  createDefaultJobStatuses(e.app, e.record.id);
  createDefaultCrewRoles(e.app, e.record.id);
  // After the statuses: its steps move projects to them.
  createDefaultSteps(e.app, e.record.id);
  createDefaultStatuses(e.app, e.record.id);
  createDefaultDashboards(e.app, e.record.id);
  createDefaultDocuments(e.app, e.record.id);
  e.next();
}, "organisations");
