import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { renderLabelToCanvas } from "../lib/renderLabel";
import { renderCustomTextCanvas } from "../lib/customLabel";
import { printCustomText, printWithManualData } from "../lib/print";
import {
  DATA_FIELDS,
  SAMPLE_CONTEXT,
  SIZE_PRESETS,
  TAPE_WIDTHS,
  type DataFieldKey,
  type LabelDataContext,
  type LabelTemplateData,
} from "../lib/labelSpec";
import { useToast } from "../components/ToastProvider";
import NumberInput from "../components/NumberInput";
import { api } from "../lib/api";

const PREVIEW_SCALE = 6; // px per mm — matches LabelEditor's on-screen scale

type Mode = "text" | "template";

function tabClass(active: boolean) {
  return active ? "tab-underline-active" : "tab-underline-inactive";
}

// Prints the same rendered PNG `copies` times, sequentially (the printer
// processes one job at a time), and reports a single summary toast.
async function printCopies(
  copies: number,
  print: () => Promise<{ ok: boolean; message: string }>,
  showToast: (type: "success" | "error", message: string) => void,
) {
  let failed = 0;
  let lastError = "";
  for (let i = 0; i < copies; i++) {
    const result = await print();
    if (!result.ok) {
      failed++;
      lastError = result.message;
    }
  }
  const ok = copies - failed;
  if (failed === 0) {
    showToast("success", `Printed ${ok} label${ok === 1 ? "" : "s"}`);
  } else {
    showToast("error", `Printed ${ok}/${copies}, ${failed} failed: ${lastError}`);
  }
}

export default function CustomLabelPage() {
  const [mode, setMode] = useState<Mode>("text");

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-gray-900">Custom label</h1>

      <div className="flex items-center gap-5 border-b border-gray-200 w-fit">
        <button className={tabClass(mode === "text")} onClick={() => setMode("text")}>
          Big text
        </button>
        <button className={tabClass(mode === "template")} onClick={() => setMode("template")}>
          From template
        </button>
      </div>

      {mode === "text" ? <BigTextMode /> : <FromTemplateMode />}
    </div>
  );
}

function BigTextMode() {
  const [text, setText] = useState("");
  const [widthMm, setWidthMm] = useState(62);
  const [heightMm, setHeightMm] = useState(29);
  const [rotate90, setRotate90] = useState(false);
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    renderCustomTextCanvas(text || "Sample text", widthMm, heightMm, PREVIEW_SCALE, rotate90, SAMPLE_CONTEXT).then(
      (rendered) => {
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.getContext("2d")?.drawImage(rendered, 0, 0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [text, widthMm, heightMm, rotate90]);

  async function print() {
    if (!text.trim()) return;
    setPrinting(true);
    try {
      await printCopies(copies, () => printCustomText(text, widthMm, heightMm, rotate90), showToast);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="customText" className="text-sm text-gray-500">
          Label text
        </label>
        <textarea
          id="customText"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Jam Stands"
          rows={2}
          className="input resize-none"
        />
      </div>

      <SizePicker widthMm={widthMm} heightMm={heightMm} onWidth={setWidthMm} onHeight={setHeightMm}>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={rotate90} onChange={(e) => setRotate90(e.target.checked)} />
          <span className="text-gray-500">Rotate 90°</span>
        </label>
      </SizePicker>

      <div className="flex items-center justify-center border border-gray-200 rounded-lg p-6 bg-gray-100 overflow-auto">
        <canvas ref={canvasRef} className="bg-white shadow-sm" />
      </div>

      <div className="flex items-center justify-end gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Copies
          <NumberInput min={1} value={copies} onChange={setCopies} className="w-14 input py-1" />
        </label>
        <button onClick={print} disabled={printing || !text.trim()} className="btn-primary py-2 px-4">
          {printing ? "Printing…" : "Print"}
        </button>
      </div>
    </div>
  );
}

function usedDataFields(template: LabelTemplateData): DataFieldKey[] {
  const keys = new Set<DataFieldKey>();
  for (const el of template.elements) {
    if (el.dataField) keys.add(el.dataField);
  }
  return DATA_FIELDS.filter((f) => keys.has(f.key)).map((f) => f.key);
}

const EMPTY_CONTEXT: LabelDataContext = Object.fromEntries(DATA_FIELDS.map((f) => [f.key, ""])) as LabelDataContext;

function FromTemplateMode() {
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const [templateId, setTemplateId] = useState("");
  const [fieldValues, setFieldValues] = useState<Partial<LabelDataContext>>({});
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { showToast } = useToast();

  const template = templates?.find((t) => t.id === templateId);
  const fields = useMemo(() => (template ? usedDataFields(template) : []), [template]);
  const context: LabelDataContext = { ...EMPTY_CONTEXT, ...fieldValues };

  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    renderLabelToCanvas(template, context, PREVIEW_SCALE).then((rendered) => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      canvas.getContext("2d")?.drawImage(rendered, 0, 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context is derived fresh every render from fieldValues
  }, [template, fieldValues]);

  async function print() {
    if (!template) return;
    setPrinting(true);
    try {
      await printCopies(copies, () => printWithManualData(template, context), showToast);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="template" className="text-sm text-gray-500">
          Template
        </label>
        <select
          id="template"
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setFieldValues({});
          }}
          className="input py-2"
        >
          <option value="">Select a template…</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.widthMm}×{t.heightMm}mm)
            </option>
          ))}
        </select>
      </div>

      {template && (
        <>
          {fields.length > 0 && (
            <div className="flex flex-col gap-3 card p-3">
              {fields.map((key) => {
                const label = DATA_FIELDS.find((f) => f.key === key)?.label ?? key;
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={`field-${key}`} className="text-sm text-gray-500">
                      {label}
                    </label>
                    <input
                      id={`field-${key}`}
                      type="text"
                      value={fieldValues[key] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="input py-2"
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-center border border-gray-200 rounded-lg p-6 bg-gray-100 overflow-auto">
            <canvas ref={canvasRef} className="bg-white shadow-sm" />
          </div>

          <div className="flex items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-500">
              Copies
              <NumberInput min={1} value={copies} onChange={setCopies} className="w-14 input py-1" />
            </label>
            <button onClick={print} disabled={printing} className="btn-primary py-2 px-4">
              {printing ? "Printing…" : "Print"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SizePicker({
  widthMm,
  heightMm,
  onWidth,
  onHeight,
  children,
}: {
  widthMm: number;
  heightMm: number;
  onWidth: (mm: number) => void;
  onHeight: (mm: number) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 card p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Preset</span>
        {SIZE_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              onWidth(p.widthMm);
              onHeight(p.heightMm);
            }}
            className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Tape width</span>
        <select value={widthMm} onChange={(e) => onWidth(Number(e.target.value))} className="input py-1">
          {TAPE_WIDTHS.map((w) => (
            <option key={w.mm} value={w.mm}>
              {w.mm}mm
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Length</span>
        <NumberInput min={5} value={heightMm} onChange={onHeight} className="input py-1 w-20" />
        <span className="text-gray-500">mm</span>
      </div>
      {children}
    </div>
  );
}
