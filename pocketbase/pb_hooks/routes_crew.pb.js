/// <reference path="../pb_data/types.d.ts" />
// Active assignment queries, unlike retained collection reads, stop having
// an effect when the owning organisation turns crew rostering off.
routerAdd(
  "GET",
  "/api/jobs/crew",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e);
    if (!ctx.features.crew) return e.json(200, []);
    const mine = e.request.url.query().get("mine") === "true";
    const records = $app.findRecordsByFilter(
      "job_crew",
      "org = {:org}" + (mine ? " && user = {:user}" : ""),
      "sortOrder,created", 0, 0, { org: ctx.orgId, user: e.auth.id },
    );
    $app.expandRecords(records, ["person", "job", "job.client", "job.venue", "need", "need.role", "need.period"], null);
    return e.json(200, records);
  },
  $apis.requireAuth("users"),
);
