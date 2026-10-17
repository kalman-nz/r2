/// <reference path="../pb_data/types.d.ts" />
// PDF downloads, drawn by print/r2_pdf.py (see lib/pdf.js).
//
// Each route checks the person's role in the record's own organisation.

// A quote exactly as issued, from its snapshot.
routerAdd(
  "GET",
  "/api/quotes/{id}/pdf",
  (e) => {
    const { findOrNull, decodeJson } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { renderPdf, sendPdf } = require(`${__hooks}/lib/pdf.js`);
    const { publicSettings } = require(`${__hooks}/lib/settings.js`);
    const quote = findOrNull($app, "quotes", e.request.pathValue("id"));
    if (!quote) throw new NotFoundError("Quote not found");
    const ctx = requireRecordOrg(e, quote, "quotes.view");
    const snapshot = decodeJson(quote.get("snapshot"));
    const number = "Q" + snapshot.job.number + "-" + quote.getInt("version");
    const pdf = renderPdf("quote", {
      number: number,
      status: quote.getString("status"),
      snapshot: snapshot,
      timezone: publicSettings(ctx.orgId).timezone,
    });
    return sendPdf(e, pdf, number + ".pdf");
  },
  $apis.requireAuth("users"),
);

// The job's packing list as it stands now (no prices, so techs can have it).
routerAdd(
  "GET",
  "/api/jobs/{id}/packing.pdf",
  (e) => {
    const { buildSummary, requireJob } = require(`${__hooks}/lib/jobs.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { renderPdf, sendPdf } = require(`${__hooks}/lib/pdf.js`);
    const { publicSettings } = require(`${__hooks}/lib/settings.js`);
    const ctx = requireRecordOrg(e, requireJob($app, e.request.pathValue("id")));
    const summary = buildSummary($app, e.request.pathValue("id"), false);
    const settings = publicSettings(ctx.orgId);
    const pdf = renderPdf("packing", {
      businessName: settings.businessName,
      job: summary.job,
      lines: summary.lines,
      packing: summary.packing,
      timezone: settings.timezone,
    });
    return sendPdf(e, pdf, "Packing list " + summary.job.number + ".pdf");
  },
  $apis.requireAuth("users"),
);

// Labels the browser has already rendered (the same images the Brother
// printer gets), one PDF page per label at the label's own size, for any
// printer with a driver — Zebra, Dymo, or Brother over USB. No
// organisation data is read, so any signed-in person can use it.
// body: { labels: [{ imageDataUrl, widthMm, heightMm, copies }] }
routerAdd(
  "POST",
  "/api/labels/pdf",
  (e) => {
    const { renderPdf, sendPdf } = require(`${__hooks}/lib/pdf.js`);
    const { PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const body = e.requestInfo().body || {};
    const labels = Array.isArray(body.labels) ? body.labels : [];
    if (labels.length === 0) throw new BadRequestError("No labels to put in the PDF");
    if (labels.length > 500) throw new BadRequestError("Make PDFs of 500 labels or fewer at a time");
    const pages = labels.map((l, i) => {
      if (!l || typeof l.imageDataUrl !== "string" || l.imageDataUrl.indexOf(PNG_PREFIX) !== 0) {
        throw new BadRequestError("Label " + (i + 1) + " has no PNG image");
      }
      const widthMm = Number(l.widthMm);
      const heightMm = Number(l.heightMm);
      if (!(widthMm > 0 && widthMm <= 300 && heightMm > 0 && heightMm <= 300)) {
        throw new BadRequestError("Label " + (i + 1) + " has an impossible size");
      }
      const copies = Number(l.copies) || 1;
      return {
        png: l.imageDataUrl.slice(PNG_PREFIX.length),
        widthMm: widthMm,
        heightMm: heightMm,
        copies: Math.max(1, Math.min(100, Math.round(copies))),
      };
    });
    return sendPdf(e, renderPdf("labels", { labels: pages }), "labels.pdf");
  },
  $apis.requireAuth("users"),
);
