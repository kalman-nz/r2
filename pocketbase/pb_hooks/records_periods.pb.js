/// <reference path="../pb_data/types.d.ts" />
// A project's schedule (job_periods) drives its date fields; see
// lib/periods.js and migration 0025. Same require()-inside-the-handler rule
// as the other hook files.

onRecordValidate((e) => {
  const { validatePeriod } = require(`${__hooks}/lib/validation.js`);
  validatePeriod(e.app, e.record);
  e.next();
}, "job_periods");

// Every project keeps at least one usage and one billing period.
onRecordUpdateRequest((e) => {
  const { guardRequired } = require(`${__hooks}/lib/periods.js`);
  guardRequired(e.app, e.record, e.record.getString("kind"), e.record.getString("subproject"));
  e.next();
}, "job_periods");

onRecordDeleteRequest((e) => {
  const { guardRequired } = require(`${__hooks}/lib/periods.js`);
  guardRequired(e.app, e.record, null);
  e.next();
}, "job_periods");

onRecordAfterCreateSuccess((e) => {
  const { syncJobDates } = require(`${__hooks}/lib/periods.js`);
  syncJobDates(e.app, e.record.getString("job"));
  e.next();
}, "job_periods");

onRecordAfterUpdateSuccess((e) => {
  const { syncJobDates } = require(`${__hooks}/lib/periods.js`);
  syncJobDates(e.app, e.record.getString("job"));
  e.next();
}, "job_periods");

onRecordAfterDeleteSuccess((e) => {
  const { syncJobDates } = require(`${__hooks}/lib/periods.js`);
  syncJobDates(e.app, e.record.getString("job"));
  e.next();
}, "job_periods");

// New projects (from the app, the API or an import) get their usage and
// billing periods from the dates they were created with.
onRecordAfterCreateSuccess((e) => {
  const { seedPeriods } = require(`${__hooks}/lib/periods.js`);
  if (e.record.getString("org")) seedPeriods(e.app, e.record);
  e.next();
}, "jobs");

// After creation a project's dates come from its schedule, so they can't be
// set directly over the API.
onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body || {};
  for (const field of ["prepAt", "returnAt", "startAt", "endAt", "billingStart", "billingEnd"]) {
    if (field in body) throw new BadRequestError("A project's dates come from its schedule: change the periods instead");
  }
  e.next();
}, "jobs");
