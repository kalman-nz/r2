import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { renderLabelToCanvas } from "../lib/renderLabel";
import { fitFontSizeMm } from "../lib/customLabel";
import { trimWhitespace } from "../lib/imageTrim";
import { generateId } from "../lib/id";
import LabelSizeControls from "./LabelSizeControls";
import { sizeForTemplate, unprintableMargin, usePrinting } from "../lib/printing";
import LabelToolbar, { type DesignerPrefs, type OrderMove } from "./label/LabelToolbar";
import { ElementInspector, LayersList, type PatchFn } from "./label/LabelInspector";
import { DEFAULT_FIELD_OPTIONS } from "./label/labelNames";
import {
  alignElements,
  boundsOf,
  centerOf,
  distributeElements,
  HANDLES,
  intersects,
  normalizeAngle,
  resizeFromHandle,
  roundMm,
  snapEdge,
  snapMove,
  snapTargets,
  unionBounds,
  type AlignMode,
  type Bounds,
  type Guide,
  type Handle,
  type SnapTargets,
} from "../lib/labelGeometry";
import { applyFolderLevels, SAMPLE_CONTEXT, type ElementType, type LabelDataContext, type LabelElement } from "../lib/labelSpec";

// Room around the label so elements can be dragged past its edges (e.g. a
// full-bleed logo) without running out of space to grab them.
const WORKSPACE_PAD = 56;
// On-screen px per mm at "fit": as big as the workspace allows, within these
// bounds. Print export uses the printer's real dots-per-mm instead.
const MIN_SCALE = 2;
const MAX_SCALE = 16;
// How close (in screen px) an edge has to come to a guide line to snap.
const SNAP_PX = 5;
const HISTORY_LIMIT = 100;

const PREFS_KEY = "r2.labelDesigner.prefs";
const DEFAULT_PREFS: DesignerPrefs = { snap: true, grid: false, gridMm: 1, marginMm: 2 };

function loadPrefs(): DesignerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: DesignerPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked — the settings just won't stick.
  }
}

type AddableType = Exclude<ElementType, "image">;

// A new element, centred on the label. Without data fields (a one-off
// label) barcodes and QR codes hold a typed value in `text`, like static
// text does.
function newElement(type: AddableType, dataFields: boolean, labelW: number, labelH: number): LabelElement {
  const sizes: Record<AddableType, [number, number]> = {
    text: [30, 6],
    staticText: [20, 6],
    qr: [14, 14],
    barcode: [32, 10],
    rect: [20, 12],
    ellipse: [12, 12],
    line: [30, 2],
  };
  let [width, height] = sizes[type];
  const fit = Math.min(1, (labelW - 4) / width, (labelH - 4) / height);
  if (fit > 0 && fit < 1) {
    width = roundMm(width * fit);
    height = roundMm(height * fit);
  }
  const base = { id: generateId(), x: roundMm((labelW - width) / 2), y: roundMm((labelH - height) / 2), width, height };
  switch (type) {
    case "text":
      return { ...base, type, dataField: "displayname", fontSize: Math.min(4, height * 0.7), valign: "middle" };
    case "staticText":
      return { ...base, type, text: "Label", fontSize: Math.min(4, height * 0.7), valign: "middle" };
    case "qr":
      return { ...base, type, lockAspect: true, ...(dataFields ? { dataField: "qrcodes" } : { text: "R2" }) };
    case "barcode":
      return { ...base, type, ...(dataFields ? { dataField: "qrcodes" } : { text: "12345678" }) };
    case "rect":
      return { ...base, type, stroke: "black", strokeWidth: 0.5, fill: "none" };
    case "ellipse":
      return { ...base, type, stroke: "black", strokeWidth: 0.5, fill: "none" };
    case "line":
      return { ...base, type, stroke: "black", strokeWidth: 0.5 };
  }
}

function valueFor(el: LabelElement, context: LabelDataContext): string {
  if (el.type === "staticText" || !el.dataField) return el.text ?? "";
  const raw = context[el.dataField] ?? "";
  return el.dataField === "equipmentFolder" ? applyFolderLevels(raw, el.folderLevels) : raw;
}

// Resize cursor for a handle, allowing for the element's rotation.
function handleCursor(handle: Handle, rotation: number): string {
  const angle = (Math.atan2(handle.hy, handle.hx) * 180) / Math.PI + rotation;
  const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
  return cursors[((Math.round(angle / 45) % 4) + 4) % 4];
}

function isEditingText() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

type Drag =
  | {
      mode: "move";
      startX: number;
      startY: number;
      origs: LabelElement[];
      startBounds: Bounds;
      targets: SnapTargets;
      before: LabelElement[];
      moved: boolean;
    }
  | {
      mode: "resize";
      handle: Handle;
      startX: number;
      startY: number;
      orig: LabelElement;
      targets: SnapTargets;
      before: LabelElement[];
      moved: boolean;
    }
  | {
      mode: "rotate";
      center: { x: number; y: number }; // screen px
      startAngle: number;
      orig: LabelElement;
      before: LabelElement[];
      moved: boolean;
    }
  | {
      mode: "marquee";
      originMm: { x: number; y: number };
      base: string[];
    };

// The drag-and-drop label builder: size, elements on a canvas, and the
// selected element's settings. Used for saved templates (with data fields
// filled from a unit at print time) and for one-off custom labels (without).
export default function LabelDesigner({
  widthMm,
  heightMm,
  sizeId,
  elements,
  onSizeChange,
  onElementsChange: setElements,
  dataFields = true,
  initialSelectedId = null,
}: {
  widthMm: number;
  heightMm: number;
  sizeId?: string;
  elements: LabelElement[];
  onSizeChange: (widthMm: number, heightMm: number, sizeId: string) => void;
  onElementsChange: Dispatch<SetStateAction<LabelElement[]>>;
  dataFields?: boolean;
  initialSelectedId?: string | null;
}) {
  const { data: customFields = [] } = useQuery({
    queryKey: ["customFields"],
    queryFn: api.listCustomFields,
    enabled: dataFields,
  });
  const { data: printingConfig } = usePrinting();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedId ? [initialSelectedId] : []);
  const [prefs, setPrefsState] = useState<DesignerPrefs>(loadPrefs);
  const [zoom, setZoom] = useState(1);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const [dragMode, setDragMode] = useState<Drag["mode"] | null>(null);

  function setPrefs(p: DesignerPrefs) {
    setPrefsState(p);
    savePrefs(p);
  }

  // Custom fields have no real value to preview with until an actual
  // asset/equipment is printed — a generic placeholder is enough to show
  // "yes, something will render here" while designing.
  const previewContext = useMemo(
    () => ({ ...SAMPLE_CONTEXT, ...Object.fromEntries(customFields.map((f) => [f.key, `Sample ${f.label}`])) }),
    [customFields],
  );
  const customFieldOptions = useMemo(() => customFields.map((f) => ({ key: f.key, label: f.label })), [customFields]);
  const fieldLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of DEFAULT_FIELD_OPTIONS) map.set(f.key, f.label);
    for (const f of customFieldOptions) map.set(f.key, f.label);
    return (key: string) => map.get(key) ?? key;
  }, [customFieldOptions]);

  // --- Undo / redo --------------------------------------------------------
  // Snapshots of the elements before each change. Edits with the same key
  // close together (typing in one field) share a single step.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const past = useRef<LabelElement[][]>([]);
  const future = useRef<LabelElement[][]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryTick] = useState(0);

  function pushHistory(snapshot: LabelElement[], key?: string) {
    const now = Date.now();
    if (key && lastKey.current?.key === key && now - lastKey.current.at < 1200) {
      lastKey.current.at = now;
      return;
    }
    past.current.push(snapshot);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    lastKey.current = key ? { key, at: now } : null;
    setHistoryTick((t) => t + 1);
  }

  function change(update: (prev: LabelElement[]) => LabelElement[], key?: string) {
    pushHistory(elementsRef.current, key);
    setElements(update);
  }

  function restore(from: typeof past, to: typeof future) {
    const snapshot = from.current.pop();
    if (!snapshot) return;
    to.current.push(elementsRef.current);
    lastKey.current = null;
    setElements(snapshot);
    setSelectedIds((ids) => ids.filter((id) => snapshot.some((el) => el.id === id)));
    setHistoryTick((t) => t + 1);
  }
  const undo = () => restore(past, future);
  const redo = () => restore(future, past);

  // --- Scale & preview ------------------------------------------------------
  const workspaceRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWorkspace({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fitScale =
    workspace.width > 0
      ? Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, (workspace.width - 2 * WORKSPACE_PAD) / widthMm, (workspace.height - 2 * WORKSPACE_PAD) / heightMm),
        )
      : 6;
  const scale = fitScale * zoom;
  const clampZoom = (z: number) => Math.min(6, Math.max(0.5, z));

  // Pinch / Ctrl+scroll zooms the canvas instead of the page.
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.01)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const pixelRatio = window.devicePixelRatio || 1;
    renderLabelToCanvas({ widthMm, heightMm, elements }, previewContext, scale * pixelRatio).then((rendered) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      canvas.getContext("2d")?.drawImage(rendered, 0, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [widthMm, heightMm, elements, previewContext, scale]);

  // --- Dragging -------------------------------------------------------------
  const dragRef = useRef<Drag | null>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);

  function pointerMm(e: { clientX: number; clientY: number }) {
    const rect = labelRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  function targetsExcluding(ids: string[]) {
    return snapTargets(
      widthMm,
      heightMm,
      elements.filter((el) => !ids.includes(el.id)),
      prefs.marginMm,
    );
  }

  function beginDrag(drag: Drag) {
    dragRef.current = drag;
    setDragMode(drag.mode);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onElementPointerDown(e: React.PointerEvent, el: LabelElement) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids = selectedIds;
    if (additive) {
      if (selectedIds.includes(el.id)) {
        setSelectedIds(selectedIds.filter((id) => id !== el.id));
        return;
      }
      ids = [...selectedIds, el.id];
    } else if (!selectedIds.includes(el.id)) {
      ids = [el.id];
    }
    setSelectedIds(ids);
    const origs = elements.filter((x) => ids.includes(x.id) && !x.locked);
    const startBounds = unionBounds(origs.map(boundsOf));
    if (!startBounds) return;
    beginDrag({
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      origs,
      startBounds,
      targets: targetsExcluding(ids),
      before: elements,
      moved: false,
    });
  }

  function onHandlePointerDown(e: React.PointerEvent, el: LabelElement, handle: Handle) {
    e.stopPropagation();
    beginDrag({
      mode: "resize",
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: el,
      targets: targetsExcluding([el.id]),
      before: elements,
      moved: false,
    });
  }

  function onRotatePointerDown(e: React.PointerEvent, el: LabelElement) {
    e.stopPropagation();
    const rect = labelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const c = centerOf(el);
    const center = { x: rect.left + c.x * scale, y: rect.top + c.y * scale };
    beginDrag({
      mode: "rotate",
      center,
      startAngle: (Math.atan2(e.clientY - center.y, e.clientX - center.x) * 180) / Math.PI,
      orig: el,
      before: elements,
      moved: false,
    });
  }

  function onWorkspacePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? selectedIds : [];
    if (!additive) setSelectedIds([]);
    beginDrag({ mode: "marquee", originMm: pointerMm(e), base });
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const snapping = !(e.metaKey || e.ctrlKey);
    const threshold = SNAP_PX / scale;
    const grid = snapping && prefs.grid ? prefs.gridMm : null;

    if (drag.mode === "marquee") {
      const p = pointerMm(e);
      const box: Bounds = {
        left: Math.min(p.x, drag.originMm.x),
        top: Math.min(p.y, drag.originMm.y),
        right: Math.max(p.x, drag.originMm.x),
        bottom: Math.max(p.y, drag.originMm.y),
      };
      setMarquee(box);
      const hit = elements.filter((el) => !el.locked && intersects(boundsOf(el), box)).map((el) => el.id);
      setSelectedIds([...new Set([...drag.base, ...hit])]);
      return;
    }

    if (!drag.moved) {
      drag.moved = true;
      pushHistory(drag.before);
    }

    if (drag.mode === "move") {
      let dx = (e.clientX - drag.startX) / scale;
      let dy = (e.clientY - drag.startY) / scale;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const moved = {
        left: drag.startBounds.left + dx,
        right: drag.startBounds.right + dx,
        top: drag.startBounds.top + dy,
        bottom: drag.startBounds.bottom + dy,
      };
      const snap = snapping ? snapMove(moved, prefs.snap ? drag.targets : null, threshold, grid) : { dx: 0, dy: 0, guides: [] };
      if (e.shiftKey) {
        // Stay on the locked axis.
        if (dx === 0) snap.dx = 0;
        if (dy === 0) snap.dy = 0;
        snap.guides = snap.guides.filter((g) => (g.axis === "x" ? dx !== 0 : dy !== 0));
      }
      dx += snap.dx;
      dy += snap.dy;
      setGuides(snap.guides);
      const byId = new Map(drag.origs.map((o) => [o.id, o]));
      setElements((prev) =>
        prev.map((el) => {
          const o = byId.get(el.id);
          return o ? { ...el, x: roundMm(o.x + dx), y: roundMm(o.y + dy) } : el;
        }),
      );
      return;
    }

    if (drag.mode === "resize") {
      const found: Guide[] = [];
      const snapFn =
        snapping && (prefs.snap || grid)
          ? (edge: number, axis: "x" | "y") => {
              const s = snapEdge(edge, axis, prefs.snap ? drag.targets : null, threshold, grid);
              if (s.guide) found.push(s.guide);
              return s.edge;
            }
          : undefined;
      const lockAspect = drag.orig.lockAspect ?? false;
      const next = resizeFromHandle(drag.orig, drag.handle, (e.clientX - drag.startX) / scale, (e.clientY - drag.startY) / scale, {
        keepAspect: e.shiftKey ? !lockAspect : lockAspect,
        fromCenter: e.altKey,
        snap: snapFn,
      });
      setGuides(found);
      setElements((prev) => prev.map((el) => (el.id === drag.orig.id ? { ...el, ...next } : el)));
      return;
    }

    // rotate
    const angle = (Math.atan2(e.clientY - drag.center.y, e.clientX - drag.center.x) * 180) / Math.PI;
    let rotation = (drag.orig.rotation ?? 0) + angle - drag.startAngle;
    if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
    else if (snapping) {
      // A gentle pull to the right angles and diagonals.
      const nearest = Math.round(rotation / 45) * 45;
      rotation = Math.abs(rotation - nearest) < 3 ? nearest : Math.round(rotation);
    }
    setElements((prev) => prev.map((el) => (el.id === drag.orig.id ? { ...el, rotation: normalizeAngle(rotation) } : el)));
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragMode(null);
    setGuides([]);
    setMarquee(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }

  // --- Editing ----------------------------------------------------------
  const selected = elements.filter((el) => selectedIds.includes(el.id));
  const single = selected.length === 1 ? selected[0] : null;

  const patchSelected: PatchFn = (patch, key) => {
    change((prev) => prev.map((el) => (selectedIds.includes(el.id) ? { ...el, ...patch } : el)), key);
  };

  function patchById(id: string, patch: Partial<LabelElement>) {
    change((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  }

  function addElement(type: AddableType) {
    const el = newElement(type, dataFields, widthMm, heightMm);
    change((prev) => [...prev, el]);
    setSelectedIds([el.id]);
  }

  async function readImageFile(file: File): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> {
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    // Logos frequently export with transparent/white padding baked in —
    // trim that off so what you place on the label is just the mark.
    const dataUrl = await trimWhitespace(rawDataUrl);
    const { naturalWidth, naturalHeight } = await new Promise<{ naturalWidth: number; naturalHeight: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = dataUrl;
    });
    return { dataUrl, naturalWidth, naturalHeight };
  }

  async function addImageElement(file: File) {
    const { dataUrl, naturalWidth, naturalHeight } = await readImageFile(file);
    let width = Math.min(20, widthMm - 4);
    let height = (width * naturalHeight) / naturalWidth;
    if (height > heightMm - 4) {
      height = heightMm - 4;
      width = (height * naturalWidth) / naturalHeight;
    }
    const el: LabelElement = {
      id: generateId(),
      type: "image",
      x: roundMm((widthMm - width) / 2),
      y: roundMm((heightMm - height) / 2),
      width: roundMm(width),
      height: roundMm(height),
      imageData: dataUrl,
      lockAspect: true,
    };
    change((prev) => [...prev, el]);
    setSelectedIds([el.id]);
  }

  async function replaceSelectedImage(file: File) {
    const { dataUrl } = await readImageFile(file);
    patchSelected({ imageData: dataUrl });
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return;
    change((prev) => prev.filter((el) => !selectedIds.includes(el.id)));
    setSelectedIds([]);
  }

  function duplicateElements(sources: LabelElement[], offset = 2) {
    if (sources.length === 0) return;
    const copies = sources.map((s) => ({ ...s, id: generateId(), x: roundMm(s.x + offset), y: roundMm(s.y + offset), locked: false }));
    change((prev) => [...prev, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
  }

  function nudge(dx: number, dy: number) {
    const ids = selected.filter((el) => !el.locked).map((el) => el.id);
    if (ids.length === 0) return;
    change(
      (prev) => prev.map((el) => (ids.includes(el.id) ? { ...el, x: roundMm(el.x + dx), y: roundMm(el.y + dy) } : el)),
      `nudge:${ids.join()}`,
    );
  }

  function align(mode: AlignMode) {
    const movable = selected.filter((el) => !el.locked);
    if (movable.length === 0) return;
    const frame =
      selected.length === 1 ? { left: 0, top: 0, right: widthMm, bottom: heightMm } : unionBounds(selected.map(boundsOf));
    if (!frame) return;
    const moved = alignElements(movable, mode, frame);
    change((prev) => prev.map((el) => moved.get(el.id) ?? el));
  }

  function distribute(axis: "x" | "y") {
    const moved = distributeElements(
      selected.filter((el) => !el.locked),
      axis,
    );
    if (moved.size === 0) return;
    change((prev) => prev.map((el) => moved.get(el.id) ?? el));
  }

  function reorder(move: OrderMove) {
    if (selectedIds.length === 0) return;
    change((prev) => {
      const isSel = (el: LabelElement) => selectedIds.includes(el.id);
      if (move === "front") return [...prev.filter((el) => !isSel(el)), ...prev.filter(isSel)];
      if (move === "back") return [...prev.filter(isSel), ...prev.filter((el) => !isSel(el))];
      const list = [...prev];
      if (move === "forward") {
        for (let i = list.length - 2; i >= 0; i--) {
          if (isSel(list[i]) && !isSel(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
        }
      } else {
        for (let i = 1; i < list.length; i++) {
          if (isSel(list[i]) && !isSel(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
        }
      }
      return list;
    });
  }

  function fitText(el: LabelElement) {
    const text = valueFor(el, previewContext) || " ";
    const fontSize = fitFontSizeMm(text, el.width, el.height, { ...el, padding: el.padding ?? 0 });
    // The fit assumes wrapped lines.
    patchSelected({ fontSize, wrap: true });
  }

  // --- Keyboard -----------------------------------------------------------
  const clipboardRef = useRef<LabelElement[]>([]);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (isEditingText() || document.querySelector("[role=dialog]")) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && key === "a") {
      e.preventDefault();
      setSelectedIds(elements.filter((el) => !el.locked).map((el) => el.id));
    } else if (mod && key === "c" && selected.length > 0) {
      clipboardRef.current = selected;
    } else if (mod && key === "x" && selected.length > 0) {
      clipboardRef.current = selected;
      deleteSelected();
    } else if (mod && key === "v" && clipboardRef.current.length > 0) {
      e.preventDefault();
      duplicateElements(clipboardRef.current);
    } else if (mod && key === "d" && selected.length > 0) {
      e.preventDefault();
      duplicateElements(selected);
    } else if (mod && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      reorder(e.key === "]" ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length > 0) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "Escape") {
      setSelectedIds([]);
    } else if (e.key.startsWith("Arrow") && selected.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 5 : prefs.grid ? prefs.gridMm : 0.5;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      nudge(dx, dy);
    }
  };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- Render -------------------------------------------------------------
  const selectionBounds = selected.length > 1 ? unionBounds(selected.map(boundsOf)) : null;
  const badge = (() => {
    if (!dragMode || dragMode === "marquee" || selected.length === 0) return null;
    const b = unionBounds(selected.map(boundsOf));
    if (!b) return null;
    const text =
      dragMode === "rotate" && single
        ? `${roundMm(single.rotation ?? 0)}°`
        : dragMode === "resize" && single
          ? `${roundMm(single.width)} × ${roundMm(single.height)} mm`
          : `${roundMm(b.left)}, ${roundMm(b.top)} mm`;
    return { text, x: (b.left + b.right) / 2, y: b.bottom };
  })();

  const unprintable = unprintableMargin(sizeForTemplate({ widthMm, heightMm, sizeId }, printingConfig?.sizes ?? []), widthMm, heightMm);
  const addButtonClass = "px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50";
  const gridPx = prefs.gridMm * scale;

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-3">
      <LabelSizeControls widthMm={widthMm} heightMm={heightMm} sizeId={sizeId} onChange={onSizeChange}>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-gray-500 mr-0.5">Add</span>
          {dataFields && (
            <button onClick={() => addElement("text")} className={addButtonClass}>
              Data text
            </button>
          )}
          <button onClick={() => addElement("staticText")} className={addButtonClass}>
            Text
          </button>
          <button onClick={() => addElement("barcode")} className={addButtonClass}>
            Barcode
          </button>
          <button onClick={() => addElement("qr")} className={addButtonClass}>
            QR
          </button>
          <button onClick={() => addImageInputRef.current?.click()} className={addButtonClass}>
            Image
          </button>
          <button onClick={() => addElement("rect")} className={addButtonClass}>
            Box
          </button>
          <button onClick={() => addElement("ellipse")} className={addButtonClass}>
            Ellipse
          </button>
          <button onClick={() => addElement("line")} className={addButtonClass}>
            Line
          </button>
          <input
            ref={addImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addImageElement(file);
              e.target.value = "";
            }}
          />
        </div>
      </LabelSizeControls>

      <LabelToolbar
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        selectionCount={selected.length}
        onAlign={align}
        onDistribute={distribute}
        onOrder={reorder}
        prefs={prefs}
        onPrefs={setPrefs}
        zoom={zoom}
        onZoom={(z) => setZoom(clampZoom(z))}
      />

      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-4">
        <div
          ref={workspaceRef}
          className="relative flex-1 min-h-[20rem] lg:min-h-0 min-w-0 rounded-lg border border-gray-200 bg-gray-100 overflow-auto select-none touch-none"
          onPointerDown={onWorkspacePointerDown}
        >
          <div className="min-w-full min-h-full w-fit flex items-center justify-center" style={{ padding: WORKSPACE_PAD }}>
            <div ref={labelRef} className="relative bg-white shadow-sm ring-1 ring-black/5 shrink-0" style={{ width: widthMm * scale, height: heightMm * scale }}>
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {prefs.grid && gridPx >= 4 && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgb(0 0 0 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(0 0 0 / 0.07) 1px, transparent 1px)",
                    backgroundSize: `${gridPx}px ${gridPx}px`,
                  }}
                />
              )}
              {unprintable && (unprintable.x > 0 || unprintable.y > 0) && (
                <div
                  title="The printer can't reach this edge of the label"
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderStyle: "solid",
                    borderColor: "rgb(244 63 94 / 0.12)",
                    borderLeftWidth: unprintable.x * scale,
                    borderRightWidth: unprintable.x * scale,
                    borderTopWidth: unprintable.y * scale,
                    borderBottomWidth: unprintable.y * scale,
                  }}
                />
              )}
              {prefs.marginMm > 0 && (
                <div
                  className="absolute pointer-events-none border border-dashed border-sky-400/50"
                  style={{
                    left: prefs.marginMm * scale,
                    top: prefs.marginMm * scale,
                    right: prefs.marginMm * scale,
                    bottom: prefs.marginMm * scale,
                  }}
                />
              )}

              {elements.map((el) => {
                const isSelected = selectedIds.includes(el.id);
                const showHandles = single?.id === el.id && !el.locked;
                const w = el.width * scale;
                const h = el.height * scale;
                const rotation = el.rotation ?? 0;
                return (
                  <div
                    key={el.id}
                    onPointerDown={(e) => onElementPointerDown(e, el)}
                    className={`absolute ${el.locked ? "pointer-events-none" : "cursor-move"} ${
                      isSelected ? "outline outline-1 outline-signal" : "hover:outline hover:outline-1 hover:outline-signal/40"
                    }`}
                    style={{
                      left: el.x * scale,
                      top: el.y * scale,
                      width: w,
                      height: h,
                      transform: rotation ? `rotate(${rotation}deg)` : undefined,
                    }}
                  >
                    {isSelected && el.locked && <div className="absolute inset-0 outline outline-1 outline-dashed outline-gray-400" />}
                    {showHandles && (
                      <>
                        {HANDLES.filter((hd) => (hd.hx === 0 ? w >= 24 : true) && (hd.hy === 0 ? h >= 24 : true)).map((hd) => (
                          <div
                            key={`${hd.hx},${hd.hy}`}
                            onPointerDown={(e) => onHandlePointerDown(e, el, hd)}
                            className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] bg-white border border-signal rounded-[2px]"
                            style={{
                              left: `${((hd.hx + 1) / 2) * 100}%`,
                              top: `${((hd.hy + 1) / 2) * 100}%`,
                              cursor: handleCursor(hd, rotation),
                            }}
                          />
                        ))}
                        <div className="absolute left-1/2 -top-5 w-px h-5 bg-signal pointer-events-none" />
                        <div
                          onPointerDown={(e) => onRotatePointerDown(e, el)}
                          title="Drag to rotate (Shift for 15° steps)"
                          className="absolute left-1/2 -top-7 w-3 h-3 -ml-1.5 rounded-full bg-white border border-signal cursor-grab active:cursor-grabbing"
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {selectionBounds && (
                <div
                  className="absolute pointer-events-none outline outline-1 outline-dashed outline-signal/70"
                  style={{
                    left: selectionBounds.left * scale,
                    top: selectionBounds.top * scale,
                    width: (selectionBounds.right - selectionBounds.left) * scale,
                    height: (selectionBounds.bottom - selectionBounds.top) * scale,
                  }}
                />
              )}

              {guides.map((g, i) =>
                g.axis === "x" ? (
                  <div key={i} className="absolute pointer-events-none w-px bg-fuchsia-500" style={{ left: g.at * scale, top: -16, bottom: -16 }} />
                ) : (
                  <div key={i} className="absolute pointer-events-none h-px bg-fuchsia-500" style={{ top: g.at * scale, left: -16, right: -16 }} />
                ),
              )}

              {marquee && (
                <div
                  className="absolute pointer-events-none border border-signal bg-signal/10"
                  style={{
                    left: marquee.left * scale,
                    top: marquee.top * scale,
                    width: (marquee.right - marquee.left) * scale,
                    height: (marquee.bottom - marquee.top) * scale,
                  }}
                />
              )}

              {badge && (
                <div
                  className="absolute pointer-events-none -translate-x-1/2 mt-2 px-1.5 py-0.5 rounded bg-carbon text-white text-[11px] font-mono whitespace-nowrap"
                  style={{ left: badge.x * scale, top: badge.y * scale }}
                >
                  {badge.text}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:w-80 shrink-0 card p-4 text-sm lg:overflow-y-auto flex flex-col gap-4">
          {single ? (
            <ElementInspector
              key={single.id}
              el={single}
              dataFields={dataFields}
              fieldOptions={DEFAULT_FIELD_OPTIONS}
              customFieldOptions={customFieldOptions}
              onPatch={patchSelected}
              onFit={() => fitText(single)}
              onReplaceImage={replaceSelectedImage}
              onDuplicate={() => duplicateElements([single])}
              onDelete={deleteSelected}
            />
          ) : selected.length > 1 ? (
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold text-gray-800">{selected.length} elements</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => duplicateElements(selected)} className="text-gray-600 hover:text-gray-900">
                  Duplicate
                </button>
                <button onClick={() => patchSelected({ locked: !selected.every((el) => el.locked) })} className="text-gray-600 hover:text-gray-900">
                  {selected.every((el) => el.locked) ? "Unlock" : "Lock"}
                </button>
                <button onClick={deleteSelected} className="text-red-600 hover:text-red-700 ml-auto">
                  Delete
                </button>
              </div>
            </div>
          ) : (
            null
          )}

          <div className={`flex flex-col gap-1.5 ${selected.length > 0 ? "pt-3 border-t border-gray-100" : ""}`}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Layers</h4>
            <LayersList
              elements={elements}
              selectedIds={selectedIds}
              dataFields={dataFields}
              fieldLabel={fieldLabel}
              onSelect={(id, additive) =>
                setSelectedIds((ids) => (additive ? (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]) : [id]))
              }
              onToggleLock={(id) => {
                const el = elements.find((x) => x.id === id);
                if (el) patchById(id, { locked: !el.locked });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
