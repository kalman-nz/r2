/// <reference path="../pb_data/types.d.ts" />
// The job page's API. Jobs themselves are created and edited through the
// PocketBase REST API (collection rules + records_validation.pb.js); lines
// and quotes go through these routes so kit expansion, price snapshots and
// quote numbering always happen server-side. See lib/jobs.js.
//
// Every route checks the person's permissions in the job's own organisation
// (lib/orgs.js, lib/permissions.js). Every write returns the job's fresh summary, so the page
// never has to work out prices or availability itself.

routerAdd(
  "GET",
  "/api/jobs/{id}/summary",
  (e) => {
    const { buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireRecordOrg(e, requireJob($app, e.request.pathValue("id")));
    // Without prices.view it's the kit list and packing state, not money.
    return e.json(200, buildSummary($app, e.request.pathValue("id"), summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/jobs/{id}/lines",
  (e) => {
    const { addLine, buildSummary, requireJob, checkPriceFields } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const id = e.request.pathValue("id");
    const ctx = requireRecordOrg(e, requireJob($app, id), "jobs.lines");
    const body = e.requestInfo().body || {};
    checkPriceFields(ctx, body);
    addLine(id, body);
    return e.json(200, buildSummary($app, id, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

// The project's equipment headings: add, rename, remove, reorder
// (lib/jobs.js headingAction). Same permission as changing its lines.
routerAdd(
  "POST",
  "/api/jobs/{id}/headings",
  (e) => {
    const { headingAction, buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const id = e.request.pathValue("id");
    const ctx = requireRecordOrg(e, requireJob($app, id), "jobs.lines");
    headingAction(id, e.requestInfo().body || {});
    return e.json(200, buildSummary($app, id, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

// A subproject: part of the project with its own schedule (lib/jobs.js
// addSubproject). Renaming and deleting go through the collection.
routerAdd(
  "POST",
  "/api/jobs/{id}/subprojects",
  (e) => {
    const { addSubproject, buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const id = e.request.pathValue("id");
    const ctx = requireRecordOrg(e, requireJob($app, id), "jobs.edit");
    addSubproject(id, e.requestInfo().body || {});
    return e.json(200, buildSummary($app, id, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/job-lines/{id}",
  (e) => {
    const { updateLine, buildSummary, checkPriceFields } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const line = findOrNull($app, "job_lines", e.request.pathValue("id"));
    if (!line) throw new NotFoundError("Line not found");
    const ctx = requireRecordOrg(e, line, "jobs.lines");
    const body = e.requestInfo().body || {};
    checkPriceFields(ctx, body);
    const jobId = updateLine(line.id, body);
    return e.json(200, buildSummary($app, jobId, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/job-lines/{id}",
  (e) => {
    const { deleteLine, buildSummary } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const line = findOrNull($app, "job_lines", e.request.pathValue("id"));
    if (!line) throw new NotFoundError("Line not found");
    const ctx = requireRecordOrg(e, line, "jobs.lines");
    const jobId = deleteLine(line.id);
    return e.json(200, buildSummary($app, jobId, summaryAccess(ctx)));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/jobs/{id}/quotes",
  (e) => {
    const { issueQuote, buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg, summaryAccess } = require(`${__hooks}/lib/orgs.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const id = e.request.pathValue("id");
    const ctx = requireRecordOrg(e, requireJob($app, id), "quotes.issue");
    const quote = issueQuote(id, e.auth);
    logEvent(ctx.orgId, "quote_issued", whoName(e.auth), { job: id, quote: quote.id, version: quote.getInt("version") });
    return e.json(200, { quoteId: quote.id, summary: buildSummary($app, id, summaryAccess(ctx)) });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/quotes/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const quote = findOrNull($app, "quotes", e.request.pathValue("id"));
    if (!quote) throw new NotFoundError("Quote not found");
    requireRecordOrg(e, quote, "quotes.view");
    return e.json(200, quote);
  },
  $apis.requireAuth("users"),
);

// Recording the client's answer. The snapshot itself never changes.
routerAdd(
  "PATCH",
  "/api/quotes/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const quote = findOrNull($app, "quotes", e.request.pathValue("id"));
    if (!quote) throw new NotFoundError("Quote not found");
    const ctx = requireRecordOrg(e, quote, "quotes.status");
    const status = (e.requestInfo().body || {}).status;
    if (["issued", "accepted", "declined", "void"].indexOf(status) === -1) throw new BadRequestError("Invalid quote status");
    quote.set("status", status);
    $app.save(quote);
    logEvent(ctx.orgId, "quote_status", whoName(e.auth), { job: quote.getString("job"), quote: quote.id, status: status });
    return e.json(200, quote);
  },
  $apis.requireAuth("users"),
);

// The organisation's project statuses, in order (lib/jobStatuses.js
// saveJobStatuses): { statuses: [{ id?, name, stage, colour, isDefault }],
// moves: { removedId: keptId } }.
routerAdd(
  "PUT",
  "/api/job-statuses",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { saveJobStatuses } = require(`${__hooks}/lib/jobStatuses.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    const body = e.requestInfo().body || {};
    const saved = saveJobStatuses($app, ctx.orgId, body.statuses, body.moves);
    logEvent(ctx.orgId, "job_statuses", whoName(e.auth), { names: saved.map((s) => s.getString("name")) });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);
