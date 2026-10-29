import type { LabelElement } from "./labelSpec";

// Geometry for the label designer. Elements store their unrotated box
// (x, y, width, height in mm) plus a rotation around the box's centre, so
// anything that lines things up works from the box's on-screen bounds.

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Box = Pick<LabelElement, "x" | "y" | "width" | "height" | "rotation">;

// Keeps stored numbers tidy (no 12.300000000004mm) — 0.01mm is far finer
// than any label printer.
export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return roundMm(a === 360 ? 0 : a);
}

export function rotateVec(vx: number, vy: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
}

export function centerOf(el: Box): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

// The axis-aligned box a (possibly rotated) element covers on the label.
export function boundsOf(el: Box): Bounds {
  const rotation = el.rotation ?? 0;
  const c = centerOf(el);
  if (rotation % 180 === 0) {
    return { left: el.x, top: el.y, right: el.x + el.width, bottom: el.y + el.height };
  }
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => rotateVec((sx * el.width) / 2, (sy * el.height) / 2, rotation));
  const xs = corners.map((p) => c.x + p.x);
  const ys = corners.map((p) => c.y + p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  return {
    left: Math.min(...list.map((b) => b.left)),
    top: Math.min(...list.map((b) => b.top)),
    right: Math.max(...list.map((b) => b.right)),
    bottom: Math.max(...list.map((b) => b.bottom)),
  };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// --- Snapping -------------------------------------------------------------

export interface SnapTargets {
  x: number[]; // vertical lines (mm from left)
  y: number[]; // horizontal lines (mm from top)
}

export interface Guide {
  axis: "x" | "y";
  at: number; // mm
}

// Lines worth snapping to: the label's edges and centre, its margin, and
// the edges and centres of every element that isn't being moved.
export function snapTargets(
  widthMm: number,
  heightMm: number,
  others: LabelElement[],
  marginMm: number,
): SnapTargets {
  const x = [0, widthMm / 2, widthMm];
  const y = [0, heightMm / 2, heightMm];
  if (marginMm > 0) {
    x.push(marginMm, widthMm - marginMm);
    y.push(marginMm, heightMm - marginMm);
  }
  for (const el of others) {
    const b = boundsOf(el);
    x.push(b.left, (b.left + b.right) / 2, b.right);
    y.push(b.top, (b.top + b.bottom) / 2, b.bottom);
  }
  return { x, y };
}

// The smallest shift (within `threshold`) that puts one of `edges` on one
// of `targets`, and every target line that shift lands on.
function bestSnap(edges: number[], targets: number[], threshold: number): { delta: number; lines: number[] } | null {
  let best: number | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const d = target - edge;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return null;
  const delta = best;
  const lines = new Set<number>();
  for (const edge of edges) {
    for (const target of targets) {
      if (Math.abs(target - (edge + delta)) < 0.01) lines.add(roundMm(target));
    }
  }
  return { delta, lines: [...lines] };
}

// Moving: snap the moved bounds' edges/centre to the targets. Falls back to
// the grid (on the bounds' top-left corner) on an axis with no object snap.
export function snapMove(
  moved: Bounds,
  targets: SnapTargets | null,
  thresholdMm: number,
  gridMm: number | null,
): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  const sx = targets && bestSnap([moved.left, (moved.left + moved.right) / 2, moved.right], targets.x, thresholdMm);
  const sy = targets && bestSnap([moved.top, (moved.top + moved.bottom) / 2, moved.bottom], targets.y, thresholdMm);
  if (sx) {
    dx = sx.delta;
    guides.push(...sx.lines.map((at) => ({ axis: "x" as const, at })));
  } else if (gridMm) {
    dx = Math.round(moved.left / gridMm) * gridMm - moved.left;
  }
  if (sy) {
    dy = sy.delta;
    guides.push(...sy.lines.map((at) => ({ axis: "y" as const, at })));
  } else if (gridMm) {
    dy = Math.round(moved.top / gridMm) * gridMm - moved.top;
  }
  return { dx, dy, guides };
}

// Resizing: snap one moving edge to the targets, or the grid.
export function snapEdge(
  edge: number,
  axis: "x" | "y",
  targets: SnapTargets | null,
  thresholdMm: number,
  gridMm: number | null,
): { edge: number; guide: Guide | null } {
  const s = targets && bestSnap([edge], targets[axis], thresholdMm);
  if (s) return { edge: edge + s.delta, guide: { axis, at: roundMm(edge + s.delta) } };
  if (gridMm) return { edge: Math.round(edge / gridMm) * gridMm, guide: null };
  return { edge, guide: null };
}

// --- Resizing -------------------------------------------------------------

// Which handle is being dragged: -1/0/1 on each axis, in the box's own
// (unrotated) frame — (1, 1) is the bottom-right corner, (0, -1) the top edge.
export interface Handle {
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
}

export const HANDLES: Handle[] = [
  { hx: -1, hy: -1 },
  { hx: 0, hy: -1 },
  { hx: 1, hy: -1 },
  { hx: 1, hy: 0 },
  { hx: 1, hy: 1 },
  { hx: 0, hy: 1 },
  { hx: -1, hy: 1 },
  { hx: -1, hy: 0 },
];

const MIN_SIZE_MM = 0.5;

// Resizes from a handle by a pointer movement (dx, dy in label mm). The
// side or corner opposite the handle stays put on the label even when the
// element is rotated; fromCenter grows it evenly about its centre instead.
// keepAspect holds the starting width:height ratio.
export function resizeFromHandle(
  orig: Box,
  handle: Handle,
  dx: number,
  dy: number,
  opts: {
    keepAspect: boolean;
    fromCenter: boolean;
    snap?: (edge: number, axis: "x" | "y") => number;
  },
): { x: number; y: number; width: number; height: number } {
  const rotation = orig.rotation ?? 0;
  // The pointer movement in the box's own frame.
  const local = rotateVec(dx, dy, -rotation);
  const factor = opts.fromCenter ? 2 : 1;
  let width = orig.width + handle.hx * local.x * factor;
  let height = orig.height + handle.hy * local.y * factor;

  // Snapping only makes sense when the box's edges are the label's x/y
  // lines — i.e. it isn't rotated (or is upside down).
  const c0 = centerOf(orig);
  if (opts.snap && rotation % 180 === 0 && !opts.keepAspect) {
    const flip = rotation === 180 ? -1 : 1;
    if (handle.hx !== 0) {
      const sign = handle.hx * flip;
      const fixed = opts.fromCenter ? c0.x : c0.x - (sign * orig.width) / 2;
      const moving = opts.fromCenter ? c0.x + (sign * width) / 2 : fixed + sign * width;
      const snapped = opts.snap(moving, "x");
      width = (Math.abs(snapped - fixed) * (opts.fromCenter ? 2 : 1));
    }
    if (handle.hy !== 0) {
      const sign = handle.hy * flip;
      const fixed = opts.fromCenter ? c0.y : c0.y - (sign * orig.height) / 2;
      const moving = opts.fromCenter ? c0.y + (sign * height) / 2 : fixed + sign * height;
      const snapped = opts.snap(moving, "y");
      height = Math.abs(snapped - fixed) * (opts.fromCenter ? 2 : 1);
    }
  }

  width = Math.max(MIN_SIZE_MM, width);
  height = Math.max(MIN_SIZE_MM, height);

  if (opts.keepAspect && orig.height > 0) {
    const ratio = orig.width / orig.height;
    if (handle.hx === 0) width = height * ratio;
    else if (handle.hy === 0) height = width / ratio;
    else if (Math.abs(width / orig.width) >= Math.abs(height / orig.height)) height = width / ratio;
    else width = height * ratio;
  }

  let center = c0;
  if (!opts.fromCenter) {
    // The point opposite the handle, in label coordinates, stays fixed.
    const anchorOld = rotateVec((-handle.hx * orig.width) / 2, (-handle.hy * orig.height) / 2, rotation);
    const anchor = { x: c0.x + anchorOld.x, y: c0.y + anchorOld.y };
    const anchorNew = rotateVec((-handle.hx * width) / 2, (-handle.hy * height) / 2, rotation);
    center = { x: anchor.x - anchorNew.x, y: anchor.y - anchorNew.y };
  }
  return {
    x: roundMm(center.x - width / 2),
    y: roundMm(center.y - height / 2),
    width: roundMm(width),
    height: roundMm(height),
  };
}

// --- Align & distribute ---------------------------------------------------

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

// Lines up the given elements' bounds against `frame` (the label when one
// element is selected, otherwise the selection's own bounds). Returns
// moved copies keyed by id.
export function alignElements(els: LabelElement[], mode: AlignMode, frame: Bounds): Map<string, LabelElement> {
  const moved = new Map<string, LabelElement>();
  for (const el of els) {
    const b = boundsOf(el);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = frame.left - b.left;
    if (mode === "right") dx = frame.right - b.right;
    if (mode === "hcenter") dx = (frame.left + frame.right) / 2 - (b.left + b.right) / 2;
    if (mode === "top") dy = frame.top - b.top;
    if (mode === "bottom") dy = frame.bottom - b.bottom;
    if (mode === "vcenter") dy = (frame.top + frame.bottom) / 2 - (b.top + b.bottom) / 2;
    moved.set(el.id, { ...el, x: roundMm(el.x + dx), y: roundMm(el.y + dy) });
  }
  return moved;
}

// Evens out the gaps between three or more elements along one axis, keeping
// the first and last where they are.
export function distributeElements(els: LabelElement[], axis: "x" | "y"): Map<string, LabelElement> {
  const moved = new Map<string, LabelElement>();
  if (els.length < 3) return moved;
  const start = (b: Bounds) => (axis === "x" ? b.left : b.top);
  const end = (b: Bounds) => (axis === "x" ? b.right : b.bottom);
  const sorted = els.map((el) => ({ el, b: boundsOf(el) })).sort((a, b) => start(a.b) - start(b.b));
  const span = end(sorted[sorted.length - 1].b) - start(sorted[0].b);
  const used = sorted.reduce((sum, { b }) => sum + end(b) - start(b), 0);
  const gap = (span - used) / (sorted.length - 1);
  let cursor = start(sorted[0].b);
  for (const { el, b } of sorted) {
    const d = cursor - start(b);
    moved.set(el.id, axis === "x" ? { ...el, x: roundMm(el.x + d) } : { ...el, y: roundMm(el.y + d) });
    cursor += end(b) - start(b) + gap;
  }
  return moved;
}
