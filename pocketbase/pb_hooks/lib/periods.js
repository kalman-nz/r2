// A project's schedule (job_periods, migration 0025) and the job date fields
// derived from it. summarise() and chargedDays() are pure, so
// pocketbase/tests can require them under Node; the rest is the PocketBase
// side.
const { toMs, toPbDate } = require("./time.js");
const { chargeableDays } = require("./pricing.js");

// Must match PERIOD_KINDS in web/src/lib/statuses.ts. A project always keeps
// at least one usage and one billing period.
const KINDS = ["usage", "billing", "other"];
const REQUIRED = ["usage", "billing"];

function valid(periods) {
  return periods.filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.start < p.end);
}

function span(list) {
  return list.length === 0
    ? { start: NaN, end: NaN }
    : { start: Math.min(...list.map((p) => p.start)), end: Math.max(...list.map((p) => p.end)) };
}

// periods: [{ kind, start, end }] with start/end in ms. Returns the job's
// derived fields as ms (NaN when there's nothing to derive from), or null
// when there's no usage period, in which case the job keeps the window it
// has (its kit stays booked; the routes stop that happening).
function summarise(periods) {
  const all = valid(periods);
  const usage = all.filter((p) => p.kind === "usage");
  if (usage.length === 0) return null;
  const booked = span(usage);
  const project = span(all);
  const billing = span(all.filter((p) => p.kind === "billing"));
  return {
    prepAt: booked.start,
    returnAt: booked.end,
    startAt: project.start,
    endAt: project.end,
    billingStart: billing.start,
    billingEnd: billing.end,
  };
}

// Days charged: each billing period counted on its own and added up, so two
// show days with a rehearsal between them charge two days, not three.
// Overlapping billing periods are merged first so no time counts twice.
// null when there are no billing periods.
function chargedDays(periods) {
  const merged = mergedBilling(periods);
  if (merged === null) return null;
  return merged.reduce((sum, p) => sum + chargeableDays(p.start, p.end), 0);
}

// The billing periods in time order with overlaps merged, or null if none.
function mergedBilling(periods) {
  const billing = valid(periods)
    .filter((p) => p.kind === "billing")
    .sort((a, b) => a.start - b.start);
  if (billing.length === 0) return null;
  const merged = [];
  for (const p of billing) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else merged.push({ start: p.start, end: p.end });
  }
  return merged;
}

function chargedHours(periods) {
  const merged = mergedBilling(periods);
  if (merged === null) return null;
  const ms = merged.reduce((sum, p) => sum + (p.end - p.start), 0);
  return Math.max(1, Math.ceil(ms / 3600000 - 1e-9));
}

function periodsOf(app, jobId) {
  return app.findRecordsByFilter("job_periods", "job = {:job}", "start", 0, 0, { job: jobId });
}

// The job's periods as plain data. section: a subproject's id for just its
// periods, "" for the main project's, undefined for all of them.
function plainPeriods(app, jobId, section) {
  return periodsOf(app, jobId)
    .filter((p) => section === undefined || p.getString("subproject") === section)
    .map((p) => ({ kind: p.getString("kind"), start: toMs(p.getString("start")), end: toMs(p.getString("end")), section: p.getString("subproject") }));
}

// Sets fields from derived ms values, returning whether any changed.
function setDates(record, derived, fields) {
  let changed = false;
  for (const field of fields) {
    const value = Number.isFinite(derived[field]) ? toPbDate(derived[field]) : "";
    if (toMs(record.getString(field)) === toMs(value) || (!record.getString(field) && !value)) continue;
    record.set(field, value);
    changed = true;
  }
  return changed;
}

// Re-derives the job's date fields from its periods and saves the job if
// any changed, then each subproject's from its own. The job's booking and
// billing dates are the main project's; its start and end cover every
// period, subprojects' included. Ordinary saves, so validateJob still runs.
function syncJobDates(app, jobId) {
  let job;
  try {
    job = app.findRecordById("jobs", jobId);
  } catch (_) {
    return; // the job itself is being deleted
  }
  const all = plainPeriods(app, jobId);
  const derived = summarise(all.filter((p) => !p.section));
  if (derived) {
    const whole = span(valid(all));
    derived.startAt = whole.start;
    derived.endAt = whole.end;
    if (setDates(job, derived, Object.keys(derived))) app.save(job);
  }
  for (const sub of app.findRecordsByFilter("subprojects", "job = {:job}", "", 0, 0, { job: jobId })) {
    const own = summarise(all.filter((p) => p.section === sub.id));
    if (own && setDates(sub, own, ["prepAt", "returnAt", "billingStart", "billingEnd"])) app.save(sub);
  }
}

// A new project starts with a usage period over the dates it was created
// with (prepAt → returnAt) and a billing period over billingStart →
// billingEnd, or the same window when those weren't given.
function seedPeriods(app, job) {
  if (periodsOf(app, job.id).length > 0) return;
  const collection = app.findCollectionByNameOrId("job_periods");
  const add = (kind, name, start, end) =>
    app.save(new Record(collection, { org: job.getString("org"), job: job.id, kind: kind, name: name, start: start, end: end }));
  const billed = job.getString("billingStart") && job.getString("billingEnd");
  add("usage", "Equipment booked", job.getString("prepAt"), job.getString("returnAt"));
  add("billing", "Billed", billed ? job.getString("billingStart") : job.getString("prepAt"), billed ? job.getString("billingEnd") : job.getString("returnAt"));
}

// A new subproject's usage and billing periods. usage/billing: { start, end }.
function seedSubprojectPeriods(app, sub, usage, billing) {
  const collection = app.findCollectionByNameOrId("job_periods");
  const add = (kind, name, p) =>
    app.save(new Record(collection, { org: sub.getString("org"), job: sub.getString("job"), subproject: sub.id, kind: kind, name: name, start: p.start, end: p.end }));
  add("usage", "Equipment booked", usage);
  add("billing", "Billed", billing);
}

// Refuses a change that would leave the project, or one of its subprojects,
// without a usage or billing period. Called from the request hooks only, so
// deleting a whole project or subproject (which cascades to its periods)
// isn't caught by it. Moving a period to another subproject counts as
// removing it from where it was.
function guardRequired(app, period, newKind, newSection) {
  const kind = period.original().getString("kind") || period.getString("kind");
  const section = period.original().getString("subproject");
  const moving = newSection !== undefined && newSection !== section;
  if (REQUIRED.indexOf(kind) === -1 || (newKind === kind && !moving)) return;
  const others = periodsOf(app, period.getString("job")).filter(
    (p) => p.id !== period.id && p.getString("kind") === kind && p.getString("subproject") === section,
  );
  if (others.length === 0) {
    throw new BadRequestError(
      (section ? "A subproject" : "A project") + " needs at least one " + kind + " period. Add another before removing this one",
    );
  }
}

module.exports = {
  KINDS,
  REQUIRED,
  summarise,
  chargedDays,
  chargedHours,
  periodsOf,
  plainPeriods,
  syncJobDates,
  seedPeriods,
  seedSubprojectPeriods,
  guardRequired,
};
