/// <reference path="../pb_data/types.d.ts" />
// Crew rostering's rules (lib/crew.js, migration 0041). Same
// require()-inside-the-handler rule as the other hook files.

onRecordValidate((e) => {
  const { validateCrew } = require(`${__hooks}/lib/crew.js`);
  validateCrew(e.app, e.record);
  e.next();
}, "job_crew");

onRecordValidate((e) => {
  const { validateNeed } = require(`${__hooks}/lib/crew.js`);
  validateNeed(e.app, e.record);
  e.next();
}, "crew_needs");

onRecordValidate((e) => {
  const { validatePerson } = require(`${__hooks}/lib/crew.js`);
  validatePerson(e.app, e.record);
  e.next();
}, "crew_people");

onRecordDelete((e) => {
  const { guardPersonDelete } = require(`${__hooks}/lib/crew.js`);
  guardPersonDelete(e.app, e.record);
  e.next();
}, "crew_people");

// A schedule item's crew needs keep to its times.
onRecordAfterUpdateSuccess((e) => {
  const { syncNeedTimes } = require(`${__hooks}/lib/crew.js`);
  syncNeedTimes(e.app, e.record);
  e.next();
}, "job_periods");

// Every member can be rostered, under their own name.
onRecordAfterCreateSuccess((e) => {
  const { ensurePerson } = require(`${__hooks}/lib/crew.js`);
  ensurePerson(e.app, e.record.getString("org"), e.record.getString("user"));
  e.next();
}, "memberships");

onRecordAfterDeleteSuccess((e) => {
  const { leavePerson } = require(`${__hooks}/lib/crew.js`);
  leavePerson(e.app, e.record.getString("org"), e.record.getString("user"));
  e.next();
}, "memberships");

onRecordAfterUpdateSuccess((e) => {
  const { renamePeople } = require(`${__hooks}/lib/crew.js`);
  if (e.record.getString("name") !== e.record.original().getString("name")) renamePeople(e.app, e.record);
  e.next();
}, "users");

routerAdd(
  "POST",
  "/api/jobs/{id}/crew-needs",
  (e) => {
    const { requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireFeature } = require(`${__hooks}/lib/features.js`);
    const { addCrewNeeds } = require(`${__hooks}/lib/crew.js`);
    const job = requireJob($app, e.request.pathValue("id"));
    const ctx = requireRecordOrg(e, job, "jobs.edit");
    requireFeature(ctx.org, "crew");
    const body = e.requestInfo().body || {};
    return e.json(200, addCrewNeeds($app, ctx.orgId, job.id, body.needs));
  },
  $apis.requireAuth("users"),
);

// Settings → Crew roles.
routerAdd(
  "PUT",
  "/api/crew-roles",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireFeature } = require(`${__hooks}/lib/features.js`);
    const { saveCrewRoles } = require(`${__hooks}/lib/crew.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    requireFeature(ctx.org, "crew");
    const saved = saveCrewRoles($app, ctx.orgId, (e.requestInfo().body || {}).roles);
    logEvent(ctx.orgId, "crew_roles", whoName(e.auth), { names: saved.map((r) => r.getString("name")) });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);
