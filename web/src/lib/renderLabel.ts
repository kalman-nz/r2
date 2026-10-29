import * as bwipjs from "bwip-js/browser";
import {
  applyFolderLevels,
  type InkColor,
  type LabelDataContext,
  type LabelElement,
  type LabelFont,
  type LabelTemplateData,
} from "./labelSpec";

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
//
// canvasWidth/canvasHeight fix the canvas's exact pixel size (a Brother
// die-cut label's printable area) with the design centred on it.
export async function renderLabelToCanvas(
  template: Pick<LabelTemplateData, "widthMm" | "heightMm" | "elements">,
  context: LabelDataContext,
  scalePxPerMm: number,
  frame?: { canvasWidth?: number; canvasHeight?: number },
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  const designW = template.widthMm * scalePxPerMm;
  const designH = template.heightMm * scalePxPerMm;
  canvas.width = Math.max(1, frame?.canvasWidth ?? Math.round(designW));
  canvas.height = Math.max(1, frame?.canvasHeight ?? Math.round(designH));
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
  if (frame?.canvasWidth || frame?.canvasHeight) ctx.translate((canvas.width - designW) / 2, (canvas.height - designH) / 2);

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

// Canvas font families for each LabelFont. "system" is the plain
// sans-serif every template used before fonts were selectable.
const FONT_FAMILIES: Record<LabelFont, { family: string; stretch?: string }> = {
  system: { family: "sans-serif" },
  archivo: { family: '"Archivo Variable", Arial, sans-serif' },
  condensed: { family: '"Archivo Variable", "Arial Narrow", sans-serif', stretch: "condensed" },
  mono: { family: '"IBM Plex Mono", Menlo, monospace' },
  serif: { family: 'Georgia, "Times New Roman", serif' },
};

// The CSS font shorthand for a text element at a pixel size.
export function fontFor(el: Pick<LabelElement, "bold" | "italic" | "font">, sizePx: number): string {
  const { family, stretch } = FONT_FAMILIES[el.font ?? "system"] ?? FONT_FAMILIES.system;
  return `${el.italic ? "italic " : ""}${el.bold ? "bold " : ""}${stretch ? `${stretch} ` : ""}${sizePx}px ${family}`;
}

// Web fonts load lazily — a canvas drawing with one that isn't loaded yet
// silently falls back, so the print could differ from the preview.
async function ensureFont(font: string) {
  try {
    if (!document.fonts.check(font)) await document.fonts.load(font);
  } catch {
    // Unknown font string — the fallback family is fine.
  }
}

const INK: Record<InkColor, string> = { black: "#000", white: "#fff" };

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius > 0) ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
}

function applyStroke(ctx: CanvasRenderingContext2D, el: LabelElement, scalePxPerMm: number): boolean {
  const stroke = el.stroke ?? "black";
  if (stroke === "none") return false;
  const lineWidth = Math.max(0, (el.strokeWidth ?? 0.5) * scalePxPerMm);
  if (lineWidth === 0) return false;
  ctx.strokeStyle = INK[stroke];
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(el.dashed ? [lineWidth * 3, lineWidth * 2] : []);
  return true;
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

  if (el.type === "rect" || el.type === "ellipse") {
    if (el.type === "rect") roundedRectPath(ctx, x, y, w, h, (el.cornerRadius ?? 0) * scalePxPerMm);
    else {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
    const fill = el.fill ?? "none";
    if (fill !== "none") {
      ctx.fillStyle = INK[fill];
      ctx.fill();
    }
    // Stroke inside the box so a 1mm border on a full-size box doesn't
    // fall half off the label.
    if (applyStroke(ctx, el, scalePxPerMm)) {
      const inset = ctx.lineWidth / 2;
      if (el.type === "rect") {
        roundedRectPath(ctx, x + inset, y + inset, w - 2 * inset, h - 2 * inset, (el.cornerRadius ?? 0) * scalePxPerMm - inset);
      } else {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    return;
  }

  if (el.type === "line") {
    // A line runs along the box's width, through its middle — rotate the
    // box for a vertical or angled line.
    if (applyStroke(ctx, el, scalePxPerMm)) {
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
    }
    return;
  }

  if (el.type === "text" || el.type === "staticText") {
    if (el.inverted) {
      ctx.fillStyle = INK.black;
      roundedRectPath(ctx, x, y, w, h, (el.cornerRadius ?? 0) * scalePxPerMm);
      ctx.fill();
    }
    const value = valueFor(el, context);
    if (!value) return;
    const fontSizePx = (el.fontSize ?? 4) * scalePxPerMm;
    ctx.font = fontFor(el, fontSizePx);
    await ensureFont(ctx.font);
    ctx.font = fontFor(el, fontSizePx);
    ctx.fillStyle = INK[el.inverted ? "white" : (el.color ?? "black")];

    const paddingPx = (el.padding ?? 0) * scalePxPerMm;
    const innerX = x + paddingPx;
    const innerY = y + paddingPx;
    const innerW = Math.max(0, w - 2 * paddingPx);
    const innerH = Math.max(0, h - 2 * paddingPx);

    const align = el.align ?? "left";
    ctx.textAlign = align;
    const anchorX = align === "left" ? innerX : align === "right" ? innerX + innerW : innerX + innerW / 2;

    const lineHeight = fontSizePx * (el.lineHeight ?? 1.2);
    let lines: string[];
    if (el.wrap) {
      const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
      lines = wrapText(ctx, value, innerW, el.breakWords ?? true).slice(0, maxLines);
    } else {
      lines = [value]; // single line — fillText's maxWidth below squishes it to fit instead of wrapping
    }

    const valign = el.valign ?? "top";
    const blockHeight = el.wrap ? (lines.length - 1) * lineHeight + fontSizePx : fontSizePx;
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
  } catch {
    // Value isn't encodable for this symbology (e.g. empty/unsupported
    // characters) — leave the space blank rather than breaking the render.
    return;
  }

  if (el.type === "qr") {
    // A stretched QR code doesn't scan — always draw it square, centred.
    const side = Math.min(w, h);
    ctx.drawImage(scratch, x + (w - side) / 2, y + (h - side) / 2, side, side);
    return;
  }

  if (!el.showText) {
    ctx.drawImage(scratch, x, y, w, h);
    return;
  }
  // Bars on top, the value in small monospaced text underneath.
  const textPx = Math.min(h * 0.3, (el.fontSize ?? 2.5) * scalePxPerMm);
  const gap = textPx * 0.2;
  ctx.drawImage(scratch, x, y, w, Math.max(1, h - textPx - gap));
  ctx.font = `${textPx}px "IBM Plex Mono", Menlo, monospace`;
  await ensureFont(ctx.font);
  ctx.font = `${textPx}px "IBM Plex Mono", Menlo, monospace`;
  ctx.fillStyle = INK.black;
  ctx.textAlign = "center";
  ctx.fillText(value, x + w / 2, y + h - textPx, w);
}
