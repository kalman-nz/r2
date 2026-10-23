import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { renderLabelToCanvas } from "../lib/renderLabel";
import { buildCustomTextTemplate } from "../lib/customLabel";
import { downloadLabelsPdf, printDesign, printWithManualData, renderDesignImage, renderTemplateImage } from "../lib/print";
import { generateId } from "../lib/id";
import {
  DATA_FIELDS,
  isBrotherWidth,
  type LabelDataContext,
  type LabelElement,
  type LabelTemplateData,
} from "../lib/labelSpec";
import { errorText } from "../lib/errors";
import LabelDesigner from "../components/LabelDesigner";
import { useToast } from "../components/ToastProvider";
import NumberInput from "../components/NumberInput";
import { api } from "../lib/api";

// px per mm the preview is drawn at. It's shown smaller when that doesn't
// fit, but never larger, so it stays sharp.
const PREVIEW_SCALE = 10;

type Mode = "build" | "template";

interface Design {
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

// A fresh label starts as one big centred line of text filling it, ready to type over.
function starterDesign(): Design {
  const [text] = buildCustomTextTemplate("Label text", 62, 29).elements;
  return { widthMm: 62, heightMm: 29, elements: [{ ...text, id: generateId() }] };
}

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
  const [mode, setMode] = useState<Mode>("build");
  // Kept here so switching to "From template" and back doesn't lose the label.
  const [design, setDesign] = useState(starterDesign);

  return (
    <div className="lg:h-full flex flex-col gap-4 lg:min-h-0">
      <h1 className="text-lg font-semibold text-gray-900">Custom label</h1>

      <div className="flex items-center gap-5 border-b border-gray-200">
        <button className={tabClass(mode === "build")} onClick={() => setMode("build")}>
          Build a label
        </button>
        <button className={tabClass(mode === "template")} onClick={() => setMode("template")}>
          From template
        </button>
      </div>

      {mode === "build" ? <BuildMode design={design} onChange={setDesign} /> : <FromTemplateMode />}
    </div>
  );
}

// Settings on the left; the preview takes the rest of the screen, with the
// print actions under it. Stacks on phones.
function Workspace({ controls, preview, actions }: { controls: ReactNode; preview: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-5">
      <div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">{controls}</div>
      <div className="flex flex-col gap-3 lg:min-h-0">
        {preview}
        {actions}
      </div>
    </div>
  );
}

// Fits the rendered label into whatever space the panel has.
function LabelPreview({ image, caption, placeholder }: { image: HTMLCanvasElement | null; caption?: string; placeholder?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
  }, [image]);

  const fit = image && box.width > 0 ? Math.min(1, box.width / image.width, box.height / image.height) : 0;

  return (
    <div className="flex-1 min-h-[18rem] lg:min-h-0 flex flex-col rounded-lg border border-gray-200 bg-gray-100">
      <div className="relative flex-1 min-h-0">
        <div ref={boxRef} className="absolute inset-6 flex items-center justify-center">
          {image ? (
            <canvas
              ref={canvasRef}
              className="bg-white shadow-sm"
              style={{ width: image.width * fit, height: image.height * fit }}
            />
          ) : (
            <p className="text-sm text-gray-500">{placeholder}</p>
          )}
        </div>
      </div>
      {image && caption && <p className="pb-3 text-center text-xs text-gray-500">{caption}</p>}
    </div>
  );
}

function PrintActions({
  copies,
  onCopies,
  onDownload,
  downloading,
  onPrint,
  printing,
  disabled,
  widthMm,
}: {
  copies: number;
  onCopies: (n: number) => void;
  onDownload: () => void;
  downloading: boolean;
  onPrint: () => void;
  printing: boolean;
  disabled: boolean;
  widthMm: number | undefined;
}) {
  const brother = widthMm !== undefined && isBrotherWidth(widthMm);
  return (
    <div className="flex items-center justify-end gap-3">
      <label className="flex items-center gap-2 text-sm text-gray-500">
        Copies
        <NumberInput min={1} value={copies} onChange={onCopies} className="w-14 input py-1" />
      </label>
      <button onClick={onDownload} disabled={downloading || disabled} className="btn-secondary py-2">
        {downloading ? "Making PDF…" : "Download PDF"}
      </button>
      <button
        onClick={onPrint}
        disabled={printing || disabled || !brother}
        title={disabled || brother ? undefined : "Not a Brother tape width — download a PDF instead"}
        className="btn-primary py-2 px-4"
      >
        {printing ? "Printing…" : "Print"}
      </button>
    </div>
  );
}

function BuildMode({ design, onChange }: { design: Design; onChange: (update: (prev: Design) => Design) => void }) {
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [firstElementId] = useState(() => design.elements[0]?.id ?? null);
  const { showToast } = useToast();
  const empty = design.elements.length === 0;

  async function print() {
    setPrinting(true);
    try {
      await printCopies(copies, () => printDesign(design), showToast);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const imageDataUrl = await renderDesignImage(design);
      await downloadLabelsPdf([{ imageDataUrl, widthMm: design.widthMm, heightMm: design.heightMm, copies }]);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-3">
      <LabelDesigner
        widthMm={design.widthMm}
        heightMm={design.heightMm}
        elements={design.elements}
        onSizeChange={(widthMm, heightMm) => onChange((prev) => ({ ...prev, widthMm, heightMm }))}
        onElementsChange={(update) =>
          onChange((prev) => ({ ...prev, elements: typeof update === "function" ? update(prev.elements) : update }))
        }
        dataFields={false}
        initialSelectedId={firstElementId}
      />
      <PrintActions
        copies={copies}
        onCopies={setCopies}
        onDownload={downloadPdf}
        downloading={downloading}
        onPrint={print}
        printing={printing}
        disabled={empty}
        widthMm={design.widthMm}
      />
    </div>
  );
}

// Every dataField a template actually uses, in first-used order — not
// filtered against DATA_FIELDS, since a template can reference an account
// custom field ("custom_12") that isn't in that fixed list.
function usedDataFields(template: LabelTemplateData): string[] {
  const keys: string[] = [];
  for (const el of template.elements) {
    if (el.dataField && !keys.includes(el.dataField)) keys.push(el.dataField);
  }
  return keys;
}

const EMPTY_CONTEXT: LabelDataContext = Object.fromEntries(DATA_FIELDS.map((f) => [f.key, ""])) as LabelDataContext;

function FromTemplateMode() {
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const { data: customFields = [] } = useQuery({ queryKey: ["customFields"], queryFn: api.listCustomFields });
  const [templateId, setTemplateId] = useState("");
  const [fieldValues, setFieldValues] = useState<LabelDataContext>({});
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const { showToast } = useToast();

  const fieldLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of DATA_FIELDS) map.set(f.key, f.label);
    for (const f of customFields) map.set(f.key, f.label);
    return (key: string) => map.get(key) ?? key;
  }, [customFields]);

  const template = templates?.find((t) => t.id === templateId);
  const fields = useMemo(() => (template ? usedDataFields(template) : []), [template]);
  const context: LabelDataContext = { ...EMPTY_CONTEXT, ...fieldValues };

  useEffect(() => {
    if (!template) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    renderLabelToCanvas(template, context, PREVIEW_SCALE).then((rendered) => {
      if (!cancelled) setPreview(rendered);
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

  async function downloadPdf() {
    if (!template) return;
    setDownloading(true);
    try {
      const imageDataUrl = await renderTemplateImage(template, context);
      await downloadLabelsPdf([{ imageDataUrl, widthMm: template.widthMm, heightMm: template.heightMm, copies }]);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Workspace
      controls={
        <>
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

          {fields.length > 0 && (
            <div className="flex flex-col gap-3 card p-3">
              {fields.map((key) => {
                const label = fieldLabel(key);
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
        </>
      }
      preview={
        <LabelPreview
          image={template ? preview : null}
          caption={template ? `${template.widthMm} × ${template.heightMm} mm` : undefined}
          placeholder="Choose a template to preview it here."
        />
      }
      actions={
        <PrintActions
          copies={copies}
          onCopies={setCopies}
          onDownload={downloadPdf}
          downloading={downloading}
          onPrint={print}
          printing={printing}
          disabled={!template}
          widthMm={template?.widthMm}
        />
      }
    />
  );
}
