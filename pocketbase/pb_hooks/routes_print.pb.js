/// <reference path="../pb_data/types.d.ts" />
// Sends a rendered label to the organisation's networked Brother QL printer.
// The server opens the connection to the printer itself, so this only works
// when R2 runs on the same network as the printer (self-hosted). On a cloud
// install, labels are printed from a downloaded PDF instead (routes_pdf.pb.js).

routerAdd(
  "POST",
  "/api/print",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { printLabelPng, validatePrintBody, PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { getAllSettings } = require(`${__hooks}/lib/settings.js`);
    const ctx = requireOrg(e, "labels.print");

    const parsed = validatePrintBody(e.requestInfo().body);
    const settings = getAllSettings(ctx.orgId);
    const pngBase64 = parsed.imageDataUrl.slice(PNG_PREFIX.length);
    const result = printLabelPng(pngBase64, parsed.label, settings.printerHost || undefined);

    if (result.ok) {
      const who = e.auth.get("name") || e.auth.get("email");
      const details =
        parsed.kind === "template"
          ? { template: parsed.templateId, serialId: parsed.serialId || null }
          : { customText: parsed.customText };
      logEvent(ctx.orgId, "print", who, details);
    }

    return e.json(result.ok ? 200 : 502, result);
  },
  $apis.requireAuth("users"),
);
