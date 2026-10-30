// Printers and label sizes, per organisation (Settings → Printer setup).
// Stored as two JSON settings, "labelSizes" and "printers". Unset, an
// organisation gets the standard sizes, and its old single printer address
// (the "printerHost" setting) becomes one printer.
//
// A label size is stock you buy: Brother tape (continuous, any length),
// Brother die-cut labels, or anything else printed from a PDF (Zebra rolls,
// A4 sheets). A printer says which size is loaded in it, so a template goes
// to a printer with its stock in.

// brother_ql's media identifiers (brother_ql.labels.ALL_LABELS).
const BROTHER_MEDIA = [
  "12", "29", "38", "50", "54", "62", "102",
  "17x54", "17x87", "23x23", "29x42", "29x90", "39x90", "39x48", "52x29", "62x29", "62x100", "102x51", "102x152",
  "d12", "d24", "d58",
];

const BROTHER_MODELS = [
  "QL-500", "QL-550", "QL-560", "QL-570", "QL-580N", "QL-650TD", "QL-700", "QL-710W", "QL-720NW",
  "QL-800", "QL-810W", "QL-820NWB", "QL-1050", "QL-1060N",
];

const DEFAULT_SIZES = [
  { id: "tape-62", name: "62mm tape", widthMm: 62, lengthMm: 29, continuous: true, brother: "62" },
  { id: "tape-29", name: "29mm tape", widthMm: 29, lengthMm: 15, continuous: true, brother: "29" },
];

function parseList(raw) {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch (_) {
    return null;
  }
}

function printingConfig(org) {
  const { getAllSettings } = require(`${__hooks}/lib/settings.js`);
  const all = getAllSettings(org);
  const sizes = parseList(all.labelSizes) || DEFAULT_SIZES;
  let printers = parseList(all.printers);
  if (!printers) {
    const host = all.printerHost || $os.getenv("PRINTER_HOST") || "";
    printers = host
      ? [{ id: "printer-1", name: "Label printer", host: host, model: "QL-810W", sizeId: "tape-62", locationId: "", agentId: "", isDefault: true, enabled: true }]
      : [];
  }
  return { sizes: sizes, printers: printers };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const positive = (v) => typeof v === "number" && isFinite(v) && v > 0 && v <= 1000;

// Throws BadRequestError on anything unusable; returns cleaned lists.
// agentIds: the organisation's print agents (lib/printAgents.js), when a
// printer may go through one; left out, any id is taken.
function validatePrintingBody(data, agentIds) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (!Array.isArray(data.sizes) || !Array.isArray(data.printers)) throw new BadRequestError("sizes and printers must be lists");
  if (data.sizes.length > 100) throw new BadRequestError("Too many label sizes");
  if (data.printers.length > 50) throw new BadRequestError("Too many printers");

  const sizeIds = {};
  const sizes = data.sizes.map((s) => {
    if (!s || typeof s !== "object") throw new BadRequestError("Invalid label size");
    const id = str(s.id, 60);
    const name = str(s.name, 80);
    if (!id || sizeIds[id]) throw new BadRequestError("Each label size needs its own id");
    if (!name) throw new BadRequestError("Each label size needs a name");
    if (!positive(s.widthMm) || !positive(s.lengthMm)) throw new BadRequestError(name + ": width and length must be positive numbers of mm");
    const brother = str(s.brother, 20);
    if (brother && BROTHER_MEDIA.indexOf(brother) === -1) throw new BadRequestError(name + ": unknown Brother media " + brother);
    sizeIds[id] = true;
    return { id: id, name: name, widthMm: s.widthMm, lengthMm: s.lengthMm, continuous: !!s.continuous, brother: brother, hidden: !!s.hidden };
  });

  const printerIds = {};
  let defaults = 0;
  const printers = data.printers.map((p) => {
    if (!p || typeof p !== "object") throw new BadRequestError("Invalid printer");
    const id = str(p.id, 60);
    const name = str(p.name, 80);
    if (!id || printerIds[id]) throw new BadRequestError("Each printer needs its own id");
    if (!name) throw new BadRequestError("Each printer needs a name");
    const host = str(p.host, 255);
    if (host && !/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) throw new BadRequestError(name + ": the address should be an IP address or host name");
    const model = str(p.model, 20) || "QL-810W";
    if (BROTHER_MODELS.indexOf(model) === -1) throw new BadRequestError(name + ": unsupported model " + model);
    const sizeId = str(p.sizeId, 60);
    if (sizeId && !sizeIds[sizeId]) throw new BadRequestError(name + ": the loaded label size doesn't exist");
    const agentId = str(p.agentId, 30);
    if (agentId && agentIds && agentIds.indexOf(agentId) === -1) throw new BadRequestError(name + ": that print agent doesn't exist");
    if (p.isDefault) defaults++;
    printerIds[id] = true;
    return {
      id: id,
      name: name,
      host: host,
      model: model,
      sizeId: sizeId,
      locationId: str(p.locationId, 30),
      // "" = the server sends to it itself (self-hosted, on its network).
      agentId: agentId,
      isDefault: !!p.isDefault,
      enabled: p.enabled !== false,
    };
  });
  if (defaults > 1) throw new BadRequestError("Only one printer can be the default");
  return { sizes: sizes, printers: printers };
}

function savePrinting(org, config) {
  const { setSetting } = require(`${__hooks}/lib/settings.js`);
  setSetting(org, "labelSizes", JSON.stringify(config.sizes));
  setSetting(org, "printers", JSON.stringify(config.printers));
}

// The printer a job goes to: the one asked for, else the default, else the
// first enabled one.
function findPrinter(config, printerId) {
  const usable = config.printers.filter((p) => p.enabled !== false && p.host);
  if (printerId) return usable.filter((p) => p.id === printerId)[0] || null;
  return usable.filter((p) => p.isDefault)[0] || usable[0] || null;
}

module.exports = { BROTHER_MEDIA, BROTHER_MODELS, DEFAULT_SIZES, printingConfig, validatePrintingBody, savePrinting, findPrinter };
