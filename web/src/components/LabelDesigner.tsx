import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { renderLabelToCanvas } from "../lib/renderLabel";
import { fitFontSizeMm, PADDING_MM } from "../lib/customLabel";
import { trimWhitespace } from "../lib/imageTrim";
import { generateId } from "../lib/id";
import NumberInput from "./NumberInput";
import LabelSizeControls from "./LabelSizeControls";
import {
  applyFolderLevels,
  DATA_FIELDS,
  SAMPLE_CONTEXT,
  type ElementType,
  type LabelElement,
} from "../lib/labelSpec";

// Room around the label so elements can be dragged past its edges (e.g. a
// full-bleed logo) without running out of space to grab them.
const WORKSPACE_PAD = 60;
// On-screen px per mm: as big as the workspace allows, within these bounds.
// Print export uses the printer's real dots-per-mm instead.
const MIN_SCALE = 2;
const MAX_SCALE = 12;

function rotate(current: LabelElement["rotation"], deltaDeg: -90 | 90): 0 | 90 | 180 | 270 {
  return (((current ?? 0) + deltaDeg + 360) % 360) as 0 | 90 | 180 | 270;
}

// The resize handle sits at the box's local bottom-right corner. Rotation
// happens around the box's *center*, so if we resize by just changing
// width/height and leaving x/y numerically alone, the center shifts and the
// whole rotated box visually drifts instead of growing from the corner
// opposite the handle. This solves for the new x/y that keeps that opposite
// corner's on-screen position fixed as width/height change.
function resizeKeepingAnchor(
  orig: Pick<LabelElement, "x" | "y" | "width" | "height" | "rotation">,
  newWidth: number,
  newHeight: number,
): { x: number; y: number } {
  const rad = ((orig.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotateVec = (vx: number, vy: number) => ({ x: vx * cos - vy * sin, y: vx * sin + vy * cos });

  const origCenter = { x: orig.x + orig.width / 2, y: orig.y + orig.height / 2 };
  const anchorOffset = rotateVec(-orig.width / 2, -orig.height / 2);
  const anchor = { x: origCenter.x + anchorOffset.x, y: origCenter.y + anchorOffset.y };

  const newAnchorOffset = rotateVec(-newWidth / 2, -newHeight / 2);
  const newCenter = { x: anchor.x - newAnchorOffset.x, y: anchor.y - newAnchorOffset.y };

  return { x: newCenter.x - newWidth / 2, y: newCenter.y - newHeight / 2 };
}

// Without data fields (a one-off label) barcodes and QR codes hold a typed
// value in `text`, like static text does.
function newElement(type: Exclude<ElementType, "image">, dataFields: boolean): LabelElement {
  const base = { id: generateId(), x: 2, y: 2 };
  switch (type) {
    case "text":
      return { ...base, type, width: 30, height: 6, dataField: "displayname", fontSize: 4 };
    case "staticText":
      return { ...base, type, width: 20, height: 6, text: "Label", fontSize: 4 };
    case "qr":
      return { ...base, type, width: 14, height: 14, lockAspect: true, ...(dataFields ? { dataField: "qrcodes" } : { text: "R2" }) };
    case "barcode":
      return { ...base, type, width: 32, height: 10, ...(dataFields ? { dataField: "qrcodes" } : { text: "12345678" }) };
  }
}

// The largest font that fits the text inside the element's box.
function fittedFontSize(el: LabelElement): number {
  const sideways = el.rotation === 90 || el.rotation === 270;
  const inset = 2 * (el.padding ?? 0) - 2 * PADDING_MM; // fitFontSizeMm insets by PADDING_MM itself
  const w = (sideways ? el.height : el.width) - inset;
  const h = (sideways ? el.width : el.height) - inset;
  return fitFontSizeMm(el.text || " ", w, h);
}

type DragMode = "move" | "resize";
interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  orig: LabelElement;
}

const addButtonClass = "px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50";

// The drag-and-drop label builder: size, elements on a canvas, and the
// selected element's settings. Used for saved templates (with data fields
// filled from a unit at print time) and for one-off custom labels (without).
export default function LabelDesigner({
  widthMm,
  heightMm,
  elements,
  onSizeChange,
  onElementsChange: setElements,
  dataFields = true,
  initialSelectedId = null,
}: {
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
  onSizeChange: (widthMm: number, heightMm: number) => void;
  onElementsChange: Dispatch<SetStateAction<LabelElement[]>>;
  dataFields?: boolean;
  initialSelectedId?: string | null;
}) {
  const { data: customFields = [] } = useQuery({
    queryKey: ["customFields"],
    queryFn: api.listCustomFields,
    enabled: dataFields,
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  // Custom fields have no real value to preview with until an actual
  // asset/equipment is printed — a generic placeholder is enough to show
  // "yes, something will render here" while designing.
  const previewContext = useMemo(
    () => ({ ...SAMPLE_CONTEXT, ...Object.fromEntries(customFields.map((f) => [f.key, `Sample ${f.label}`])) }),
    [customFields],
  );

  const workspaceRef = useRef<HTMLDivElement>(null);
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
  const scale =
    workspace.width > 0
      ? Math.max(
          MIN_SCALE,
          Math.min(
            MAX_SCALE,
            (workspace.width - 2 * WORKSPACE_PAD) / widthMm,
            (workspace.height - 2 * WORKSPACE_PAD) / heightMm,
          ),
        )
      : 6;

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

  const dragRef = useRef<DragState | null>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);

  function onHandlePointerDown(e: React.PointerEvent, el: LabelElement, mode: DragMode) {
    e.stopPropagation();
    setSelectedId(el.id);
    dragRef.current = { id: el.id, mode, startX: e.clientX, startY: e.clientY, orig: el };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dxMm = (e.clientX - drag.startX) / scale;
    const dyMm = (e.clientY - drag.startY) / scale;
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== drag.id) return el;
        if (drag.mode === "move") {
          // No clamp to 0 — elements (a logo, a background block) can be
          // dragged partially or fully off any edge for a bleed effect.
          // Moving is a pure translation, unaffected by the box's own
          // rotation, so the raw screen delta applies as-is.
          return { ...el, x: Math.round(drag.orig.x + dxMm), y: Math.round(drag.orig.y + dyMm) };
        }

        // The resize handle is rendered rotated with the box (it's a CSS
        // transform on screen), so a screen-space drag has to be rotated
        // back into the box's own (unrotated) coordinate frame before it
        // means "grow width" / "grow height" — otherwise dragging the
        // handle on a 90°-rotated element would resize the wrong axis.
        const rad = ((drag.orig.rotation ?? 0) * Math.PI) / 180;
        const localDx = dxMm * Math.cos(rad) + dyMm * Math.sin(rad);
        const localDy = -dxMm * Math.sin(rad) + dyMm * Math.cos(rad);

        let width = Math.max(2, Math.round(drag.orig.width + localDx));
        let height = Math.max(2, Math.round(drag.orig.height + localDy));
        if (el.lockAspect) {
          // Keep the element's original width:height ratio — driven by
          // whichever axis the pointer moved further along.
          const ratio = drag.orig.width / drag.orig.height;
          if (Math.abs(localDx) >= Math.abs(localDy)) {
            height = Math.max(2, Math.round(width / ratio));
          } else {
            width = Math.max(2, Math.round(height * ratio));
          }
        }

        // Recompute x/y so the corner opposite the handle stays visually
        // fixed on screen instead of drifting as the rotated box's center
        // shifts with its new size.
        const { x, y } = resizeKeepingAnchor(drag.orig, width, height);
        return { ...el, x: Math.round(x), y: Math.round(y), width, height };
      }),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function updateSelected(patch: Partial<LabelElement>) {
    setElements((prev) => prev.map((el) => (el.id === selectedId ? { ...el, ...patch } : el)));
  }

  function addElement(type: Exclude<ElementType, "image">) {
    const el = newElement(type, dataFields);
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
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
    const { naturalWidth, naturalHeight } = await new Promise<{ naturalWidth: number; naturalHeight: number }>(
      (resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        img.onerror = () => reject(new Error("Could not decode image"));
        img.src = dataUrl;
      },
    );
    return { dataUrl, naturalWidth, naturalHeight };
  }

  async function addImageElement(file: File) {
    const { dataUrl, naturalWidth, naturalHeight } = await readImageFile(file);
    const width = 20;
    const height = Math.max(2, Math.round((width * naturalHeight) / naturalWidth));
    const el: LabelElement = {
      id: generateId(),
      type: "image",
      x: 2,
      y: 2,
      width,
      height,
      imageData: dataUrl,
      lockAspect: true,
    };
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
  }

  async function replaceSelectedImage(file: File) {
    const { dataUrl } = await readImageFile(file);
    updateSelected({ imageData: dataUrl });
  }

  function deleteSelected() {
    setElements((prev) => prev.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }

  function duplicate(source: LabelElement) {
    const copy: LabelElement = { ...source, id: generateId(), x: source.x + 4, y: source.y + 4 };
    setElements((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    return copy;
  }

  // Copy/paste the selected element with Cmd/Ctrl+C / Cmd/Ctrl+V — skipped
  // while focus is in a text input (template name, static text, font size,
  // etc.) so normal text copy/paste there isn't hijacked.
  const clipboardRef = useRef<LabelElement | null>(null);
  useEffect(() => {
    function isEditingText() {
      const tag = document.activeElement?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA";
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || isEditingText()) return;
      if (e.key === "c" && selectedId) {
        const el = elements.find((el) => el.id === selectedId);
        if (el) clipboardRef.current = el;
      } else if (e.key === "v" && clipboardRef.current) {
        e.preventDefault();
        duplicate(clipboardRef.current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [elements, selectedId]);

  const selected = elements.find((el) => el.id === selectedId) ?? null;
  const typeName = (type: ElementType) =>
    type === "staticText" ? (dataFields ? "Static text" : "Text") : type === "qr" ? "QR code" : type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-4">
      <LabelSizeControls widthMm={widthMm} heightMm={heightMm} onChange={onSizeChange}>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className="text-gray-500">Add</span>
          {dataFields && (
            <button onClick={() => addElement("text")} className={addButtonClass}>
              Text
            </button>
          )}
          <button onClick={() => addElement("staticText")} className={addButtonClass}>
            {dataFields ? "Static text" : "Text"}
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

      <div className="flex-1 lg:min-h-0 flex flex-col lg:flex-row gap-4">
        <div
          ref={workspaceRef}
          className="relative flex-1 min-h-[20rem] lg:min-h-0 min-w-0 rounded-lg border border-dashed border-gray-300 bg-gray-100 overflow-auto"
          onPointerDown={() => setSelectedId(null)}
        >
          <div className="min-w-full min-h-full w-fit flex items-center justify-center" style={{ padding: WORKSPACE_PAD }}>
            <div className="relative bg-white shadow-sm shrink-0" style={{ width: widthMm * scale, height: heightMm * scale }}>
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
              {elements.map((el) => (
                <div
                  key={el.id}
                  onPointerDown={(e) => onHandlePointerDown(e, el, "move")}
                  className={`absolute border cursor-move ${
                    el.id === selectedId ? "border-signal" : "border-transparent hover:border-signal/40"
                  }`}
                  style={{
                    left: el.x * scale,
                    top: el.y * scale,
                    width: el.width * scale,
                    height: el.height * scale,
                    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  }}
                >
                  {el.id === selectedId && (
                    <div
                      onPointerDown={(e) => onHandlePointerDown(e, el, "resize")}
                      className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-signal rounded-sm cursor-nwse-resize"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:w-72 shrink-0 card p-4 text-sm lg:overflow-y-auto">
          {!selected ? (
            <p className="text-gray-500">Select an element to edit it, or add one above. Drag to move, drag the corner to resize.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold text-gray-700">{typeName(selected.type)}</h3>

              {dataFields && (selected.type === "text" || selected.type === "barcode" || selected.type === "qr") && (
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Data field</span>
                  <select
                    value={selected.dataField}
                    onChange={(e) => updateSelected({ dataField: e.target.value })}
                    className="input py-1"
                  >
                    {DATA_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                    {customFields.length > 0 && (
                      <optgroup label="Custom fields">
                        {customFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              )}

              {!dataFields && (selected.type === "barcode" || selected.type === "qr") && (
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Value</span>
                  <input
                    value={selected.text ?? ""}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                    placeholder={selected.type === "qr" ? "Text or a link" : "Letters and numbers"}
                    className="input py-1"
                  />
                </label>
              )}

              {selected.dataField === "equipmentFolder" &&
                (selected.type === "text" || selected.type === "barcode" || selected.type === "qr") && (
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-500">Folder levels</span>
                    <div className="flex gap-1 flex-wrap">
                      {[1, 2, 3, 4, 5].map((level) => {
                        const active = (selected.folderLevels ?? []).includes(level);
                        return (
                          <button
                            key={level}
                            onClick={() => {
                              const current = selected.folderLevels ?? [];
                              const next = active ? current.filter((l) => l !== level) : [...current, level];
                              updateSelected({ folderLevels: next });
                            }}
                            className={`w-8 h-8 rounded border ${
                              active
                                ? "border-signal text-signal-ink bg-signal-soft"
                                : "border-gray-300 text-gray-500 hover:bg-gray-50"
                            }`}
                          >
                            {level}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => updateSelected({ folderLevels: [] })}
                        className={`px-2 h-8 rounded border ${
                          (selected.folderLevels ?? []).length === 0
                            ? "border-signal text-signal-ink bg-signal-soft"
                            : "border-gray-300 text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        All
                      </button>
                    </div>
                    <span className="text-xs text-gray-400">
                      e.g. "{applyFolderLevels(SAMPLE_CONTEXT.equipmentFolder, selected.folderLevels) || "(empty)"}"
                      for {SAMPLE_CONTEXT.equipmentFolder}
                    </span>
                  </div>
                )}

              {(selected.type === "barcode" || selected.type === "qr" || selected.type === "image") && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.lockAspect ?? false}
                    onChange={(e) => updateSelected({ lockAspect: e.target.checked })}
                  />
                  <span className="text-gray-500">
                    Lock aspect ratio{selected.type === "qr" ? " (recommended — keeps the QR scannable)" : ""}
                  </span>
                </label>
              )}

              {selected.type === "image" && (
                <div className="flex flex-col gap-2">
                  {selected.imageData && (
                    <img src={selected.imageData} alt="" className="max-h-24 max-w-full object-contain border border-gray-200 rounded bg-white" />
                  )}
                  <button onClick={() => replaceImageInputRef.current?.click()} className={`${addButtonClass} w-fit`}>
                    Replace image
                  </button>
                  <input
                    ref={replaceImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) replaceSelectedImage(file);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}

              {selected.type === "staticText" && (
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500">Text</span>
                  <textarea
                    value={selected.text ?? ""}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                    rows={2}
                    className="input py-1 resize-y"
                  />
                </label>
              )}

              {(selected.type === "text" || selected.type === "staticText") && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-500">Font size (mm)</span>
                    <div className="flex items-center gap-2">
                      <NumberInput
                        min={1}
                        value={selected.fontSize ?? 4}
                        onChange={(fontSize) => updateSelected({ fontSize })}
                        className="input py-1 flex-1 min-w-0"
                      />
                      {selected.type === "staticText" && (
                        <button
                          onClick={() => updateSelected({ fontSize: fittedFontSize(selected), wrap: true })}
                          className={addButtonClass}
                          title="As big as fits in the box"
                        >
                          Fit
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Padding (mm)</span>
                    <NumberInput
                      min={0}
                      value={selected.padding ?? 0}
                      onChange={(padding) => updateSelected({ padding })}
                      className="input py-1"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.bold ?? false}
                      onChange={(e) => updateSelected({ bold: e.target.checked })}
                    />
                    <span className="text-gray-500">Bold</span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Align</span>
                    <div className="flex gap-1">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => updateSelected({ align: a })}
                          className={`flex-1 px-2 py-1 rounded border capitalize ${
                            (selected.align ?? "left") === a
                              ? "border-signal text-signal-ink bg-signal-soft"
                              : "border-gray-300 text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-gray-500">Vertical align</span>
                    <div className="flex gap-1">
                      {(["top", "middle", "bottom"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => updateSelected({ valign: v })}
                          className={`flex-1 px-2 py-1 rounded border capitalize ${
                            (selected.valign ?? "top") === v
                              ? "border-signal text-signal-ink bg-signal-soft"
                              : "border-gray-300 text-gray-500 hover:bg-gray-50"
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.wrap ?? false}
                      onChange={(e) => updateSelected({ wrap: e.target.checked })}
                    />
                    <span className="text-gray-500">Wrap text (instead of squeezing onto one line)</span>
                  </label>

                  {selected.wrap && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.breakWords ?? true}
                        onChange={(e) => updateSelected({ breakWords: e.target.checked })}
                      />
                      <span className="text-gray-500">
                        Break long words that don't fit (off condenses them onto one line instead)
                      </span>
                    </label>
                  )}
                </>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Rotation</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSelected({ rotation: rotate(selected.rotation, -90) })}
                    className={addButtonClass}
                    title="Rotate left 90°"
                  >
                    ⟲ Left
                  </button>
                  <button
                    onClick={() => updateSelected({ rotation: rotate(selected.rotation, 90) })}
                    className={addButtonClass}
                    title="Rotate right 90°"
                  >
                    ⟳ Right
                  </button>
                  <span className="text-gray-500 text-xs">{selected.rotation ?? 0}°</span>
                </div>
              </label>

              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                <span>x: {selected.x}mm</span>
                <span>y: {selected.y}mm</span>
                <span>w: {selected.width}mm</span>
                <span>h: {selected.height}mm</span>
              </div>

              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => duplicate(selected)} className="text-gray-500 hover:text-gray-900">
                  Duplicate
                </button>
                <button onClick={deleteSelected} className="text-red-600 hover:text-red-700">
                  Delete element
                </button>
              </div>
              <p className="text-xs text-gray-400">Cmd/Ctrl+C then Cmd/Ctrl+V also works.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
