/// <reference path="../pb_data/types.d.ts" />
// Settings > Import: spreadsheets (lib/imports.js importCsv). Rentman comes
// in through live sync instead (Settings → Integrations).
// body: { kind: "items" | "contacts", rows: [...], dryRun?: boolean }
routerAdd(
  "POST",
  "/api/import/csv",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { importCsv } = require(`${__hooks}/lib/imports.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "import.csv");
    const body = e.requestInfo().body || {};
    if (body.kind === "contacts") require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "projects");
    const result = importCsv(ctx.orgId, body.kind, body.rows, body.dryRun === true, whoName(e.auth));
    if (result.committed) logEvent(ctx.orgId, "import_csv", whoName(e.auth), { kind: body.kind, counts: result.counts });
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/import/runs",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e, "import.csv");
    return e.json(200, $app.findRecordsByFilter("import_runs", "org = {:org}", "-created", 20, 0, { org: ctx.orgId }));
  },
  $apis.requireAuth("users"),
);
