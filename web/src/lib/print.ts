import { api, type Item } from "./api";
import { saveFile } from "./download";
import {
  buildItemLabelContext,
  buildLabelContext,
  dotsPerMm,
  labelIdForWidth,
  SAMPLE_CONTEXT,
  type LabelDataContext,
  type LabelTemplateData,
  type LabelUnit,
} from "./labelSpec";

// The label renderer (Konva + the barcode library) is most of the app's
// weight, and only needed once someone prints, so it loads on first use —
// the scan page on a phone never downloads it.
async function renderToDataUrl(
  template: LabelTemplateData & { id: string },
  context: LabelDataContext,
): Promise<string> {
  const { renderLabelToCanvas } = await import("./renderLabel");
  const canvas = await renderLabelToCanvas(template, context, dotsPerMm(template.widthMm));
  return canvas.toDataURL("image/png");
}

// Renders-only, for a preview step before committing to print — see
// LabelPreviewModal, PrintButton, BatchPrintBar.
export function renderContextImage(context: LabelDataContext, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, context);
}

export function renderUnitLabelImage(unit: LabelUnit, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, buildLabelContext(unit));
}

export function renderItemLabelImage(item: Item, categoryPath: string, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, buildItemLabelContext(item, categoryPath));
}

// Sends an already-rendered image straight to the printer — used once a
// preview has been confirmed, so repeat copies don't re-render the canvas.
export function sendRenderedLabel(
  imageDataUrl: string,
  template: LabelTemplateData & { id: string },
  serialId?: string,
): Promise<{ ok: boolean; message: string }> {
  return api.print({ templateId: template.id, serialId, imageDataUrl, label: labelIdForWidth(template.widthMm) });
}

// Shared by every "print a template against some data" path — a specific
// unit (serialId set, so the print log can name it), an item type or
// hand-typed values (omitted).
export async function printRecord(
  context: LabelDataContext,
  template: LabelTemplateData & { id: string },
  serialId?: string,
): Promise<{ ok: boolean; message: string }> {
  const imageDataUrl = await renderToDataUrl(template, context);
  return sendRenderedLabel(imageDataUrl, template, serialId);
}

// A real saved template, but the field values are typed in by hand instead
// of pulled from a real asset — see CustomLabelPage's "From template" mode.
export function printWithManualData(template: LabelTemplateData & { id: string }, context: LabelDataContext) {
  return printRecord(context, template);
}

// Renders a saved template filled with hand-typed values (CustomLabelPage).
export function renderTemplateImage(template: LabelTemplateData & { id: string }, context: LabelDataContext) {
  return renderToDataUrl(template, context);
}

export async function renderCustomTextImage(text: string, widthMm: number, heightMm: number, rotate90: boolean) {
  const { renderCustomTextCanvas } = await import("./customLabel");
  const canvas = await renderCustomTextCanvas(text, widthMm, heightMm, dotsPerMm(widthMm), rotate90, SAMPLE_CONTEXT);
  return canvas.toDataURL("image/png");
}

// One PDF page per label at its real size, for printers other than the
// networked Brother (Zebra, Dymo, a Brother over USB) — see /api/labels/pdf.
export async function downloadLabelsPdf(labels: { imageDataUrl: string; widthMm: number; heightMm: number; copies: number }[]) {
  saveFile(await api.labelsPdf(labels));
}

// Not tied to any unit — for labelling cases, shelves, areas, etc.
// with arbitrary big text instead of pulling from a specific serial number.
export async function printCustomText(
  text: string,
  widthMm: number,
  heightMm: number,
  rotate90: boolean,
): Promise<{ ok: boolean; message: string }> {
  const { renderCustomTextCanvas } = await import("./customLabel");
  const canvas = await renderCustomTextCanvas(text, widthMm, heightMm, dotsPerMm(widthMm), rotate90, SAMPLE_CONTEXT);
  const imageDataUrl = canvas.toDataURL("image/png");
  return api.print({ customText: text, imageDataUrl, label: labelIdForWidth(widthMm) });
}
