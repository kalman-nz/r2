/// <reference path="../pb_data/types.d.ts" />
// Sends a rendered label to one of the organisation's networked Brother QL
// printers (Settings → Printer setup). A printer that goes through a print
// agent gets it by way of the agent at the venue (lib/printAgents.js);
// otherwise the server opens the connection to the printer itself, which
// only works when R2 runs on the same network as the printer (self-hosted,
// and not turned off with R2_DIRECT_PRINTING=0). Labels can always be
// printed from a downloaded PDF too (routes_pdf.pb.js).

routerAdd(
  "POST",
  "/api/print",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printLabelPng, directPrinting, validatePrintBody, PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const { printingConfig, findPrinter, BROTHER_MEDIA } = require(`${__hooks}/lib/printing.js`);
    const { printThroughAgent } = require(`${__hooks}/lib/printAgents.js`);
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
    let result;
    if (printer.agentId) {
      result = printThroughAgent($app, ctx.orgId, printer, pngBase64, parsed.label, e.auth);
    } else if (!directPrinting()) {
      result = { ok: false, unreachable: true, message: printer.name + " needs a print agent to print from here (Settings → Printer setup)" };
    } else {
      result = printLabelPng(pngBase64, parsed.label, printer.host, printer.model);
    }

    if (result.ok) {
      const who = e.auth.get("name") || e.auth.get("email");
      const details =
        parsed.kind === "template"
          ? { template: parsed.templateId, serialId: parsed.serialId || null, printer: printer.name }
          : { customText: parsed.customText, printer: printer.name };
      if (printer.agentId) details.through = "agent";
      logEvent(ctx.orgId, "print", who, details);
    }

    // 502 only when the printer didn't answer, so the app tries the next
    // one; a label that can't print anywhere is a 422.
    return e.json(result.ok ? 200 : result.unreachable ? 502 : 422, Object.assign({ printerId: printer.id, printer: printer.name }, result));
  },
  $apis.requireAuth("users"),
);

// Printers and label sizes. Any member can read them (printing needs to
// know where to send a label); settings.edit changes them. direct: whether
// this server can send to printers itself, or they all need an agent.
routerAdd(
  "GET",
  "/api/printing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printingConfig } = require(`${__hooks}/lib/printing.js`);
    const { directPrinting } = require(`${__hooks}/lib/print.js`);
    const ctx = requireOrg(e);
    return e.json(200, Object.assign(printingConfig(ctx.orgId), { direct: directPrinting() }));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PUT",
  "/api/printing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { validatePrintingBody, savePrinting, printingConfig } = require(`${__hooks}/lib/printing.js`);
    const { directPrinting } = require(`${__hooks}/lib/print.js`);
    const { agentsOf } = require(`${__hooks}/lib/printAgents.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    const config = validatePrintingBody(e.requestInfo().body, agentsOf($app, ctx.orgId).map((a) => a.id));
    savePrinting(ctx.orgId, config);
    logEvent(ctx.orgId, "printing_updated", e.auth.get("name") || e.auth.get("email"), { printers: config.printers.length, sizes: config.sizes.length });
    return e.json(200, Object.assign(printingConfig(ctx.orgId), { direct: directPrinting() }));
  },
  $apis.requireAuth("users"),
);

// Whether each printer answers on the network — for the dots in Printer
// setup and the print dialog. The server checks its own in turn, a few
// seconds at most each; a printer behind an agent is as the agent last saw
// it.
routerAdd(
  "POST",
  "/api/printing/check",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printingConfig } = require(`${__hooks}/lib/printing.js`);
    const { checkPrinter, directPrinting } = require(`${__hooks}/lib/print.js`);
    const { agentsOf, agentPrinterStatus } = require(`${__hooks}/lib/printAgents.js`);
    const ctx = requireOrg(e);
    const body = e.requestInfo().body || {};
    const ids = Array.isArray(body.ids) ? body.ids : null;
    const agents = {};
    for (const a of agentsOf($app, ctx.orgId)) agents[a.id] = a;
    const result = {};
    for (const p of printingConfig(ctx.orgId).printers) {
      if (ids && ids.indexOf(p.id) === -1) continue;
      if (p.enabled === false) result[p.id] = { ok: false, message: "Turned off" };
      else if (p.agentId) result[p.id] = agentPrinterStatus(agents[p.agentId] || null, p);
      else if (!directPrinting()) result[p.id] = { ok: false, message: "Needs a print agent" };
      else result[p.id] = checkPrinter(p.host);
    }
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);
