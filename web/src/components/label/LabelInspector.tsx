import { useRef, type ReactNode } from "react";
import NumberInput from "../NumberInput";
import { normalizeAngle, roundMm } from "../../lib/labelGeometry";
import { typeName, type FieldOption } from "./labelNames";
import {
  applyFolderLevels,
  SAMPLE_CONTEXT,
  type InkColor,
  type LabelElement,
  type LabelFont,
} from "../../lib/labelSpec";


// `key` groups rapid edits (typing in one field) into a single undo step.
export type PatchFn = (patch: Partial<LabelElement>, key?: string) => void;

const FONTS: { value: LabelFont; label: string }[] = [
  { value: "system", label: "Sans (default)" },
  { value: "archivo", label: "Archivo" },
  { value: "condensed", label: "Archivo Condensed" },
  { value: "mono", label: "Plex Mono" },
  { value: "serif", label: "Serif" },
];

const isText = (el: LabelElement) => el.type === "text" || el.type === "staticText";
const isShape = (el: LabelElement) => el.type === "rect" || el.type === "ellipse" || el.type === "line";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 pt-3 border-t border-gray-100 first:border-t-0 first:pt-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white pl-2 focus-within:border-signal focus-within:ring-2 focus-within:ring-signal/20">
      <span className="text-xs text-gray-400 w-3 shrink-0">{label}</span>
      <NumberInput
        clamp
        min={min}
        max={max}
        value={roundMm(value)}
        onChange={onChange}
        className="w-full min-w-0 py-1 text-sm bg-transparent focus:outline-none"
      />
      {suffix && <span className="text-xs text-gray-400 pr-2">{suffix}</span>}
    </label>
  );
}

// A row of toggle buttons for one choice.
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-gray-300 bg-gray-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
            o.value === value ? "bg-white text-gray-900 font-medium shadow-sm ring-1 ring-gray-200" : "text-gray-500 hover:text-gray-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-gray-600">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </div>
  );
}

const smallButton = "px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50";

const alignIcon = (lines: number[], anchor: "start" | "mid" | "end") => (
  <svg viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="mx-auto">
    {lines.map((len, i) => {
      const x1 = anchor === "start" ? 2 : anchor === "end" ? 14 - len : 8 - len / 2;
      return <line key={i} x1={x1} x2={x1 + len} y1={3.5 + i * 4.5} y2={3.5 + i * 4.5} />;
    })}
  </svg>
);

export function ElementInspector({
  el,
  dataFields,
  fieldOptions,
  customFieldOptions,
  onPatch,
  onFit,
  onReplaceImage,
  onDuplicate,
  onDelete,
}: {
  el: LabelElement;
  dataFields: boolean;
  fieldOptions: FieldOption[];
  customFieldOptions: FieldOption[];
  onPatch: PatchFn;
  onFit: () => void;
  onReplaceImage: (file: File) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const replaceRef = useRef<HTMLInputElement>(null);
  const k = (field: string) => `${el.id}:${field}`;
  const ratio = el.height > 0 ? el.width / el.height : 1;
  const textStyle: "black" | "white" | "inverted" = el.inverted ? "inverted" : (el.color ?? "black");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-800">{typeName(el.type, dataFields)}</h3>
        <button
          type="button"
          onClick={() => onPatch({ locked: !el.locked })}
          className={`${smallButton} ${el.locked ? "border-signal text-signal-ink bg-signal-soft" : ""}`}
          title="A locked element can't be moved on the canvas — select it from Layers"
        >
          {el.locked ? "Locked" : "Lock"}
        </button>
      </div>

      <Section title="Position">
        <div className="grid grid-cols-2 gap-1.5">
          <Num label="X" value={el.x} onChange={(x) => onPatch({ x: roundMm(x) }, k("x"))} suffix="mm" />
          <Num label="Y" value={el.y} onChange={(y) => onPatch({ y: roundMm(y) }, k("y"))} suffix="mm" />
          <Num
            label="W"
            min={0.5}
            value={el.width}
            onChange={(width) => onPatch(el.lockAspect ? { width, height: roundMm(width / ratio) } : { width }, k("w"))}
            suffix="mm"
          />
          <Num
            label="H"
            min={0.5}
            value={el.height}
            onChange={(height) => onPatch(el.lockAspect ? { height, width: roundMm(height * ratio) } : { height }, k("h"))}
            suffix="mm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <Num label="↻" value={el.rotation ?? 0} onChange={(r) => onPatch({ rotation: normalizeAngle(r) }, k("rot"))} suffix="°" />
          </div>
          <button type="button" className={smallButton} title="Rotate 90° left" onClick={() => onPatch({ rotation: normalizeAngle((el.rotation ?? 0) - 90) })}>
            ⟲
          </button>
          <button type="button" className={smallButton} title="Rotate 90° right" onClick={() => onPatch({ rotation: normalizeAngle((el.rotation ?? 0) + 90) })}>
            ⟳
          </button>
        </div>
        {(el.type === "barcode" || el.type === "qr" || el.type === "image" || isShape(el)) && (
          <Check checked={el.lockAspect ?? false} onChange={(lockAspect) => onPatch({ lockAspect })}>
            Keep proportions
          </Check>
        )}
      </Section>

      {(isText(el) || el.type === "barcode" || el.type === "qr" || el.type === "image") && (
        <Section title="Content">
          {dataFields && (el.type === "text" || el.type === "barcode" || el.type === "qr") && (
            <Row label="Data field">
              <select value={el.dataField} onChange={(e) => onPatch({ dataField: e.target.value })} className="input py-1">
                {fieldOptions.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
                {customFieldOptions.length > 0 && (
                  <optgroup label="Custom fields">
                    {customFieldOptions.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Row>
          )}

          {!dataFields && (el.type === "barcode" || el.type === "qr") && (
            <Row label="Value">
              <input
                value={el.text ?? ""}
                onChange={(e) => onPatch({ text: e.target.value }, k("text"))}
                placeholder={el.type === "qr" ? "Text or a link" : "Letters and numbers"}
                className="input py-1"
              />
            </Row>
          )}

          {el.dataField === "equipmentFolder" && (el.type === "text" || el.type === "barcode" || el.type === "qr") && (
            <Row label="Folder levels">
              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 4, 5].map((level) => {
                  const active = (el.folderLevels ?? []).includes(level);
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        const current = el.folderLevels ?? [];
                        onPatch({ folderLevels: active ? current.filter((l) => l !== level) : [...current, level] });
                      }}
                      className={`w-7 h-7 rounded border text-xs ${
                        active ? "border-signal text-signal-ink bg-signal-soft" : "border-gray-300 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => onPatch({ folderLevels: [] })}
                  className={`px-2 h-7 rounded border text-xs ${
                    (el.folderLevels ?? []).length === 0 ? "border-signal text-signal-ink bg-signal-soft" : "border-gray-300 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  All
                </button>
              </div>
              <span className="text-xs text-gray-400">
                e.g. "{applyFolderLevels(SAMPLE_CONTEXT.equipmentFolder, el.folderLevels) || "(empty)"}" for {SAMPLE_CONTEXT.equipmentFolder}
              </span>
            </Row>
          )}

          {el.type === "staticText" && (
            <textarea
              value={el.text ?? ""}
              onChange={(e) => onPatch({ text: e.target.value }, k("text"))}
              rows={2}
              className="input py-1 resize-y"
            />
          )}

          {el.type === "image" && (
            <div className="flex items-center gap-2">
              {el.imageData && <img src={el.imageData} alt="" className="h-12 max-w-[50%] object-contain border border-gray-200 rounded bg-white" />}
              <button type="button" onClick={() => replaceRef.current?.click()} className={smallButton}>
                Replace image
              </button>
              <input
                ref={replaceRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onReplaceImage(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </Section>
      )}

      {isText(el) && (
        <Section title="Text">
          <select value={el.font ?? "system"} onChange={(e) => onPatch({ font: e.target.value as LabelFont })} className="input py-1">
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <div className="flex-1">
              <Num label="Aa" min={0.5} value={el.fontSize ?? 4} onChange={(fontSize) => onPatch({ fontSize }, k("size"))} suffix="mm" />
            </div>
            <button type="button" onClick={onFit} className={smallButton} title="As big as fits in the box">
              Fit
            </button>
            <button
              type="button"
              onClick={() => onPatch({ bold: !el.bold })}
              className={`${smallButton} w-8 font-bold ${el.bold ? "border-signal text-signal-ink bg-signal-soft" : ""}`}
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => onPatch({ italic: !el.italic })}
              className={`${smallButton} w-8 italic font-serif ${el.italic ? "border-signal text-signal-ink bg-signal-soft" : ""}`}
              title="Italic"
            >
              I
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Choice
              value={el.align ?? "left"}
              onChange={(align) => onPatch({ align })}
              options={[
                { value: "left", label: alignIcon([12, 8, 10], "start"), title: "Left" },
                { value: "center", label: alignIcon([12, 8, 10], "mid"), title: "Centre" },
                { value: "right", label: alignIcon([12, 8, 10], "end"), title: "Right" },
              ]}
            />
            <Choice
              value={el.valign ?? "top"}
              onChange={(valign) => onPatch({ valign })}
              options={[
                { value: "top", label: "Top", title: "Top" },
                { value: "middle", label: "Mid", title: "Middle" },
                { value: "bottom", label: "Btm", title: "Bottom" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Row label="Line height">
              <NumberInput
                clamp
                min={0.6}
                max={3}
                value={el.lineHeight ?? 1.2}
                onChange={(lineHeight) => onPatch({ lineHeight }, k("lh"))}
                className="input py-1"
              />
            </Row>
            <Row label="Padding (mm)">
              <NumberInput clamp min={0} value={el.padding ?? 0} onChange={(padding) => onPatch({ padding }, k("pad"))} className="input py-1" />
            </Row>
          </div>
          <Row label="Ink">
            <Choice
              value={textStyle}
              onChange={(v) => onPatch(v === "inverted" ? { inverted: true } : { inverted: false, color: v as InkColor })}
              options={[
                { value: "black", label: "Black" },
                { value: "white", label: "White", title: "White text, for on top of a black box" },
                { value: "inverted", label: "Inverted", title: "White text on a black box" },
              ]}
            />
          </Row>
          {el.inverted && (
            <Row label="Corner radius (mm)">
              <NumberInput clamp min={0} value={el.cornerRadius ?? 0} onChange={(cornerRadius) => onPatch({ cornerRadius }, k("radius"))} className="input py-1" />
            </Row>
          )}
          <Check checked={el.wrap ?? false} onChange={(wrap) => onPatch({ wrap })}>
            Wrap onto more lines (instead of squeezing onto one)
          </Check>
          <Check checked={el.shrink ?? false} onChange={(shrink) => onPatch({ shrink })}>
            Shrink to fit
          </Check>
          {el.wrap && (
            <Check checked={el.breakWords ?? true} onChange={(breakWords) => onPatch({ breakWords })}>
              Break long words that don't fit
            </Check>
          )}
        </Section>
      )}

      {el.type === "barcode" && (
        <Section title="Barcode">
          <Check checked={el.showText ?? false} onChange={(showText) => onPatch({ showText })}>
            Print the value under the bars
          </Check>
          {el.showText && (
            <Row label="Text size (mm)">
              <NumberInput clamp min={1} value={el.fontSize ?? 2.5} onChange={(fontSize) => onPatch({ fontSize }, k("size"))} className="input py-1" />
            </Row>
          )}
        </Section>
      )}

      {isShape(el) && (
        <Section title={el.type === "line" ? "Line" : "Shape"}>
          {el.type !== "line" && (
            <Row label="Fill">
              <Choice
                value={el.fill ?? "none"}
                onChange={(fill) => onPatch({ fill })}
                options={[
                  { value: "none", label: "None" },
                  { value: "black", label: "Black" },
                  { value: "white", label: "White" },
                ]}
              />
            </Row>
          )}
          <Row label={el.type === "line" ? "Colour" : "Outline"}>
            <Choice
              value={el.stroke ?? "black"}
              onChange={(stroke) => onPatch({ stroke })}
              options={[
                ...(el.type === "line" ? [] : [{ value: "none" as const, label: "None" }]),
                { value: "black", label: "Black" },
                { value: "white", label: "White" },
              ]}
            />
          </Row>
          <div className="grid grid-cols-2 gap-1.5">
            <Row label="Thickness (mm)">
              <NumberInput clamp min={0.1} value={el.strokeWidth ?? 0.5} onChange={(strokeWidth) => onPatch({ strokeWidth }, k("sw"))} className="input py-1" />
            </Row>
            {el.type === "rect" && (
              <Row label="Corner radius (mm)">
                <NumberInput clamp min={0} value={el.cornerRadius ?? 0} onChange={(cornerRadius) => onPatch({ cornerRadius }, k("radius"))} className="input py-1" />
              </Row>
            )}
          </div>
          <Check checked={el.dashed ?? false} onChange={(dashed) => onPatch({ dashed })}>
            Dashed
          </Check>
        </Section>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-gray-100 text-sm">
        <button type="button" onClick={onDuplicate} className="text-gray-600 hover:text-gray-900">
          Duplicate
        </button>
        <button type="button" onClick={onDelete} className="text-red-600 hover:text-red-700 ml-auto">
          Delete
        </button>
      </div>
    </div>
  );
}

// Every element, topmost first. Click selects (Shift adds), the lock
// button stops it being moved on the canvas.
export function LayersList({
  elements,
  selectedIds,
  dataFields,
  fieldLabel,
  onSelect,
  onToggleLock,
}: {
  elements: LabelElement[];
  selectedIds: string[];
  dataFields: boolean;
  fieldLabel: (key: string) => string;
  onSelect: (id: string, additive: boolean) => void;
  onToggleLock: (id: string) => void;
}) {
  if (elements.length === 0) return <p className="text-xs text-gray-400">Nothing on the label yet.</p>;
  const describe = (el: LabelElement) => {
    if (el.type === "staticText" || (!dataFields && (el.type === "barcode" || el.type === "qr"))) return el.text || "(empty)";
    if (el.dataField) return fieldLabel(el.dataField);
    return "";
  };
  return (
    <ul className="flex flex-col">
      {[...elements].reverse().map((el) => {
        const selected = selectedIds.includes(el.id);
        return (
          <li key={el.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey || e.ctrlKey)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(el.id, false);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs ${
                selected ? "bg-signal-soft text-signal-ink" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span className="font-medium shrink-0">{typeName(el.type, dataFields)}</span>
              <span className="truncate text-gray-400 flex-1 min-w-0">{describe(el)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(el.id);
                }}
                title={el.locked ? "Unlock" : "Lock"}
                className={`shrink-0 ${el.locked ? "text-gray-700" : "text-gray-300 hover:text-gray-600"}`}
              >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
                  <path d={el.locked ? "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" : "M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"} />
                </svg>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
