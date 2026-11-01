import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { renderLabelToCanvas } from "../lib/renderLabel";
import { buildCustomTextTemplate } from "../lib/customLabel";
import { COPIES, designText, downloadLabelsPdf, renderForPdf, renderForPrinter, sendToPrinters, type PrintJob } from "../lib/print";
import { sizeForTemplate, usePrinting, type LabelSize, type Printer } from "../lib/printing";
import { usePrinterChoice } from "../components/print/usePrinterChoice";
import { generateId } from "../lib/id";
import {
  DATA_FIELDS,
  SAMPLE_CONTEXT,
  type LabelDataContext,
  type LabelElement,
  type LabelTemplateData,
} from "../lib/labelSpec";
import { errorText } from "../lib/errors";
import LabelDesigner from "../components/LabelDesigner";
import { useToast } from "../components/ToastProvider";
import NumberInput from "../components/NumberInput";
import { numberProblem } from "../lib/numbers";
import { api } from "../lib/api";

// px per mm the preview is drawn at. It's shown smaller when that doesn't
// fit, but never larger, so it stays sharp.
const PREVIEW_SCALE = 10;

type Mode = "build" | "template";

interface Design {
  widthMm: number;
  heightMm: number;
  sizeId?: string;
  elements: LabelElement[];
}

// A fresh label starts as one big centred line of text filling it, ready to type over.
function starterDesign(): Design {
  const [text] = buildCustomTextTemplate("Label text", 62, 29).elements;
  return { widthMm: 62, heightMm: 29, sizeId: "tape-62", elements: [{ ...text, id: generateId() }] };
}

// Whether an element fills the whole label, like the starter's big text.
function fillsLabel(el: LabelElement, design: Design) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  return !el.rotation && near(el.x, 0) && near(el.y, 0) && near(el.width, design.widthMm) && near(el.height, design.heightMm);
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
      <h1 className="text-lg font-semibold text-gray-900">Print label</h1>

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

// Renders a design for the stock it's on and sends it `copies` times, to
// the chosen printer or (when that can't be reached) the next with the
// same stock.
async function printToChain(
  design: Pick<LabelTemplateData, "widthMm" | "heightMm" | "elements">,
  context: LabelDataContext,
  size: LabelSize | null,
  job: PrintJob,
  copies: number,
  chain: Printer[],
  showToast: (type: "success" | "error", message: string) => void,
) {
  const { image, label } = await renderForPrinter(design, context, size);
  let current = chain;
  let used = "";
  await printCopies(
    copies,
    async () => {
      const result = await sendToPrinters(job, image, label, current);
      current = current.filter((p) => !result.skipped.includes(p));
      if (result.ok) used = result.printer;
      return result;
    },
    (type, message) => showToast(type, type === "success" && used ? `${message} on ${used}` : message),
  );
}

// Copies, the printer, PDF and Print. Only printers with the label's stock
// loaded are offered. Nothing goes out while the copies or (problem) the
// label's size are wrong; what's wrong is said under the buttons.
function PrintActions({
  size,
  copies,
  onCopies,
  onDownload,
  downloading,
  onPrint,
  printing,
  disabled,
  problem,
}: {
  size: LabelSize | null;
  copies: number;
  onCopies: (n: number) => void;
  onDownload: () => void;
  downloading: boolean;
  onPrint: (chain: Printer[]) => void;
  printing: boolean;
  disabled: boolean;
  problem?: string | null;
}) {
  const { fitting, chosen, chain, choose, status } = usePrinterChoice(size);
  const copiesProblem = numberProblem(copies, COPIES);
  const blocked = disabled || !!problem || !!copiesProblem;
  return (
    <div className="flex items-center justify-end gap-3 flex-wrap">
      {fitting.length > 0 ? (
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Printer
          <select value={chosen?.id ?? ""} onChange={(e) => choose(e.target.value)} className="input py-1 w-auto">
            {fitting.map(({ printer }) => (
              <option key={printer.id} value={printer.id}>
                {printer.name}
                {status[printer.id] && !status[printer.id]!.ok ? " (offline)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="text-xs text-gray-500">
          {size?.brother ? `No printer has ${size.name} loaded — download a PDF.` : "This size prints from a PDF."}
        </span>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-500">
        Copies
        <NumberInput min={COPIES.min} max={COPIES.max} integer value={copies} onChange={onCopies} className="w-16 input py-1" ariaLabel="Copies" />
      </label>
      <button onClick={onDownload} disabled={downloading || blocked} className="btn-secondary py-2">
        {downloading ? "Making PDF…" : "Download PDF"}
      </button>
      <button onClick={() => onPrint(chain)} disabled={printing || blocked || chain.length === 0} className="btn-primary py-2 px-4">
        {printing ? "Printing…" : copies > 1 && !copiesProblem ? `Print ${copies}` : "Print"}
      </button>
      {(problem || copiesProblem) && (
        <p className="basis-full text-right text-xs text-fault-ink">{problem ?? `Copies has to be a whole number from ${COPIES.min} to ${COPIES.max}`}</p>
      )}
    </div>
  );
}

function BuildMode({ design, onChange }: { design: Design; onChange: (update: (prev: Design) => Design) => void }) {
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [firstElementId] = useState(() => design.elements[0]?.id ?? null);
  // A size typed out of range: the label keeps its last good one meanwhile.
  const [sizeProblem, setSizeProblem] = useState<string | null>(null);
  const { showToast } = useToast();
  const { data: printingConfig } = usePrinting();
  const size = sizeForTemplate(design, printingConfig?.sizes ?? []);
  const empty = design.elements.length === 0;

  async function print(chain: Printer[]) {
    setPrinting(true);
    try {
      await printToChain(design, SAMPLE_CONTEXT, size, { customText: designText(design) }, copies, chain, showToast);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const imageDataUrl = await renderForPdf(design, SAMPLE_CONTEXT);
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
        sizeId={design.sizeId}
        elements={design.elements}
        onSizeChange={(widthMm, heightMm, sizeId) =>
          // What filled the label still does, so its text (shrinking to
          // fit) never runs off the edge.
          onChange((prev) => ({
            ...prev,
            widthMm,
            heightMm,
            sizeId,
            elements: prev.elements.map((el) => (fillsLabel(el, prev) ? { ...el, width: widthMm, height: heightMm } : el)),
          }))
        }
        onSizeProblem={setSizeProblem}
        onElementsChange={(update) =>
          onChange((prev) => ({ ...prev, elements: typeof update === "function" ? update(prev.elements) : update }))
        }
        dataFields={false}
        initialSelectedId={firstElementId}
      />
      <PrintActions
        size={size}
        copies={copies}
        onCopies={setCopies}
        onDownload={downloadPdf}
        downloading={downloading}
        onPrint={print}
        printing={printing}
        disabled={empty}
        problem={sizeProblem}
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
  const { data: printingConfig } = usePrinting();
  const size = template ? sizeForTemplate(template, printingConfig?.sizes ?? []) : null;
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

  async function print(chain: Printer[]) {
    if (!template) return;
    setPrinting(true);
    try {
      await printToChain(template, context, size, { templateId: template.id }, copies, chain, showToast);
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
      const imageDataUrl = await renderForPdf(template, context);
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
          caption={template ? `${template.widthMm} × ${template.heightMm} mm${size ? ` · ${size.name}` : ""}` : undefined}
          placeholder="Choose a template to preview it here."
        />
      }
      actions={
        <PrintActions
          size={size}
          copies={copies}
          onCopies={setCopies}
          onDownload={downloadPdf}
          downloading={downloading}
          onPrint={print}
          printing={printing}
          disabled={!template}
        />
      }
    />
  );
}
