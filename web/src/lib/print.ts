import { api, type Equipment, type RentmanRecord, type SerialNumber } from "./api";
import { renderLabelToCanvas } from "./renderLabel";
import { renderCustomTextCanvas } from "./customLabel";
import {
  buildEquipmentLabelContext,
  buildLabelContext,
  dotsPerMm,
  labelIdForWidth,
  SAMPLE_CONTEXT,
  type LabelDataContext,
  type LabelTemplateData,
} from "./labelSpec";

export type PrintableAsset = SerialNumber & { _lastSubproject?: RentmanRecord | null };
export type PrintableEquipment = Equipment & { _folder?: RentmanRecord | null };

async function renderToDataUrl(
  template: LabelTemplateData & { id: string },
  context: LabelDataContext,
): Promise<string> {
  const canvas = await renderLabelToCanvas(template, context, dotsPerMm(template.widthMm));
  return canvas.toDataURL("image/png");
}

// Renders-only, for a preview step before committing to print — see
// LabelPreviewModal, PrintButton, BatchPrintBar.
export function renderContextImage(context: LabelDataContext, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, context);
}

export function renderAssetLabelImage(asset: PrintableAsset, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, buildLabelContext(asset));
}

export function renderEquipmentLabelImage(equipment: PrintableEquipment, template: LabelTemplateData & { id: string }) {
  return renderToDataUrl(template, buildEquipmentLabelContext(equipment));
}

// Sends an already-rendered image straight to the printer — used once a
// preview has been confirmed, so repeat copies don't re-render the canvas.
export function sendRenderedLabel(
  imageDataUrl: string,
  template: LabelTemplateData & { id: string },
  rentmanSerialNumberId?: string,
): Promise<{ ok: boolean; message: string }> {
  return api.print({ templateId: template.id, rentmanSerialNumberId, imageDataUrl, label: labelIdForWidth(template.widthMm) });
}

// Shared by every "print a template against some data" path — a specific
// serial (rentmanSerialNumberId set), an equipment type or hand-typed
// values (omitted).
export async function printRecord(
  context: LabelDataContext,
  template: LabelTemplateData & { id: string },
  rentmanSerialNumberId?: string,
): Promise<{ ok: boolean; message: string }> {
  const imageDataUrl = await renderToDataUrl(template, context);
  return sendRenderedLabel(imageDataUrl, template, rentmanSerialNumberId);
}

export function printAsset(asset: PrintableAsset, template: LabelTemplateData & { id: string }) {
  return printRecord(buildLabelContext(asset), template, String(asset.id));
}

export function printEquipment(equipment: PrintableEquipment, template: LabelTemplateData & { id: string }) {
  return printRecord(buildEquipmentLabelContext(equipment), template);
}

// A real saved template, but the field values are typed in by hand instead
// of pulled from a real asset — see CustomLabelPage's "From template" mode.
export function printWithManualData(template: LabelTemplateData & { id: string }, context: LabelDataContext) {
  return printRecord(context, template);
}

// Not tied to any Rentman asset — for labeling cases, shelves, areas, etc.
// with arbitrary big text instead of pulling from a specific serial number.
export async function printCustomText(
  text: string,
  widthMm: number,
  heightMm: number,
  rotate90: boolean,
): Promise<{ ok: boolean; message: string }> {
  const canvas = await renderCustomTextCanvas(text, widthMm, heightMm, dotsPerMm(widthMm), rotate90, SAMPLE_CONTEXT);
  const imageDataUrl = canvas.toDataURL("image/png");
  return api.print({ customText: text, imageDataUrl, label: labelIdForWidth(widthMm) });
}
