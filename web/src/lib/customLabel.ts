import { fontFor, renderLabelToCanvas, rotateCanvas90, wrapText } from "./renderLabel";
import type { LabelDataContext, LabelElement, LabelTemplateData } from "./labelSpec";

export const PADDING_MM = 3;
// Purely for text measurement precision — any consistent scale works here
// since we're solving for the mm font size, independent of final print
// resolution (the real render applies its own dots-per-mm separately).
const MEASURE_SCALE = 20;

function longestWordWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    max = Math.max(max, ctx.measureText(word).width);
  }
  return max;
}

// Finds the largest font size (mm) whose word-wrapped text still fits
// within the label — "big text, readable from a distance" means using as
// much of the label as the text allows, not a fixed size that's too small
// for a short label or overflows a long one.
// `style` measures with a text element's own font and line height; left
// out, it's bold sans-serif with the custom label's padding.
export function fitFontSizeMm(
  text: string,
  widthMm: number,
  heightMm: number,
  style: Pick<LabelElement, "bold" | "italic" | "font" | "lineHeight" | "padding"> = { bold: true, padding: PADDING_MM },
): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 8;

  const paddingMm = style.padding ?? 0;
  const innerW = (widthMm - paddingMm * 2) * MEASURE_SCALE;
  const innerH = (heightMm - paddingMm * 2) * MEASURE_SCALE;
  const maxSizeMm = Math.max(2, Math.min(heightMm, 40));

  // Two passes: first only accept a size if every word fits on a line by
  // itself, so wrapping never has to break one mid-word (e.g. "Blackmagic
  // Design" wrapping as "Blackmagic Desi" / "gn") — wrapText's char-split
  // fallback technically avoids overflow, so without this check the search
  // below would happily pick a size that "fits" only because it mangled a
  // word. Only if nothing in range achieves a clean fit (a single unbroken
  // string longer than the label at even the smallest size) fall back to
  // allowing a split, rather than never rendering at all.
  for (const allowWordBreaks of [false, true]) {
    for (let sizeMm = maxSizeMm; sizeMm >= 2; sizeMm -= 0.5) {
      const fontPx = sizeMm * MEASURE_SCALE;
      ctx.font = fontFor(style, fontPx);
      if (!allowWordBreaks && longestWordWidth(ctx, text) > innerW) continue;
      const lines = wrapText(ctx, text, innerW);
      const lineHeight = fontPx * (style.lineHeight ?? 1.2);
      const blockHeight = lines.length * lineHeight;
      const longestLine = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (blockHeight <= innerH && longestLine <= innerW) return sizeMm;
    }
  }
  return 2;
}

// A one-off, unsaved template — the whole label is a single big centered
// staticText element sized to fill it. Not persisted to label_templates;
// see /api/print's customText path in server/src/routes/print.ts.
export function buildCustomTextTemplate(text: string, widthMm: number, heightMm: number): LabelTemplateData {
  const element: LabelElement = {
    id: "custom-text",
    type: "staticText",
    x: 0,
    y: 0,
    width: widthMm,
    height: heightMm,
    text,
    fontSize: fitFontSizeMm(text, widthMm, heightMm),
    bold: true,
    align: "center",
    valign: "middle",
    wrap: true,
    // Typed over, or the label made smaller, it still fits.
    shrink: true,
    padding: PADDING_MM,
  };
  return { name: "Custom text", widthMm, heightMm, elements: [element] };
}

// Renders the custom-text label at the label's actual physical
// widthMm×heightMm, optionally rotated 90°. Rotating text layout in place
// (the per-element `rotation` property used elsewhere) would wrap it using
// the un-rotated width, overflowing the physical label — instead this
// builds and renders the text normally at swapped dimensions (so wrapping
// sees the right available width) and rotates the finished image as a
// single unit back into the label's real footprint.
export async function renderCustomTextCanvas(
  text: string,
  widthMm: number,
  heightMm: number,
  scalePxPerMm: number,
  rotate90: boolean,
  context: LabelDataContext,
): Promise<HTMLCanvasElement> {
  const renderW = rotate90 ? heightMm : widthMm;
  const renderH = rotate90 ? widthMm : heightMm;
  const template = buildCustomTextTemplate(text, renderW, renderH);
  const canvas = await renderLabelToCanvas(template, context, scalePxPerMm);
  return rotate90 ? rotateCanvas90(canvas) : canvas;
}
