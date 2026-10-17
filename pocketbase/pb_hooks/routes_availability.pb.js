/// <reference path="../pb_data/types.d.ts" />
// Availability questions, answered by lib/availabilityData.js (database) +
// lib/availability.js (the engine). Any member can ask: a tech checking
// whether a spare desk is free tomorrow is a normal question.

// Free counts for every item and kit over one window. The job page's item
// picker calls this with the job's own dates and excludeJob = the job, so
// lines already on it don't count against it.
// ?start=…&end=… (ISO or PocketBase datetimes) [&excludeJob=id]
routerAdd(
  "GET",
  "/api/availability",
  (e) => {
    const { availabilityForWindow } = require(`${__hooks}/lib/availabilityData.js`);
    const { pricingSettings } = require(`${__hooks}/lib/settings.js`);
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toMs } = require(`${__hooks}/lib/time.js`);
    const ctx = requireOrg(e);
    const query = e.requestInfo().query;
    const start = toMs(query.start);
    const end = toMs(query.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end)) {
      throw new BadRequestError("start and end must be valid dates, start before end");
    }
    const result = availabilityForWindow($app, ctx.orgId, start, end, query.excludeJob || "", pricingSettings(ctx.orgId).bufferHours);
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);

// Free count over time for one item (or kit) plus the jobs holding it.
// ?from=…&to=… — capped at a year so a typo can't ask for a century.
routerAdd(
  "GET",
  "/api/items/{id}/availability",
  (e) => {
    const { itemTimeline } = require(`${__hooks}/lib/availabilityData.js`);
    const { pricingSettings } = require(`${__hooks}/lib/settings.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toMs, toPbDate } = require(`${__hooks}/lib/time.js`);
    const item = findOrNull($app, "items", e.request.pathValue("id"));
    if (!item) throw new NotFoundError("Item not found");
    requireRecordOrg(e, item);
    const query = e.requestInfo().query;
    const from = toMs(query.from);
    const to = toMs(query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) {
      throw new BadRequestError("from and to must be valid dates, from before to");
    }
    if (to - from > 366 * 86400000) throw new BadRequestError("Ask for a year or less at a time");

    const timeline = itemTimeline($app, item, from, to, pricingSettings(item.getString("org")).bufferHours);

    // Name the jobs behind the bookings (one job can book an item on
    // several lines; merge those).
    const byJob = {};
    for (const b of timeline.bookings) {
      if (!byJob[b.jobId]) byJob[b.jobId] = { jobId: b.jobId, status: b.status, start: b.start, end: b.end, qty: 0, items: {} };
      byJob[b.jobId].qty += b.qty;
      byJob[b.jobId].items[b.itemId] = true;
    }
    const jobs = $app.findRecordsByIds("jobs", Object.keys(byJob));
    const bookings = [];
    for (const job of jobs) {
      if (!job) continue;
      const b = byJob[job.id];
      bookings.push({
        jobId: job.id,
        number: job.getInt("number"),
        name: job.getString("name"),
        status: b.status,
        prepAt: toPbDate(b.start),
        returnAt: toPbDate(b.end),
        // For a kit this is units of its components, so it's only shown for
        // plain items.
        quantity: item.getString("kind") === "kit" ? null : b.qty,
      });
    }
    bookings.sort((a, b) => a.prepAt.localeCompare(b.prepAt));

    return e.json(200, {
      stock: timeline.stock,
      segments: timeline.segments.map((s) => ({ start: toPbDate(s.start), end: toPbDate(s.end), free: s.free })),
      bookings: bookings,
    });
  },
  $apis.requireAuth("users"),
);
