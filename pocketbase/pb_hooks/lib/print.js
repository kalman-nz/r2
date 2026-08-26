// Port of the old server/src/print.ts — instead of writing the PNG to a
// temp file from Node and spawning python, the base64 PNG is passed straight
// through as a CLI arg and print/print_label.py decodes it itself (JSVM has
// no native base64 decoder, but Python's stdlib does — see that script).
const PYTHON = "/pb/print/venv/bin/python";
const SCRIPT = "/pb/print/print_label.py";

// pngBase64 must already be rendered at the printer's native resolution
// (696px wide for 62mm continuous media at 300dpi) — see web's label
// designer, which renders the same Konva stage used for editing.
//
// printerHost is the live value from the "settings" collection (Settings >
// Printer in the UI) — callers should pass that in. Falls back to the
// PRINTER_HOST env var so a deployment keeps working before anyone's
// visited Settings yet.
function printLabelPng(pngBase64, label, printerHost) {
  const host = printerHost || $os.getenv("PRINTER_HOST");
  if (!host) {
    return { ok: false, message: "No printer configured — set one on the Settings > Printer page." };
  }

  try {
    $os.cmd(PYTHON, SCRIPT, "--image-base64", pngBase64, "--host", host, "--label", label || "62").run();
    return { ok: true, message: "Sent to printer" };
  } catch (err) {
    return { ok: false, message: String((err && err.message) || err) };
  }
}

const PNG_PREFIX = "data:image/png;base64,";

// Three shapes: a real asset's serial printed against a saved template; a
// saved template printed with manually-typed field values instead of a real
// asset (rentmanSerialNumberId omitted); or a one-off custom-text label
// with no template at all.
function validatePrintBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.imageDataUrl !== "string" || data.imageDataUrl.indexOf(PNG_PREFIX) !== 0) {
    throw new BadRequestError("imageDataUrl must be a data:image/png;base64, URL");
  }
  if (typeof data.label !== "string") throw new BadRequestError("label is required");

  if (typeof data.templateId === "string") {
    return {
      kind: "template",
      templateId: data.templateId,
      rentmanSerialNumberId: typeof data.rentmanSerialNumberId === "string" ? data.rentmanSerialNumberId : undefined,
      imageDataUrl: data.imageDataUrl,
      label: data.label,
    };
  }
  if (typeof data.customText === "string" && data.customText) {
    return { kind: "custom", customText: data.customText, imageDataUrl: data.imageDataUrl, label: data.label };
  }
  throw new BadRequestError("Either templateId or customText is required");
}

module.exports = { printLabelPng, validatePrintBody, PNG_PREFIX };
