/// <reference path="../pb_data/types.d.ts" />
// Settings > Import. See lib/imports.js for what each import does.
// POST /api/import/rentman body: { step, runId?, cursor?, final? } (see
// runRentmanStep); returns { runId, counts, errors, next }.
// Admins only: it writes across the whole catalogue and walks every Rentman
// list endpoint, which can take a while on a big account. The token is the
// one saved in Settings > Import for this organisation, falling back to
// RENTMAN_API_TOKEN (for single-organisation self-hosted installs).
routerAdd(
  "POST",
  "/api/import/rentman",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { runRentmanStep } = require(`${__hooks}/lib/imports.js`);
    const { getSecret } = require(`${__hooks}/lib/settings.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "import.rentman");
    const token = getSecret(ctx.orgId, "rentmanApiToken") || $os.getenv("RENTMAN_API_TOKEN");
    const startedAt = Date.now();
    // Without a step it's the whole equipment import in one go, as before.
    const body = e.requestInfo().body || {};
    const result = runRentmanStep(ctx.orgId, token, whoName(e.auth), body.step ? body : { step: "equipment", final: true });
    if (!result.next && (body.final || !body.step)) {
      logEvent(ctx.orgId, "import_rentman", whoName(e.auth), { counts: result.counts, errors: result.errors.length });
    }
    return e.json(200, Object.assign({ tookMs: Date.now() - startedAt }, result));
  },
  $apis.requireAuth("users"),
);

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
    const ctx = requireOrg(e, ["import.csv", "import.rentman"]);
    return e.json(200, $app.findRecordsByFilter("import_runs", "org = {:org}", "-created", 20, 0, { org: ctx.orgId }));
  },
  $apis.requireAuth("users"),
);
