/// <reference path="../pb_data/types.d.ts" />

routerAdd(
  "POST",
  "/api/print",
  (e) => {
    const { printLabelPng, validatePrintBody, PNG_PREFIX } = require(`${__hooks}/lib/print.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { getAllSettings } = require(`${__hooks}/lib/settings.js`);

    const parsed = validatePrintBody(e.requestInfo().body);
    const settings = getAllSettings();
    const pngBase64 = parsed.imageDataUrl.slice(PNG_PREFIX.length);
    const result = printLabelPng(pngBase64, parsed.label, settings.printerHost || undefined);

    if (result.ok) {
      const who = e.auth.get("name") || e.auth.get("email");
      const details =
        parsed.kind === "template"
          ? { template: parsed.templateId, rentmanSerialNumberId: parsed.rentmanSerialNumberId || null }
          : { customText: parsed.customText };
      logEvent("print", who, details);
    }

    return e.json(result.ok ? 200 : 502, result);
  },
  $apis.requireAuth(),
);
