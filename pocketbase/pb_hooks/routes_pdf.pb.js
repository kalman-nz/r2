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
      periods: summary.periods,
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
// printer with a driver — Zebra, Dymo, or Brother over USB. Printing labels
// one way or another, so it needs the organisation's "Print labels"
// permission and the labels feature, like the Brother route; the images
// have to be PNG (each page's bytes are checked again in r2_pdf.py), so no
// other format can reach the renderer.
// body: { labels: [{ imageDataUrl, widthMm, heightMm, copies }] }
routerAdd(
  "POST",
  "/api/labels/pdf",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireFeature } = require(`${__hooks}/lib/features.js`);
    const { renderPdf, sendPdf } = require(`${__hooks}/lib/pdf.js`);
    const { PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const ctx = requireOrg(e, "labels.print");
    requireFeature(ctx.org, "labels");
    const body = e.requestInfo().body || {};
    const labels = Array.isArray(body.labels) ? body.labels : [];
    if (labels.length === 0) throw new BadRequestError("No labels to put in the PDF");
    if (labels.length > 500) throw new BadRequestError("Make PDFs of 500 labels or fewer at a time");
    let totalPages = 0;
    const pages = labels.map((l, i) => {
      const which = labels.length === 1 ? "The label" : "Label " + (i + 1);
      if (!l || typeof l.imageDataUrl !== "string" || l.imageDataUrl.indexOf(PNG_PREFIX) !== 0) {
        throw new BadRequestError(which + " has no PNG image");
      }
      const png = l.imageDataUrl.slice(PNG_PREFIX.length);
      // A PNG's base64 always starts with the 8-byte signature, so anything
      // that isn't one (an SVG, which fpdf2 would follow to local files and
      // URLs; another image format) is turned away here, not just by its
      // data-URL label.
      if (png.slice(0, 11) !== "iVBORw0KGgo") throw new BadRequestError(which + " isn't a PNG image");
      const widthMm = Number(l.widthMm);
      const heightMm = Number(l.heightMm);
      if (!(widthMm > 0 && heightMm > 0)) throw new BadRequestError(which + "'s width and length have to be more than 0 mm");
      if (widthMm > 300 || heightMm > 300) throw new BadRequestError(which + " is over 300 mm, too big for a PDF page");
      // Refused rather than rounded: 0 copies isn't a PDF anyone wants.
      const copies = l.copies === undefined ? 1 : Number(l.copies);
      if (!Number.isInteger(copies) || copies < 1 || copies > 999) throw new BadRequestError("Copies has to be a whole number from 1 to 999");
      totalPages += copies;
      if (totalPages > 2000) throw new BadRequestError("That's over 2000 pages: split it into smaller PDFs");
      return { png: png, widthMm: widthMm, heightMm: heightMm, copies: copies };
    });
    return sendPdf(e, renderPdf("labels", { labels: pages }), "labels.pdf");
  },
  $apis.requireAuth("users"),
);
