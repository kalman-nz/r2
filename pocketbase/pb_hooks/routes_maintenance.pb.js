/// <reference path="../pb_data/types.d.ts" />
// Maintenance (lib/maintenance.js): repeating plans need maintenance.plans;
// scheduling, recording and the files on jobs need units.flag, like
// repairs. Anyone in the organisation can see plans and jobs through the
// collections.

routerAdd(
  "POST",
  "/api/maintenance/plans",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { savePlan } = require(`${__hooks}/lib/maintenance.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "maintenance.plans");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    const plan = savePlan($app, ctx.orgId, null, e.requestInfo().body || {}, e.auth);
    logEvent(ctx.orgId, "maintenance_plan", whoName(e.auth), { plan: plan.id, name: plan.getString("name"), action: "created" });
    return e.json(200, plan);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/maintenance/plans/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { savePlan } = require(`${__hooks}/lib/maintenance.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const plan = findOrNull($app, "maintenance_plans", e.request.pathValue("id"));
    if (!plan) throw new NotFoundError("Plan not found");
    const ctx = requireRecordOrg(e, plan, "maintenance.plans");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    const saved = savePlan($app, ctx.orgId, plan, e.requestInfo().body || {}, e.auth);
    logEvent(ctx.orgId, "maintenance_plan", whoName(e.auth), { plan: plan.id, name: saved.getString("name"), action: "changed" });
    return e.json(200, saved);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/maintenance/plans/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { deletePlan } = require(`${__hooks}/lib/maintenance.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const plan = findOrNull($app, "maintenance_plans", e.request.pathValue("id"));
    if (!plan) throw new NotFoundError("Plan not found");
    const ctx = requireRecordOrg(e, plan, "maintenance.plans");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    deletePlan($app, plan);
    logEvent(ctx.orgId, "maintenance_plan", whoName(e.auth), { plan: plan.id, name: plan.getString("name"), action: "deleted" });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// One-off work: { name, kind, item?, serials?, dueOn, notes }.
routerAdd(
  "POST",
  "/api/maintenance/jobs",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { scheduleJobs } = require(`${__hooks}/lib/maintenance.js`);
    const ctx = requireOrg(e, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    return e.json(200, scheduleJobs($app, ctx.orgId, e.requestInfo().body || {}, e.auth));
  },
  $apis.requireAuth("users"),
);

// Passing a batch in one go (an inspection day): { ids, doneOn, doneBy }.
// Fails are recorded one at a time, with what's wrong. Returns how many
// were recorded and what couldn't be, by id.
routerAdd(
  "POST",
  "/api/maintenance/jobs/pass",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { completeJob } = require(`${__hooks}/lib/maintenance.js`);
    const { findOrNull, errorMessage } = require(`${__hooks}/lib/records.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    const body = e.requestInfo().body || {};
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (ids.length === 0) throw new BadRequestError("Pick what passed");
    let done = 0;
    const failed = {};
    for (const id of ids) {
      const job = findOrNull($app, "maintenance_jobs", id);
      if (!job || job.getString("org") !== ctx.orgId) {
        failed[id] = "Not found";
        continue;
      }
      try {
        completeJob($app, job, { result: "pass", doneOn: body.doneOn, doneBy: body.doneBy }, e.auth);
        done++;
      } catch (err) {
        failed[id] = errorMessage(err);
      }
    }
    if (done > 0) logEvent(ctx.orgId, "maintenance_passed", whoName(e.auth), { count: done });
    return e.json(200, { done: done, failed: failed });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/maintenance/jobs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { updateJob } = require(`${__hooks}/lib/maintenance.js`);
    const job = findOrNull($app, "maintenance_jobs", e.request.pathValue("id"));
    if (!job) throw new NotFoundError("Job not found");
    const ctx = requireRecordOrg(e, job, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    return e.json(200, updateJob($app, job, e.requestInfo().body || {}));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/maintenance/jobs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { deleteJob } = require(`${__hooks}/lib/maintenance.js`);
    const job = findOrNull($app, "maintenance_jobs", e.request.pathValue("id"));
    if (!job) throw new NotFoundError("Job not found");
    const ctx = requireRecordOrg(e, job, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    deleteJob($app, job);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// { result: "pass" | "fail", doneOn, doneBy, notes, cost, failedQty,
// repair: { fault, repairer } }: see completeJob.
routerAdd(
  "POST",
  "/api/maintenance/jobs/{id}/done",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { completeJob } = require(`${__hooks}/lib/maintenance.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const job = findOrNull($app, "maintenance_jobs", e.request.pathValue("id"));
    if (!job) throw new NotFoundError("Job not found");
    const ctx = requireRecordOrg(e, job, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    const result = completeJob($app, job, e.requestInfo().body || {}, e.auth);
    logEvent(ctx.orgId, "maintenance_done", whoName(e.auth), {
      job: job.id,
      name: job.getString("name"),
      result: result.job.getString("result"),
      repair: result.repair ? result.repair.id : "",
      repairNumber: result.repair ? result.repair.getInt("number") : 0,
    });
    return e.json(200, { job: result.job, repair: result.repair });
  },
  $apis.requireAuth("users"),
);

// Files on a job: an inspection certificate, a test report, photos. Like a
// repair's (routes_repairs.pb.js).
routerAdd(
  "POST",
  "/api/maintenance/jobs/{id}/files",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { addFiles, uploadedFiles } = require(`${__hooks}/lib/files.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const job = findOrNull($app, "maintenance_jobs", e.request.pathValue("id"));
    if (!job) throw new NotFoundError("Job not found");
    const ctx = requireRecordOrg(e, job, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    return e.json(200, addFiles($app, "maintenance_jobs", job.id, uploadedFiles(e), whoName(e.auth)));
  },
  $apis.requireAuth("users"),
  $apis.bodyLimit(26 * 1024 * 1024),
);

routerAdd(
  "DELETE",
  "/api/maintenance/jobs/{id}/files/{name}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { removeFile } = require(`${__hooks}/lib/files.js`);
    const job = findOrNull($app, "maintenance_jobs", e.request.pathValue("id"));
    if (!job) throw new NotFoundError("Job not found");
    const ctx = requireRecordOrg(e, job, "units.flag");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "maintenance");
    return e.json(200, removeFile($app, "maintenance_jobs", job.id, e.request.pathValue("name")).record);
  },
  $apis.requireAuth("users"),
);
