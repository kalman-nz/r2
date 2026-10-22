/// <reference path="../pb_data/types.d.ts" />
// Model hooks: they run on every save of these collections, whether it came
// through the REST API, an import or one of the custom routes. The rules
// themselves live in lib/validation.js. Same require()-inside-the-handler
// rule as the route files (see routes_labels.pb.js).

onRecordValidate((e) => {
  const { validateItem } = require(`${__hooks}/lib/validation.js`);
  validateItem(e.app, e.record);
  e.next();
}, "items");

onRecordValidate((e) => {
  const { validateSerial } = require(`${__hooks}/lib/validation.js`);
  validateSerial(e.app, e.record);
  e.next();
}, "serials");

onRecordValidate((e) => {
  const { validateComponent } = require(`${__hooks}/lib/validation.js`);
  validateComponent(e.app, e.record);
  e.next();
}, "item_components");

onRecordValidate((e) => {
  const { validateCategory } = require(`${__hooks}/lib/validation.js`);
  validateCategory(e.app, e.record);
  e.next();
}, "categories");

onRecordValidate((e) => {
  const { validateJob } = require(`${__hooks}/lib/validation.js`);
  const { syncJobStatus } = require(`${__hooks}/lib/jobStatuses.js`);
  const { checkUntracked } = require(`${__hooks}/lib/tracking.js`);
  syncJobStatus(e.app, e.record);
  validateJob(e.app, e.record);
  checkUntracked(e.app, e.record);
  e.next();
}, "jobs");

onRecordValidate((e) => {
  const { validateMembership } = require(`${__hooks}/lib/validation.js`);
  validateMembership(e.app, e.record);
  e.next();
}, "memberships");

onRecordValidate((e) => {
  const { validateRole } = require(`${__hooks}/lib/validation.js`);
  validateRole(e.record);
  e.next();
}, "roles");

onRecordValidate((e) => {
  const { validateCustomField } = require(`${__hooks}/lib/validation.js`);
  validateCustomField(e.app, e.record);
  e.next();
}, "custom_fields");

onRecordValidate((e) => {
  const { validateInvitation } = require(`${__hooks}/lib/validation.js`);
  validateInvitation(e.app, e.record);
  e.next();
}, "invitations");

// Items and units saved without a code or barcode get one (lib/codes.js):
// before e.next(), so validation sees them. Runs for imports too.
onRecordCreate((e) => {
  const { newBarcode, nextItemCode } = require(`${__hooks}/lib/codes.js`);
  const org = e.record.getString("org");
  if (org && !e.record.getString("code").trim()) e.record.set("code", nextItemCode(e.app, org));
  if (org && !e.record.getString("barcode").trim()) e.record.set("barcode", newBarcode(e.app, org));
  e.next();
}, "items");

onRecordCreate((e) => {
  const { newBarcode } = require(`${__hooks}/lib/codes.js`);
  const org = e.record.getString("org");
  if (org && !e.record.getString("barcode").trim()) e.record.set("barcode", newBarcode(e.app, org));
  e.next();
}, "serials");

// Each organisation's job numbers count up from 1001 and are never reused.
// The unique (org, number) index is the backstop if two jobs are created at
// the same instant.
onRecordCreate((e) => {
  if (!(e.record.getInt("number") > 0) && e.record.getString("org")) {
    const rows = arrayOf(new DynamicModel({ n: 0 }));
    e.app
      .db()
      .newQuery("SELECT COALESCE(MAX(number), 1000) AS n FROM jobs WHERE org = {:org}")
      .bind({ org: e.record.getString("org") })
      .all(rows);
    e.record.set("number", rows[0].n + 1);
  }
  e.next();
}, "jobs");

onRecordCreateRequest((e) => {
  if (e.auth) e.record.set("createdBy", e.auth.id);
  e.next();
}, "jobs");

onRecordDelete((e) => {
  const { guardReferenced } = require(`${__hooks}/lib/validation.js`);
  guardReferenced(e.app, "job_lines", "item = {:id}", e.record.id, "item");
  // Scans keep a project's history too, even once its lines have changed.
  if (e.app.findRecordsByFilter("scans", "item = {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This item has been scanned on a project — archive it instead");
  }
  if (e.app.findRecordsByFilter("repairs", "item = {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This item has repairs on record — archive it instead");
  }
  if (e.app.findRecordsByFilter("maintenance_jobs", "item = {:id} && status = 'done'", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This item has maintenance on record — archive it instead");
  }
  e.next();
}, "items");

// A line's subproject has to be part of its own project.
onRecordValidate((e) => {
  const { sameSubproject } = require(`${__hooks}/lib/validation.js`);
  if (e.record.getString("org")) sameSubproject(e.app, e.record);
  e.next();
}, "job_lines");

onRecordValidate((e) => {
  e.record.set("name", e.record.getString("name").trim());
  if (!e.record.getString("name")) throw new BadRequestError("Give the subproject a name");
  const { sameOrgJob } = require(`${__hooks}/lib/validation.js`);
  sameOrgJob(e.app, e.record);
  e.next();
}, "subprojects");

// A subproject with equipment on it can't just disappear: its lines would
// silently change dates and price. Only on requests, so deleting the whole
// project (which takes its subprojects and lines with it) still works.
onRecordDeleteRequest((e) => {
  if (e.app.findRecordsByFilter("job_lines", "subproject = {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("Move or remove this subproject's equipment first");
  }
  e.next();
}, "subprojects");

// A unit's scans, repairs and maintenance are its history: keep it,
// retired, instead.
onRecordDelete((e) => {
  if (e.app.findRecordsByFilter("scans", "serial = {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This unit has been scanned on a project — mark it retired instead");
  }
  if (e.app.findRecordsByFilter("repairs", "serials.id ?= {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This unit has repairs on record — mark it retired instead");
  }
  if (e.app.findRecordsByFilter("maintenance_jobs", "serial = {:id} && status = 'done'", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("This unit has maintenance on record — mark it retired instead");
  }
  e.next();
}, "serials");

onRecordDelete((e) => {
  const { guardReferenced } = require(`${__hooks}/lib/validation.js`);
  guardReferenced(e.app, "jobs", "client = {:id}", e.record.id, "contact");
  e.next();
}, "contacts");

onRecordDelete((e) => {
  const { guardReferenced } = require(`${__hooks}/lib/validation.js`);
  guardReferenced(e.app, "jobs", "venue = {:id}", e.record.id, "location");
  e.next();
}, "venues");

onRecordValidate((e) => {
  const { validateCrew } = require(`${__hooks}/lib/validation.js`);
  validateCrew(e.app, e.record);
  e.next();
}, "job_crew");
