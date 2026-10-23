import * as bwipjs from "bwip-js/browser";
import { applyFolderLevels, type LabelDataContext, type LabelElement, type LabelTemplateData } from "./labelSpec";

// Decoding the same data: URL on every render (the editor re-renders on
// every drag frame) would be wasteful — images are content-addressed by
// their own data, so caching by that string is always safe.
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(dataUrl);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(dataUrl, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = dataUrl;
  });
}

// The one and only place label pixels get drawn — used both for the live
// editor preview (at editor scale) and the final print export (at the
// printer's exact dots-per-mm), so what you design is what prints.
export async function renderLabelToCanvas(
  template: Pick<LabelTemplateData, "widthMm" | "heightMm" | "elements">,
  context: LabelDataContext,
  scalePxPerMm: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(template.widthMm * scalePxPerMm));
  canvas.height = Math.max(1, Math.round(template.heightMm * scalePxPerMm));
  // Every caller reads this canvas back via toDataURL() right after
  // rendering (print export, or just grabbing pixels). Without this hint
  // the browser defaults to a GPU-backed canvas, and reading pixels back
  // out of a GPU-backed canvas is a known crash path on some Windows
  // Chrome/Edge GPU driver combos — the whole page goes black and needs a
  // reload, print still succeeds because the crash is purely client-side
  // rendering, after the image data was already generated. Forcing a
  // software-backed canvas here sidesteps the GPU path entirely.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.textBaseline = "top";

  for (const el of template.elements) {
    await drawElement(ctx, el, context, scalePxPerMm);
  }

  return canvas;
}

// Rotates a whole rendered canvas 90°/270° (swapping its width/height) —
// used for the custom "big text" label's rotate option. Simpler and safer
// than trying to rotate text layout in place: the source canvas is rendered
// normally at swapped dimensions (so word-wrap sees the right width), then
// the finished image is rotated as a single unit into the label's actual
// physical width/height.
export function rotateCanvas90(source: HTMLCanvasElement): HTMLCanvasElement {
  const rotated = document.createElement("canvas");
  rotated.width = source.height;
  rotated.height = source.width;
  const ctx = rotated.getContext("2d", { willReadFrequently: true });
  if (!ctx) return rotated;
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return rotated;
}

// Greedy word wrap. breakWords=true (the default, and old behavior)
// force-splits a single very-long word (no spaces) by character instead of
// overflowing, since asset codes/serials sometimes have no natural break
// point — but applied to a normal word that just doesn't fit at the chosen
// font size, that's what produces an ugly mid-word break like "Blackmagic
// Design" -> "Blackmagic Desi" / "gn". breakWords=false leaves such a word
// as its own (over-length) line instead; fillText's maxWidth then condenses
// it to fit rather than cutting it.
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  breakWords = true,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      if (ctx.measureText(word).width <= maxWidth || !breakWords) {
        current = word;
        continue;
      }
      let chunk = "";
      for (const ch of word) {
        if (!chunk || ctx.measureText(chunk + ch).width <= maxWidth) {
          chunk += ch;
        } else {
          lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    }
    lines.push(current);
  }
  return lines;
}

function valueFor(el: LabelElement, context: LabelDataContext): string {
  // Static text, or a barcode/QR on a one-off label, holds its own value.
  if (el.type === "staticText" || !el.dataField) return el.text ?? "";
  const raw = context[el.dataField] ?? "";
  if (el.dataField === "equipmentFolder") return applyFolderLevels(raw, el.folderLevels);
  return raw;
}

async function drawElement(
  ctx: CanvasRenderingContext2D,
  el: LabelElement,
  context: LabelDataContext,
  scalePxPerMm: number,
) {
  const rotation = el.rotation ?? 0;
  ctx.save();
  try {
    if (rotation !== 0) {
      const cx = (el.x + el.width / 2) * scalePxPerMm;
      const cy = (el.y + el.height / 2) * scalePxPerMm;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    await drawElementContent(ctx, el, context, scalePxPerMm);
  } finally {
    ctx.restore();
  }
}

async function drawElementContent(
  ctx: CanvasRenderingContext2D,
  el: LabelElement,
  context: LabelDataContext,
  scalePxPerMm: number,
) {
  const x = el.x * scalePxPerMm;
  const y = el.y * scalePxPerMm;
  const w = el.width * scalePxPerMm;
  const h = el.height * scalePxPerMm;

  if (el.type === "text" || el.type === "staticText") {
    const value = valueFor(el, context);
    if (!value) return;
    const fontSizePx = (el.fontSize ?? 4) * scalePxPerMm;
    ctx.font = `${el.bold ? "bold " : ""}${fontSizePx}px sans-serif`;

    const paddingPx = (el.padding ?? 0) * scalePxPerMm;
    const innerX = x + paddingPx;
    const innerY = y + paddingPx;
    const innerW = Math.max(0, w - 2 * paddingPx);
    const innerH = Math.max(0, h - 2 * paddingPx);

    const align = el.align ?? "left";
    ctx.textAlign = align;
    const anchorX = align === "left" ? innerX : align === "right" ? innerX + innerW : innerX + innerW / 2;

    const lineHeight = fontSizePx * 1.2;
    let lines: string[];
    if (el.wrap) {
      const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
      lines = wrapText(ctx, value, innerW, el.breakWords ?? true).slice(0, maxLines);
    } else {
      lines = [value]; // single line — fillText's maxWidth below squishes it to fit instead of wrapping
    }

    const valign = el.valign ?? "top";
    const blockHeight = el.wrap ? lines.length * lineHeight : fontSizePx;
    const startY =
      valign === "middle"
        ? innerY + Math.max(0, (innerH - blockHeight) / 2)
        : valign === "bottom"
          ? innerY + Math.max(0, innerH - blockHeight)
          : innerY;

    for (const [i, line] of lines.entries()) {
      ctx.fillText(line, anchorX, startY + i * lineHeight, innerW);
    }
    return;
  }

  if (el.type === "image") {
    if (!el.imageData) return;
    try {
      const img = await loadImage(el.imageData);
      ctx.drawImage(img, x, y, w, h);
    } catch {
      // Corrupt/unreadable image data — leave the space blank.
    }
    return;
  }

  // barcode / qr
  const value = valueFor(el, context);
  if (!value) return;
  const scratch = document.createElement("canvas");
  try {
    bwipjs.toCanvas(scratch, {
      bcid: el.type === "qr" ? "qrcode" : "code128",
      text: value,
      includetext: false,
      scale: 3,
      ...(el.type === "barcode" ? { height: 10 } : {}),
    });
    ctx.drawImage(scratch, x, y, w, h);
  } catch {
    // Value isn't encodable for this symbology (e.g. empty/unsupported
    // characters) — leave the space blank rather than breaking the render.
  }
}
