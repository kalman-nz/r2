/// <reference path="../pb_data/types.d.ts" />
// Sends a rendered label to one of the organisation's networked Brother QL
// printers (Settings → Printer setup). The server opens the connection to
// the printer itself, so this only works when R2 runs on the same network
// as the printer (self-hosted). Otherwise labels are printed from a
// downloaded PDF (routes_pdf.pb.js).

routerAdd(
  "POST",
  "/api/print",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printLabelPng, validatePrintBody, PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const { printingConfig, findPrinter, BROTHER_MEDIA } = require(`${__hooks}/lib/printing.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "labels.print");

    const parsed = validatePrintBody(e.requestInfo().body);
    if (BROTHER_MEDIA.indexOf(parsed.label) === -1) throw new BadRequestError("Unknown Brother media: " + parsed.label);
    const printer = findPrinter(printingConfig(ctx.orgId), parsed.printerId);
    if (!printer) {
      return e.json(502, {
        ok: false,
        message: parsed.printerId ? "That printer isn't set up any more." : "No printer set up — add one in Settings → Printer setup.",
      });
    }
    const pngBase64 = parsed.imageDataUrl.slice(PNG_PREFIX.length);
    const result = printLabelPng(pngBase64, parsed.label, printer.host, printer.model);

    if (result.ok) {
      const who = e.auth.get("name") || e.auth.get("email");
      const details =
        parsed.kind === "template"
          ? { template: parsed.templateId, serialId: parsed.serialId || null, printer: printer.name }
          : { customText: parsed.customText, printer: printer.name };
      logEvent(ctx.orgId, "print", who, details);
    }

    // 502 only when the printer didn't answer, so the app tries the next
    // one; a label that can't print anywhere is a 422.
    return e.json(result.ok ? 200 : result.unreachable ? 502 : 422, Object.assign({ printerId: printer.id, printer: printer.name }, result));
  },
  $apis.requireAuth("users"),
);

// Printers and label sizes. Any member can read them (printing needs to
// know where to send a label); settings.edit changes them.
routerAdd(
  "GET",
  "/api/printing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printingConfig } = require(`${__hooks}/lib/printing.js`);
    const ctx = requireOrg(e);
    return e.json(200, printingConfig(ctx.orgId));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/printing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { validatePrintingBody, savePrinting, printingConfig } = require(`${__hooks}/lib/printing.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    const config = validatePrintingBody(e.requestInfo().body);
    savePrinting(ctx.orgId, config);
    logEvent(ctx.orgId, "printing_updated", e.auth.get("name") || e.auth.get("email"), { printers: config.printers.length, sizes: config.sizes.length });
    return e.json(200, printingConfig(ctx.orgId));
  },
  $apis.requireAuth("users"),
);

// Whether each printer answers on the network — for the dots in Printer
// setup and the print dialog. Checked in turn, a few seconds at most each.
routerAdd(
  "POST",
  "/api/printing/check",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printingConfig } = require(`${__hooks}/lib/printing.js`);
    const { checkPrinter } = require(`${__hooks}/lib/print.js`);
    const ctx = requireOrg(e);
    const body = e.requestInfo().body || {};
    const ids = Array.isArray(body.ids) ? body.ids : null;
    const result = {};
    for (const p of printingConfig(ctx.orgId).printers) {
      if (ids && ids.indexOf(p.id) === -1) continue;
      result[p.id] = p.enabled === false ? { ok: false, message: "Turned off" } : checkPrinter(p.host);
    }
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);
