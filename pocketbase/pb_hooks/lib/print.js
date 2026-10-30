// The PNG goes to print/print_label.py as its base64 text in a temp file,
// which the script decodes itself (JSVM has no native base64 decoder, but
// Python's stdlib does — see that script). Not as an argument: Linux (the
// Docker image) refuses any single argument over 128 KB, and a big label's
// base64 is more than that. lib/python.js says where Python and the
// scripts live.
const { pythonBin, printDir } = require("./python.js");

// pngBase64 must already be rendered at the printer's native resolution
// (696px wide for 62mm continuous media at 300dpi) — see web's label
// designer, which renders the same Konva stage used for editing.
//
// printerHost is the live value from the "settings" collection (Settings >
// Printer in the UI) — callers should pass that in. Falls back to the
// PRINTER_HOST env var so a deployment keeps working before anyone's
// visited Settings yet.
// Runs print/print_label.py and reads its one-line JSON result:
// { ok, unreachable, message }. unreachable = the printer didn't answer
// (switched off, wrong address), so the job can go to another printer;
// anything else (a bad image) would fail on any printer.
function runPrintScript(args) {
  let output;
  try {
    output = toString($os.cmd(pythonBin(), printDir() + "/print_label.py", "--json", ...args).output());
  } catch (err) {
    return { ok: false, unreachable: false, message: "Printing isn't set up on this server (couldn't run " + pythonBin() + ")" };
  }
  try {
    const result = JSON.parse(output.trim().split("\n").pop());
    return { ok: !!result.ok, unreachable: !!result.unreachable, message: String(result.message || "") };
  } catch (_) {
    return { ok: false, unreachable: false, message: "The print script gave no result" };
  }
}

// pngBase64 must already be rendered at the printer's native resolution
// (see printGeometry in web/src/lib/printing.ts).
function printLabelPng(pngBase64, label, printerHost, model) {
  if (!printerHost) return { ok: false, unreachable: false, message: "No printer set up — add one in Settings → Printer setup." };
  const image = $os.tempDir() + "/r2-label-" + $security.randomString(16) + ".b64";
  $os.writeFile(image, pngBase64, 0o600);
  let result;
  try {
    result = runPrintScript(["--image-base64-file", image, "--host", printerHost, "--model", model || "QL-810W", "--label", label || "62"]);
  } finally {
    try {
      $os.remove(image);
    } catch (_) {
      // already gone
    }
  }
  if (result.ok) result.message = "Sent to printer";
  return result;
}

// The printer's own raster commands for a label, base64, for a print agent
// to send on (lib/printAgents.js): { ok, message, data }.
function renderRaster(pngBase64, label, model) {
  const base = $os.tempDir() + "/r2-label-" + $security.randomString(16);
  const image = base + ".b64";
  const raster = base + ".raster";
  $os.writeFile(image, pngBase64, 0o600);
  try {
    const result = runPrintScript(["--image-base64-file", image, "--raster-out", raster, "--model", model || "QL-810W", "--label", label || "62"]);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: "", data: toString($os.readFile(raster)) };
  } catch (err) {
    return { ok: false, message: "Couldn't make the label for the printer" };
  } finally {
    for (const path of [image, raster]) {
      try {
        $os.remove(path);
      } catch (_) {
        // already gone
      }
    }
  }
}

// Whether this server sends labels to printers itself (over its own
// network). A cloud server can't reach a venue's printers, so it's turned
// off there (R2_DIRECT_PRINTING=0) and every printer goes through a print
// agent; that also stops anyone pointing the server at other addresses.
function directPrinting() {
  return $os.getenv("R2_DIRECT_PRINTING") !== "0";
}

// Whether the printer answers on the network, without printing anything.
function checkPrinter(host) {
  if (!host) return { ok: false, message: "No address set" };
  const result = runPrintScript(["--check", "--host", host]);
  return { ok: result.ok, message: result.ok ? "Online" : result.unreachable ? "Not reachable" : result.message };
}

const PNG_PREFIX = "data:image/png;base64,";

// Three shapes: a real unit (serialId) or item printed against a saved
// template; a saved template printed with manually-typed field values
// instead (serialId omitted); or a one-off custom-text label with no
// template at all.
function validatePrintBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.imageDataUrl !== "string" || data.imageDataUrl.indexOf(PNG_PREFIX) !== 0) {
    throw new BadRequestError("imageDataUrl must be a data:image/png;base64, URL");
  }
  if (typeof data.label !== "string") throw new BadRequestError("label is required");
  const printerId = typeof data.printerId === "string" ? data.printerId : "";

  if (typeof data.templateId === "string") {
    return {
      kind: "template",
      templateId: data.templateId,
      serialId: typeof data.serialId === "string" ? data.serialId : undefined,
      imageDataUrl: data.imageDataUrl,
      label: data.label,
      printerId: printerId,
    };
  }
  if (typeof data.customText === "string" && data.customText) {
    return { kind: "custom", customText: data.customText, imageDataUrl: data.imageDataUrl, label: data.label, printerId: printerId };
  }
  throw new BadRequestError("Either templateId or customText is required");
}

module.exports = { printLabelPng, renderRaster, directPrinting, checkPrinter, validatePrintBody, PNG_PREFIX };
