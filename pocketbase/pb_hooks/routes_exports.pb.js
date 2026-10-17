/// <reference path="../pb_data/types.d.ts" />
// Exports for accounting (the MVP's Xero integration is a CSV import file;
// a live Xero connection is v1). See lib/xero.js for the file itself.
//
// Each job is invoiced from its latest accepted quote, or failing that its
// latest issued one — the numbers the client actually saw.

// Jobs back (or due back) between ?from= and ?to= (YYYY-MM-DD, inclusive),
// with the quote each would be invoiced from and whether the job has
// changed since that quote was issued.
routerAdd(
  "GET",
  "/api/exports/xero/jobs",
  (e) => {
    const { buildSummary } = require(`${__hooks}/lib/jobs.js`);
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e, "export.xero");
    const query = e.requestInfo().query;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(query.from || "") || !datePattern.test(query.to || "")) {
      throw new BadRequestError("from and to must be dates like 2026-10-31");
    }
    const jobs = $app.findRecordsByFilter(
      "jobs",
      "org = {:org} && status != 'cancelled' && status != 'enquiry' && returnAt >= {:from} && returnAt <= {:to}",
      "returnAt",
      1000,
      0,
      { org: ctx.orgId, from: query.from + " 00:00:00.000Z", to: query.to + " 23:59:59.999Z" },
    );
    const clients = {};
    for (const c of $app.findRecordsByIds("contacts", jobs.map((j) => j.getString("client")).filter(Boolean))) {
      if (c) clients[c.id] = c.getString("name");
    }
    const result = jobs.map((job) => {
      const quotes = $app.findRecordsByFilter("quotes", "job = {:job} && (status = 'accepted' || status = 'issued')", "-version", 0, 0, {
        job: job.id,
      });
      const quote = quotes.find((q) => q.getString("status") === "accepted") || quotes[0] || null;
      let changed = false;
      if (quote) {
        const live = buildSummary($app, job.id, true).pricing.totals.exGst;
        changed = Math.abs(live - quote.getFloat("exGst")) > 0.005;
      }
      return {
        jobId: job.id,
        number: job.getInt("number"),
        name: job.getString("name"),
        status: job.getString("status"),
        client: clients[job.getString("client")] || "",
        returnAt: job.getString("returnAt"),
        quote: quote
          ? {
              id: quote.id,
              version: quote.getInt("version"),
              status: quote.getString("status"),
              exGst: quote.getFloat("exGst"),
              total: quote.getFloat("total"),
            }
          : null,
        changedSinceQuote: changed,
      };
    });
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);

// ?jobs=id,id,…&invoiceDate=YYYY-MM-DD (the browser's local "today"; the
// JSVM can't work out a local date itself). Due date = invoice date + the
// payment terms in Settings → Accounting.
routerAdd(
  "GET",
  "/api/exports/xero.csv",
  (e) => {
    const { buildXeroCsv } = require(`${__hooks}/lib/xero.js`);
    const { findOrNull, decodeJson } = require(`${__hooks}/lib/records.js`);
    const { publicSettings } = require(`${__hooks}/lib/settings.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e, "export.xero");
    const query = e.requestInfo().query;
    const ids = String(query.jobs || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) throw new BadRequestError("Pick at least one job");
    if (ids.length > 500) throw new BadRequestError("Export 500 jobs or fewer at a time");
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(query.invoiceDate || "");
    if (!m) throw new BadRequestError("invoiceDate must be a date like 2026-10-31");

    const settings = publicSettings(ctx.orgId);
    const invoiceDay = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const due = new Date(invoiceDay + (Number(settings.xeroDueDays) || 0) * 86400000);
    const invoiceDate = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
    const dueDate = { day: due.getUTCDate(), month: due.getUTCMonth() + 1, year: due.getUTCFullYear() };

    const invoices = [];
    const skipped = [];
    for (const id of ids) {
      const job = findOrNull($app, "jobs", id);
      if (!job || job.getString("org") !== ctx.orgId) continue;
      const quotes = $app.findRecordsByFilter("quotes", "job = {:job} && (status = 'accepted' || status = 'issued')", "-version", 0, 0, { job: id });
      const quote = quotes.find((q) => q.getString("status") === "accepted") || quotes[0];
      if (!quote) {
        skipped.push("#" + job.getInt("number"));
        continue;
      }
      const snapshot = decodeJson(quote.get("snapshot"));
      invoices.push({
        invoiceNumber: settings.invoicePrefix + job.getInt("number"),
        reference: job.getString("reference") || job.getString("name"),
        invoiceDate: invoiceDate,
        dueDate: dueDate,
        contact: snapshot.client || { name: "" },
        snapshot: snapshot,
      });
    }
    if (invoices.length === 0) throw new BadRequestError("None of those jobs has an issued quote to invoice from");

    const csv = buildXeroCsv(invoices, { accountCode: settings.xeroAccountCode, taxType: settings.xeroTaxType });
    logEvent(ctx.orgId, "export_xero", whoName(e.auth), { invoices: invoices.map((i) => i.invoiceNumber), skipped: skipped });
    e.response.header().set("Content-Disposition", 'attachment; filename="xero-invoices-' + query.invoiceDate + '.csv"');
    return e.blob(200, "text/csv; charset=utf-8", toBytes(csv));
  },
  $apis.requireAuth("users"),
);
