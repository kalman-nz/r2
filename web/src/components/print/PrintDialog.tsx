import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import type { LabelDataContext, LabelTemplateData } from "../../lib/labelSpec";
import { downloadLabelsPdf, renderForPdf, renderForPrinter, renderPreview, sendToPrinters, type PrintJob } from "../../lib/print";
import { printGeometry, sizeForTemplate, usePrinting } from "../../lib/printing";
import { useCan } from "../../lib/roles";
import { useToast } from "../ToastProvider";
import { usePrinterChoice } from "./usePrinterChoice";

type Template = LabelTemplateData & { id: string };

interface Progress {
  done: number;
  total: number;
  failed: { index: number; message: string }[];
  printer: string;
  movedFrom: string[]; // printers that couldn't be reached, so the rest went elsewhere
  finished: boolean;
}

// Choose a template and a printer, see exactly what will print (stepping
// through every label in a batch), then print with progress. `count`
// labels, each filled from getContext(i); copies multiply that.
export default function PrintDialog({
  count,
  getContext,
  getName,
  getJob,
  onClose,
  onDone,
}: {
  count: number;
  getContext: (index: number) => LabelDataContext;
  getName: (index: number) => string;
  getJob: (index: number, template: Template) => PrintJob;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { showToast } = useToast();
  const can = useCan();
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: locations = [] } = useLocations();

  const [templateId, setTemplateId] = useState<string | null>(null);
  const sortedTemplates = useMemo(() => {
    const list = [...(templates ?? [])];
    list.sort((a, b) => Number(b.id === settings?.defaultTemplateId) - Number(a.id === settings?.defaultTemplateId) || a.name.localeCompare(b.name));
    return list;
  }, [templates, settings?.defaultTemplateId]);
  const template = sortedTemplates.find((t) => t.id === templateId) ?? sortedTemplates[0] ?? null;

  const { data: printingConfig } = usePrinting();
  const sizes = printingConfig?.sizes ?? [];
  const size = template ? sizeForTemplate(template, sizes) : null;
  const { choices, fitting, chosen, chain, choose, status, checking, preferred, rememberChosen } = usePrinterChoice(size);

  const [index, setIndex] = useState(0);
  const [copies, setCopies] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const stopRef = useRef(false);

  // Render the label being looked at.
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    setPreview(null);
    renderPreview(template, getContext(index)).then((url) => {
      if (!cancelled) setPreview(url);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getContext is a fresh closure each render
  }, [template, index]);

  const total = count * copies;
  const printing = !!progress && !progress.finished;

  async function print(only?: number[]) {
    if (!template || chain.length === 0) return;
    const indexes = only ?? Array.from({ length: count }, (_, i) => i);
    stopRef.current = false;
    let currentChain = chain;
    const state: Progress = { done: 0, total: indexes.length * copies, failed: [], printer: chain[0].name, movedFrom: [], finished: false };
    setProgress({ ...state });
    for (const i of indexes) {
      if (stopRef.current) break;
      let rendered: { image: string; label: string };
      try {
        rendered = await renderForPrinter(template, getContext(i), size);
      } catch (err) {
        state.failed.push({ index: i, message: errorText(err) });
        state.done += copies;
        setProgress({ ...state });
        continue;
      }
      for (let c = 0; c < copies && !stopRef.current; c++) {
        // Sequential: the printer takes one job at a time.
        const result = await sendToPrinters(getJob(i, template), rendered.image, rendered.label, currentChain);
        if (result.skipped.length > 0) {
          // Stick with the printer that worked for the rest of the batch.
          for (const p of result.skipped) if (!state.movedFrom.includes(p.name)) state.movedFrom.push(p.name);
          currentChain = currentChain.filter((p) => !result.skipped.includes(p));
        }
        if (result.ok) state.printer = result.printer;
        else state.failed.push({ index: i, message: result.message });
        state.done++;
        setProgress({ ...state });
        if (currentChain.length === 0) stopRef.current = true;
      }
    }
    state.finished = true;
    setProgress({ ...state });
    const printed = state.done - state.failed.length;
    if (state.failed.length === 0 && !stopRef.current) {
      const moved = state.movedFrom.length > 0 ? ` (${listNames(state.movedFrom, "and")} ${state.movedFrom.length > 1 ? "were" : "was"} offline)` : "";
      showToast("success", `Printed ${printed} label${printed === 1 ? "" : "s"} on ${state.printer}${moved}`);
      onDone?.();
      onClose();
    }
  }

  async function downloadPdf() {
    if (!template) return;
    setDownloading(true);
    try {
      const labels = [];
      for (let i = 0; i < count; i++) {
        labels.push({ imageDataUrl: await renderForPdf(template, getContext(i)), widthMm: template.widthMm, heightMm: template.heightMm, copies });
      }
      await downloadLabelsPdf(labels);
      onDone?.();
      onClose();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  // Keyboard: Esc closes, arrows step through the batch, Enter prints.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((document.activeElement as HTMLElement | null)?.tagName ?? "");
    if (e.key === "Escape" && !printing) onClose();
    else if (typing) return;
    else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    else if (e.key === "ArrowRight") setIndex((i) => Math.min(count - 1, i + 1));
    else if (e.key === "Enter" && !progress && chosen && preview) print();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? "";
  const geometry = template ? printGeometry(template, size) : null;
  const unfit = choices.filter((c) => !c.fits);

  return (
    <div onClick={() => !printing && onClose()} className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div
        role="dialog"
        aria-label="Print labels"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl card shadow-xl flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{count === 1 ? "Print label" : `Print ${count} labels`}</h2>
            <p className="text-xs text-gray-500 truncate">{count === 1 ? getName(0) : `${getName(0)} and ${count - 1} more`}</p>
          </div>
          <button onClick={onClose} disabled={printing} className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30" aria-label="Close">
            ×
          </button>
        </header>

        {templates && sortedTemplates.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No label templates yet.{" "}
            {can("templates.create") && (
              <Link to="/labels/new" className="text-signal-ink hover:underline">
                Make one
              </Link>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid md:grid-cols-[minmax(0,1fr)_20rem] overflow-y-auto md:overflow-hidden">
            {/* Preview */}
            <div className="flex flex-col bg-gray-50 md:border-r border-gray-100 min-h-[16rem] md:min-h-[26rem]">
              <div className="relative flex-1 min-h-0 flex items-center justify-center p-8 bg-[radial-gradient(circle,rgb(0_0_0/0.06)_1px,transparent_1px)] [background-size:14px_14px]">
                {preview && template ? (
                  <img
                    src={preview}
                    alt={`Label for ${getName(index)}`}
                    className="bg-white shadow-md ring-1 ring-black/5 max-w-full max-h-full object-contain"
                    style={{ aspectRatio: `${template.widthMm} / ${template.heightMm}`, width: template.widthMm >= template.heightMm ? "min(100%, 30rem)" : undefined, height: template.heightMm > template.widthMm ? "min(100%, 22rem)" : undefined }}
                  />
                ) : (
                  <span className="text-sm text-gray-400">Rendering…</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
                <span className="truncate">
                  {template && `${template.widthMm} × ${template.heightMm} mm`}
                  {size && ` · ${size.name}`}
                  {geometry?.rotate && " · prints turned to fit the stock"}
                </span>
                {count > 1 && (
                  <div className="flex items-center gap-1 shrink-0">
                    <PagerButton label="Previous label" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                      ‹
                    </PagerButton>
                    <span className="font-mono tabular-nums min-w-14 text-center" title={getName(index)}>
                      {index + 1} / {count}
                    </span>
                    <PagerButton label="Next label" disabled={index === count - 1} onClick={() => setIndex(index + 1)}>
                      ›
                    </PagerButton>
                  </div>
                )}
              </div>
            </div>

            {/* Options */}
            <div className="flex flex-col gap-5 p-5 md:overflow-y-auto">
              <Section title="Template">
                {sortedTemplates.length > 5 ? (
                  <select value={template?.id ?? ""} onChange={(e) => setTemplateId(e.target.value)} disabled={!!progress} className="input py-1.5">
                    {sortedTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.widthMm}×{t.heightMm}mm){t.id === settings?.defaultTemplateId ? " · default" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-col gap-1">
                    {sortedTemplates.map((t) => (
                      <OptionCard key={t.id} selected={t.id === template?.id} disabled={!!progress} onClick={() => setTemplateId(t.id)}>
                        <span className="font-medium text-gray-900 truncate">{t.name}</span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {t.widthMm}×{t.heightMm}mm{t.id === settings?.defaultTemplateId && " · default"}
                        </span>
                      </OptionCard>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Printer" aside={checking ? <span className="text-xs text-gray-400">Checking…</span> : null}>
                {fitting.length === 0 ? (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
                    {!size
                      ? "This template's size isn't one of your label sizes, so it can only be printed from a PDF."
                      : !size.brother
                        ? `${size.name} prints from a PDF — download it and print from that printer.`
                        : `No printer has ${size.name} loaded. Load it in one, or download a PDF.`}
                    {can("settings.edit") && (
                      <>
                        {" "}
                        <Link to="/settings/printer" className="underline">
                          Printer setup
                        </Link>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {fitting.map(({ printer: p }) => {
                      const s = status[p.id];
                      return (
                        <OptionCard key={p.id} selected={chosen?.id === p.id} disabled={!!progress} onClick={() => choose(p.id)}>
                          <span className="flex items-center gap-2 min-w-0">
                            <StatusDot state={s ? (s.ok ? "online" : "offline") : checking ? "checking" : "unknown"} />
                            <span className="font-medium text-gray-900 truncate">{p.name}</span>
                          </span>
                          <span className="text-xs text-gray-500 shrink-0">
                            {s && !s.ok ? "Offline" : [locationName(p.locationId), p.id === preferred ? "this device" : ""].filter(Boolean).join(" · ")}
                          </span>
                        </OptionCard>
                      );
                    })}
                    {chosen && (
                      <label className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                        <input type="checkbox" checked={chosen.id === preferred} onChange={(e) => rememberChosen(e.target.checked)} />
                        Use {chosen.name} on this device by default
                      </label>
                    )}
                  </div>
                )}
                {unfit.length > 0 && (
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer select-none hover:text-gray-700">
                      {unfit.length} other printer{unfit.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-1 pl-3">
                      {unfit.map((c) => (
                        <li key={c.printer.id}>
                          <span className="text-gray-700">{c.printer.name}</span> — {c.note}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Section>

              <Section title="Copies">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center rounded-md border border-gray-300 bg-white">
                    <StepButton label="Fewer copies" disabled={copies <= 1 || !!progress} onClick={() => setCopies(copies - 1)}>
                      −
                    </StepButton>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={copies}
                      disabled={!!progress}
                      onChange={(e) => setCopies(Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))))}
                      className="w-12 text-center text-sm py-1 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                      aria-label="Copies"
                    />
                    <StepButton label="More copies" disabled={copies >= 999 || !!progress} onClick={() => setCopies(copies + 1)}>
                      +
                    </StepButton>
                  </div>
                  <span className="text-xs text-gray-500">
                    {count > 1 ? `${count} × ${copies} = ${total} labels` : copies > 1 ? `${total} labels` : "1 label"}
                  </span>
                </div>
              </Section>
            </div>
          </div>
        )}

        <footer className="px-5 py-3 border-t border-gray-100 bg-white">
          {progress ? (
            <ProgressFooter
              progress={progress}
              getName={getName}
              onStop={() => (stopRef.current = true)}
              onRetry={() => print([...new Set(progress.failed.map((f) => f.index))])}
              onClose={() => {
                if (progress.done > progress.failed.length) onDone?.();
                onClose();
              }}
              canRetry={chain.length > 0}
            />
          ) : (
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button onClick={onClose} className="btn-secondary mr-auto sm:mr-0">
                Cancel
              </button>
              <button onClick={downloadPdf} disabled={downloading || !template} className="btn-secondary">
                {downloading ? "Making PDF…" : "Download PDF"}
              </button>
              <button onClick={() => print()} disabled={!template || !chosen || !preview} className="btn-primary px-4">
                {total > 1 ? `Print ${total} labels` : "Print"}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function ProgressFooter({
  progress,
  getName,
  onStop,
  onRetry,
  onClose,
  canRetry,
}: {
  progress: Progress;
  getName: (index: number) => string;
  onStop: () => void;
  onRetry: () => void;
  onClose: () => void;
  canRetry: boolean;
}) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const printed = progress.done - progress.failed.length;
  const failedNames = [...new Set(progress.failed.map((f) => getName(f.index)))];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-gray-700">
          {progress.finished
            ? printed === 0
              ? "Nothing printed"
              : `Printed ${printed} of ${progress.total} on ${progress.printer}`
            : `Printing ${progress.done + 1} of ${progress.total} on ${progress.printer}…`}
        </span>
        <div className="flex items-center gap-2">
          {!progress.finished && (
            <button onClick={onStop} className="btn-secondary">
              Stop
            </button>
          )}
          {progress.finished && progress.failed.length > 0 && canRetry && (
            <button onClick={onRetry} className="btn-secondary">
              Retry {progress.failed.length} failed
            </button>
          )}
          {progress.finished && (
            <button onClick={onClose} className="btn-primary">
              Close
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full transition-[width] ${progress.failed.length > 0 ? "bg-amber-500" : "bg-signal"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.movedFrom.length > 0 && (
        <p className="text-xs text-amber-700">
          {printed > 0 && !progress.movedFrom.includes(progress.printer)
            ? `${listNames(progress.movedFrom)} couldn't be reached, so labels went to ${progress.printer} instead.`
            : `Couldn't reach ${listNames(progress.movedFrom, "or")}. Check ${progress.movedFrom.length > 1 ? "they're" : "it's"} switched on and on the network.`}
        </p>
      )}
      {progress.failed.length > 0 && (
        <p className="text-xs text-red-600">
          Failed: {failedNames.slice(0, 6).join(", ")}
          {failedNames.length > 6 && ` and ${failedNames.length - 6} more`} — {progress.failed[progress.failed.length - 1].message}
        </p>
      )}
    </div>
  );
}

// "A, B and C"
function listNames(names: string[], joiner = "and"): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${joiner} ${names[names.length - 1]}`;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function OptionCard({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-left text-sm transition-colors disabled:opacity-60 ${
        selected ? "border-signal bg-signal-soft/60 ring-1 ring-signal/30" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

function StatusDot({ state }: { state: "online" | "offline" | "checking" | "unknown" }) {
  const cls = {
    online: "bg-emerald-500",
    offline: "bg-red-500",
    checking: "bg-gray-300 animate-pulse",
    unknown: "bg-gray-300",
  }[state];
  const title = { online: "Online", offline: "Not reachable", checking: "Checking…", unknown: "Not checked" }[state];
  return <span title={title} aria-label={title} className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="w-8 h-8 text-gray-600 hover:text-gray-900 disabled:opacity-30">
      {children}
    </button>
  );
}

function PagerButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 rounded-md text-base text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

