import { api, type PrintResult } from "./api";
import { saveFile } from "./download";
import { SAMPLE_CONTEXT, type LabelDataContext, type LabelTemplateData } from "./labelSpec";
import { printGeometry, type LabelSize, type Printer } from "./printing";

type Design = Pick<LabelTemplateData, "widthMm" | "heightMm" | "elements">;

// How many copies of a label can be asked for at once: whole, 1 to 999, the
// same as the PDF route (routes_pdf.pb.js) takes.
export const COPIES = { min: 1, max: 999, integer: true };

// The label renderer (the barcode library and fonts) is most of the app's
// weight and only needed once someone prints, so it loads on first use —
// the scan page on a phone never downloads it.
const renderer = () => import("./renderLabel");

// For looking at, not printing: the design as it is, at screen resolution.
export async function renderPreview(design: Design, context: LabelDataContext, scale = 10): Promise<string> {
  const { renderLabelToCanvas } = await renderer();
  return (await renderLabelToCanvas(design, context, scale)).toDataURL("image/png");
}

// Exactly what a Brother with this stock in needs: the tape's or label's
// printable pixels, turned if the design is sideways to it.
export async function renderForPrinter(design: Design, context: LabelDataContext, size: LabelSize | null) {
  const { renderLabelToCanvas, rotateCanvas90 } = await renderer();
  const geometry = printGeometry(design, size);
  const canvas = await renderLabelToCanvas(design, context, geometry.scale, {
    canvasWidth: geometry.canvasWidth,
    canvasHeight: geometry.canvasHeight,
  });
  return { image: (geometry.rotate ? rotateCanvas90(canvas) : canvas).toDataURL("image/png"), label: geometry.label };
}

// For a PDF page at the design's real size (any printer with a driver).
export async function renderForPdf(design: Design, context: LabelDataContext): Promise<string> {
  const { renderLabelToCanvas } = await renderer();
  return (await renderLabelToCanvas(design, context, 300 / 25.4)).toDataURL("image/png");
}

// What the print log records: a template (and the unit, if one) or a
// one-off label's text.
export type PrintJob = { templateId: string; serialId?: string } | { customText: string };

export interface SendResult extends PrintResult {
  printer: string; // the printer that took it, or the last one tried
  skipped: Printer[]; // printers tried first that couldn't be reached
}

// Tries each printer in turn, moving on only when one can't be reached —
// any other failure (a bad label) would fail on the next printer too.
export async function sendToPrinters(job: PrintJob, image: string, label: string, chain: Printer[]): Promise<SendResult> {
  const skipped: Printer[] = [];
  let last: PrintResult = { ok: false, message: "No printer to send it to" };
  for (const printer of chain) {
    last = await api.print({ ...job, imageDataUrl: image, label, printerId: printer.id });
    if (last.ok || !last.unreachable) return { ...last, printer: printer.name, skipped };
    skipped.push(printer);
  }
  return { ...last, printer: chain[chain.length - 1]?.name ?? "", skipped };
}

// The print log names a one-off label by its text, e.g. Printed custom label "Jam Stands".
export function designText(design: Design): string {
  const text = design.elements
    .filter((el) => el.type === "staticText" && el.text?.trim())
    .map((el) => el.text!.trim().replace(/\s+/g, " "))
    .join(" / ");
  return text || "Custom label";
}

// One PDF page per label at its real size, for printers other than the
// networked Brothers (Zebra, Dymo, a Brother over USB) — see /api/labels/pdf.
export async function downloadLabelsPdf(labels: { imageDataUrl: string; widthMm: number; heightMm: number; copies: number }[]) {
  saveFile(await api.labelsPdf(labels));
}

// A test label for one printer, sized to the stock loaded in it.
export async function printTestLabel(printer: Printer, size: LabelSize | null): Promise<PrintResult> {
  const { buildCustomTextTemplate } = await import("./customLabel");
  const widthMm = size?.widthMm ?? 62;
  const lengthMm = size?.lengthMm ?? 29;
  // Wide-and-short reads best on tape, so lay it across the stock.
  const [w, h] = size?.continuous && widthMm < 40 ? [Math.max(lengthMm, 50), widthMm] : [widthMm, lengthMm];
  const text = `${printer.name}\n${new Date().toLocaleString()}`;
  const template = buildCustomTextTemplate(text, w, h);
  const { image, label } = await renderForPrinter(template, SAMPLE_CONTEXT, size);
  if (!label) return { ok: false, message: "The loaded label size isn't Brother stock" };
  return api.print({ customText: `Test label for ${printer.name}`, imageDataUrl: image, label, printerId: printer.id });
}
