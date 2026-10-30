import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { currentOrgId } from "./currentOrg";

// Printers and label sizes (Settings → Printer setup; the server side is
// pocketbase/pb_hooks/lib/printing.js).
//
// A label size is stock you buy: Brother tape (continuous — any length),
// Brother die-cut labels, or anything printed from a PDF. widthMm is across
// the tape or label as it comes out of the printer, lengthMm along it (for
// tape, just the length new designs start at). A template is designed at
// either orientation; a sideways one is turned before it's sent.

export interface LabelSize {
  id: string;
  name: string;
  widthMm: number;
  lengthMm: number;
  continuous: boolean;
  brother: string; // brother_ql media id ("62", "29x90"), "" = printed from a PDF
  hidden?: boolean;
}

export interface Printer {
  id: string;
  name: string;
  host: string;
  model: string;
  sizeId: string; // the label size loaded in it now
  locationId: string; // "" = not at any one location
  agentId?: string; // the print agent at the venue it goes through; "" = straight from the server
  isDefault: boolean;
  enabled: boolean;
}

export interface PrintingConfig {
  sizes: LabelSize[];
  printers: Printer[];
  direct?: boolean; // the server can send to printers itself (self-hosted); off, every printer needs an agent
}

// A small program at a venue that takes labels to its printers
// (print/r2_print_agent.py, pocketbase/pb_hooks/lib/printAgents.js).
export interface PrintAgent {
  id: string;
  name: string;
  online: boolean;
  lastSeen: string;
  hostname: string;
  version: string;
}

export function usePrinting() {
  return useQuery({ queryKey: ["printing"], queryFn: api.getPrinting, staleTime: 30_000 });
}

// --- Brother media -----------------------------------------------------------

// From brother_ql.labels.ALL_LABELS. dots = the printable pixels across ×
// along; continuous tape has no fixed length. Die-cut labels have to be
// sent at exactly their dots, or the print fails.
export interface BrotherMedia {
  id: string;
  name: string;
  widthMm: number;
  lengthMm: number; // 0 = continuous
  dots: [number, number];
  round?: boolean;
  wideOnly?: boolean; // 102mm media: QL-1050 / QL-1060N only
}

export const BROTHER_MEDIA: BrotherMedia[] = [
  { id: "12", name: "12mm tape", widthMm: 12, lengthMm: 0, dots: [106, 0] },
  { id: "29", name: "29mm tape", widthMm: 29, lengthMm: 0, dots: [306, 0] },
  { id: "38", name: "38mm tape", widthMm: 38, lengthMm: 0, dots: [413, 0] },
  { id: "50", name: "50mm tape", widthMm: 50, lengthMm: 0, dots: [554, 0] },
  { id: "54", name: "54mm tape", widthMm: 54, lengthMm: 0, dots: [590, 0] },
  { id: "62", name: "62mm tape", widthMm: 62, lengthMm: 0, dots: [696, 0] },
  { id: "102", name: "102mm tape", widthMm: 102, lengthMm: 0, dots: [1164, 0], wideOnly: true },
  { id: "17x54", name: "17 × 54mm labels", widthMm: 17, lengthMm: 54, dots: [165, 566] },
  { id: "17x87", name: "17 × 87mm labels", widthMm: 17, lengthMm: 87, dots: [165, 956] },
  { id: "23x23", name: "23 × 23mm labels", widthMm: 23, lengthMm: 23, dots: [202, 202] },
  { id: "29x42", name: "29 × 42mm labels", widthMm: 29, lengthMm: 42, dots: [306, 425] },
  { id: "29x90", name: "29 × 90mm labels", widthMm: 29, lengthMm: 90, dots: [306, 991] },
  { id: "39x90", name: "38 × 90mm labels", widthMm: 38, lengthMm: 90, dots: [413, 991] },
  { id: "39x48", name: "39 × 48mm labels", widthMm: 39, lengthMm: 48, dots: [425, 495] },
  { id: "52x29", name: "52 × 29mm labels", widthMm: 52, lengthMm: 29, dots: [578, 271] },
  { id: "62x29", name: "62 × 29mm labels", widthMm: 62, lengthMm: 29, dots: [696, 271] },
  { id: "62x100", name: "62 × 100mm labels", widthMm: 62, lengthMm: 100, dots: [696, 1109] },
  { id: "102x51", name: "102 × 51mm labels", widthMm: 102, lengthMm: 51, dots: [1164, 526], wideOnly: true },
  { id: "102x152", name: "102 × 152mm labels", widthMm: 102, lengthMm: 153, dots: [1164, 1660], wideOnly: true },
  { id: "d12", name: "12mm round labels", widthMm: 12, lengthMm: 12, dots: [94, 94], round: true },
  { id: "d24", name: "24mm round labels", widthMm: 24, lengthMm: 24, dots: [236, 236], round: true },
  { id: "d58", name: "58mm round labels", widthMm: 58, lengthMm: 58, dots: [618, 618], round: true },
];

export const BROTHER_MODELS = [
  "QL-500", "QL-550", "QL-560", "QL-570", "QL-580N", "QL-650TD", "QL-700", "QL-710W", "QL-720NW",
  "QL-800", "QL-810W", "QL-820NWB", "QL-1050", "QL-1060N",
];

export function brotherMedia(id: string | undefined): BrotherMedia | null {
  return BROTHER_MEDIA.find((m) => m.id === id) ?? null;
}

// Brother prints at 300 dpi.
const BROTHER_DPM = 300 / 25.4;
const near = (a: number, b: number) => Math.abs(a - b) < 0.6;

export function sizeLabel(size: LabelSize): string {
  if (size.continuous) return `${size.widthMm}mm wide, any length`;
  return `${size.widthMm} × ${size.lengthMm} mm`;
}

// --- Which size a template is ----------------------------------------------

// Whether a design of w × h mm fits a size, either way round.
export function fitsSize(size: LabelSize, w: number, h: number): boolean {
  if (size.continuous) return near(w, size.widthMm) || near(h, size.widthMm);
  return (near(w, size.widthMm) && near(h, size.lengthMm)) || (near(h, size.widthMm) && near(w, size.lengthMm));
}

// A template set to a size of its own, printed from a PDF.
export const CUSTOM_SIZE = "custom";

// The size a template was made for: the one it names, else the first that
// fits its width and length (older templates name none).
export function sizeForTemplate(
  template: { widthMm: number; heightMm: number; sizeId?: string },
  sizes: LabelSize[],
): LabelSize | null {
  if (template.sizeId === CUSTOM_SIZE) return null;
  const named = template.sizeId ? sizes.find((s) => s.id === template.sizeId) : undefined;
  if (named && fitsSize(named, template.widthMm, template.heightMm)) return named;
  const fits = sizes.filter((s) => fitsSize(s, template.widthMm, template.heightMm));
  // Die-cut labels first: an exact match says more than "tape that's wide enough".
  return fits.find((s) => !s.continuous) ?? fits[0] ?? null;
}

// --- How to render for the printer ---------------------------------------

export interface PrintGeometry {
  label: string; // brother_ql media id, "" = not for a Brother
  scale: number; // px per mm the design is drawn at
  canvasWidth?: number; // exact canvas size (die-cut); unset = the design's size × scale
  canvasHeight?: number;
  rotate: boolean; // turn the finished image 90° before sending
}

// Brother tape takes an image exactly as wide as the tape's printable dots
// (any height); die-cut labels exactly their printable dots both ways, so
// the design is drawn at 300 dpi, centred, losing the unprintable margin.
// A design that's sideways to the stock is drawn as it is, then turned.
export function printGeometry(template: { widthMm: number; heightMm: number }, size: LabelSize | null): PrintGeometry {
  const media = brotherMedia(size?.brother);
  if (media && media.lengthMm === 0) {
    const sideways = !near(template.widthMm, media.widthMm) && near(template.heightMm, media.widthMm);
    const across = sideways ? template.heightMm : template.widthMm;
    return { label: media.id, scale: media.dots[0] / across, rotate: sideways };
  }
  if (media) {
    const sideways = !(near(template.widthMm, media.widthMm) && near(template.heightMm, media.lengthMm));
    const [across, along] = media.dots;
    return {
      label: media.id,
      scale: BROTHER_DPM,
      canvasWidth: sideways ? along : across,
      canvasHeight: sideways ? across : along,
      rotate: sideways,
    };
  }
  // A PDF: 300 dpi is plenty for any label printer driver.
  return { label: "", scale: BROTHER_DPM, rotate: false };
}

// The part of a die-cut label the printer can't reach, in mm from each
// side of the design — shown in the designer. Null when it all prints.
export function unprintableMargin(size: LabelSize | null, widthMm: number, heightMm: number): { x: number; y: number } | null {
  const media = brotherMedia(size?.brother);
  if (!media || media.lengthMm === 0) return null;
  const sideways = !(near(widthMm, media.widthMm) && near(heightMm, media.lengthMm));
  const [across, along] = media.dots.map((d) => d / BROTHER_DPM);
  const printW = sideways ? along : across;
  const printH = sideways ? across : along;
  return { x: Math.max(0, (widthMm - printW) / 2), y: Math.max(0, (heightMm - printH) / 2) };
}

// --- Which printer ----------------------------------------------------------

export interface PrinterChoice {
  printer: Printer;
  fits: boolean;
  note: string; // why it can't print this, or what's loaded
}

// Every printer for a label of this size, best first: those with the
// right stock in, this device's own printer first, then printers in the
// same place as it, then the default.
export function printerChoices(size: LabelSize | null, config: PrintingConfig, preferredId: string | null): PrinterChoice[] {
  const sizeById = new Map(config.sizes.map((s) => [s.id, s]));
  const preferred = config.printers.find((p) => p.id === preferredId);
  const choices = config.printers.map((printer) => {
    const loaded = sizeById.get(printer.sizeId);
    const media = brotherMedia(size?.brother);
    let fits = false;
    let note = loaded ? `${loaded.name} loaded` : "Nothing loaded";
    if (!printer.enabled) note = "Turned off";
    else if (!printer.host) note = "No address set";
    else if (!size?.brother) note = "This size prints from a PDF";
    else if (media?.wideOnly && printer.model !== "QL-1050" && printer.model !== "QL-1060N") note = `${printer.model} can't take ${media.widthMm}mm stock`;
    else if (loaded?.brother !== size.brother) note = loaded ? `Has ${loaded.name} loaded` : "Nothing loaded";
    else fits = true;
    return { printer, fits, note };
  });
  const rank = (c: PrinterChoice) =>
    (c.fits ? 0 : 100) +
    (c.printer.id === preferredId ? 0 : preferred && preferred.locationId && c.printer.locationId === preferred.locationId ? 1 : c.printer.isDefault ? 2 : 3);
  return choices.sort((a, b) => rank(a) - rank(b) || a.printer.name.localeCompare(b.printer.name));
}

// This device's own printer ("the bench PC prints at Bay 3"), per
// organisation, in this browser only.
const PREF_KEY = () => `r2.printer.${currentOrgId()}`;

export function preferredPrinterId(): string | null {
  try {
    return localStorage.getItem(PREF_KEY());
  } catch {
    return null;
  }
}

export function setPreferredPrinterId(id: string | null) {
  try {
    if (id) localStorage.setItem(PREF_KEY(), id);
    else localStorage.removeItem(PREF_KEY());
  } catch {
    // Not remembered, that's all.
  }
}
