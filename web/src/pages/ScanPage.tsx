import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type JobLineView, type TrackedProject } from "../lib/api";
import { formatDateTime, parseDate } from "../lib/format";
import { errorText } from "../lib/errors";
import { invalidateMaintenance } from "../lib/maintenance";
import { JobStatusBadge, TrackingStatus } from "../components/StatusBadge";
import { STATUS_COLOURS } from "../lib/statuses";
import { linesProgress, progressOf, useLayout, useTrackingSteps } from "../lib/tracking";
import NumberInput from "../components/NumberInput";
import NewRepairModal from "../components/repair/NewRepairModal";
import TrackingSuggestion from "../components/job/TrackingSuggestion";
import { useToast } from "../components/ToastProvider";
import TrackingBoard, { LayoutSwitch, NextStep } from "../components/tracking/TrackingBoard";
import { useCan, useFeature } from "../lib/roles";
import Breadcrumbs from "../components/Breadcrumbs";

// Equipment tracking: scanning kit to a step on a project (prepped,
// loaded, returned: each organisation's own steps). Works with a
// Bluetooth/USB scanner (it types the code and presses Enter into the
// focused box) or the phone's camera (see CameraScanner). Every rule —
// double scans, wrong job, over-scans, broken units — is checked
// server-side in lib/scan.js.
export default function ScanPage() {
  const { id } = useParams();
  return id ? <ScanJob jobId={id} /> : <ChooseJob />;
}

// Every tracked project going out, out or just back, as a board (a column
// per tracking step) or a list; pick one to scan its kit.
function ChooseJob() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useLayout();
  const { steps } = useTrackingSteps();
  const {
    data: projects = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tracking-projects"],
    queryFn: api.trackingProjects,
    refetchInterval: 30_000,
  });
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    return projects.filter((p) => !term || [String(p.number), p.name, p.client].some((v) => v.toLowerCase().includes(term)));
  }, [projects, search]);
  const withKit = filtered.filter((p) => p.needed > 0);
  const noKit = filtered.length - withKit.length;
  const now = Date.now();
  const open = (p: TrackedProject) => navigate(`/projects/${p.id}/scan`);
  // When it goes out, or (once it's out) when it's due back.
  const when = (p: TrackedProject) => {
    const back = p.status === "out" || p.status === "returned";
    const at = back ? p.returnAt : p.prepAt;
    const late = p.status !== "returned" && (parseDate(at)?.getTime() ?? Infinity) < now;
    return {
      text: `${back ? "Back" : "Goes out"} ${formatDateTime(at)}`,
      late,
    };
  };

  return (
    <div className={`${layout === "board" ? "max-w-none" : "max-w-2xl mx-auto"} w-full flex flex-col gap-3`}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Equipment tracking</h1>
          <p className="text-sm text-gray-500">Where every project's kit is. Pick one to prep, load or bring back its kit.</p>
        </div>
        <LayoutSwitch layout={layout} onChange={setLayout} />
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project number, name or client" className="input py-2 w-full max-w-sm" />
      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load projects: {errorText(error)}</p>}
      {!isLoading && layout === "board" && (
        <TrackingBoard
          steps={steps}
          items={withKit}
          itemKey={(p) => p.id}
          at={(p) => p.at}
          total={(p) => p.needed}
          empty="No projects"
          card={(p, progress) => {
            const w = when(p);
            return (
              <button
                onClick={() => open(p)}
                className="w-full text-left card px-3 py-2.5 flex flex-col gap-1.5 hover:border-gray-300 hover:shadow-sm transition-shadow"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-xs font-mono text-gray-500">#{p.number}</span>
                    <span className="block font-medium text-gray-900 leading-snug">{p.name}</span>
                  </span>
                  <JobStatusBadge status={p.status} jobStatus={p.jobStatus} />
                </span>
                {p.client && <span className="text-xs text-gray-500 truncate">{p.client}</span>}
                <span className={`text-xs ${w.late ? "text-fault-ink font-medium" : "text-gray-500"}`}>{w.text}</span>
                <span className="flex items-center justify-between gap-2">
                  <NextStep progress={progress} />
                  <span className="text-[11px] text-gray-400 ml-auto">{p.needed} units</span>
                </span>
                {p.suggestion && <span className="text-xs font-medium text-signal-ink">Everything's here: set to {p.suggestion}?</span>}
              </button>
            );
          }}
        />
      )}
      {!isLoading && layout === "list" && (
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {withKit.map((p) => {
            const w = when(p);
            return (
              <button key={p.id} onClick={() => open(p)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                <span className="flex flex-col min-w-0">
                  <span className="font-medium text-gray-900 truncate">
                    #{p.number} {p.name}
                  </span>
                  <span className={`text-xs truncate ${w.late ? "text-fault-ink" : "text-gray-500"}`}>{[p.client, w.text].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <TrackingStatus progress={progressOf(steps, p.at, p.needed)} compact />
                  <JobStatusBadge status={p.status} jobStatus={p.jobStatus} />
                </span>
              </button>
            );
          })}
          {withKit.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No projects to track.</p>}
        </div>
      )}
      {noKit > 0 && (
        <p className="text-xs text-gray-500">
          {noKit} project{noKit === 1 ? "" : "s"} with no physical kit {noKit === 1 ? "isn't" : "aren't"} shown.
        </p>
      )}
    </div>
  );
}

interface FeedEntry {
  id: number;
  ok: boolean;
  text: string;
  at: Date;
  // What came back in, so a fault can be reported against it.
  back?: { item: string; serial: string };
  repair?: { id: string; number: number };
}

// Short beeps so a scan can be confirmed without looking at the screen.
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    osc.onended = () => ctx.close();
  } catch {
    // no audio available — the on-screen feed still shows the result
  }
  if (!ok) navigator.vibrate?.(200);
}

function ScanJob({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { data: summary, error } = useQuery({
    queryKey: ["job-summary", jobId],
    queryFn: () => api.getJobSummary(jobId),
  });
  const can = useCan();
  const { steps: allSteps, isLoading: stepsLoading } = useTrackingSteps();
  // The steps this person can scan to: bringing kit back is its own permission.
  const steps = useMemo(() => allSteps.filter((s) => can(s.stage === "back" ? "scan.in" : "scan.out")), [allSteps, can]);
  const [stepId, setStepId] = useState("");
  const [heading, setHeading] = useState("");
  const [layout, setLayout] = useLayout();
  const [quantity, setQuantity] = useState(1);
  const [code, setCode] = useState("");
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [reporting, setReporting] = useState<FeedEntry | null>(null);
  const repairsOn = useFeature()("repairs");
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const feedId = useRef(0);

  // Which step to start on, decided once: the first back step for a project
  // that's out (or when asked, ?stage=back), else the next step its kit
  // hasn't all reached. Not after that: switching under someone mid-pack
  // would send the next unit somewhere else.
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || !summary || stepsLoading || steps.length === 0) return;
    decided.current = true;
    const back = steps.find((s) => s.stage === "back");
    if ((params.get("stage") === "back" || summary.job.status === "out") && back) return setStepId(back.id);
    const next = linesProgress(allSteps, summary.lines)?.next;
    const going = steps.filter((s) => s.stage !== "back");
    setStepId((next && going.some((s) => s.id === next.id) ? next : (going[0] ?? steps[0])).id);
  }, [summary, steps, allSteps, stepsLoading, params]);
  const step = steps.find((s) => s.id === stepId) ?? null;

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy || !step) return;
    setBusy(true);
    try {
      const result = await api.scan(jobId, {
        code: value,
        step: step.id,
        quantity,
      });
      queryClient.setQueryData(["job-summary", jobId], result.summary);
      const back = result.stage === "back" ? { item: result.item, serial: result.serial } : undefined;
      setFeed((prev) =>
        [
          {
            id: ++feedId.current,
            ok: true,
            text: result.message,
            at: new Date(),
            back,
          },
          ...prev,
        ].slice(0, 50),
      );
      beep(true);
      setQuantity(1);
    } catch (err) {
      setFeed((prev) =>
        [
          {
            id: ++feedId.current,
            ok: false,
            text: errorText(err),
            at: new Date(),
          },
          ...prev,
        ].slice(0, 50),
      );
      beep(false);
    } finally {
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
    }
  }

  if (error) return <p className="text-red-600 text-sm">Couldn't load this project: {errorText(error)}</p>;
  if (!summary || stepsLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  const { job, packing } = summary;
  if (steps.length === 0) {
    return <p className="text-gray-500 text-sm">Your role doesn't include tracking kit going out or coming back.</p>;
  }

  // The project's physical kit by heading, and how far the chosen step's got.
  const tracked = summary.lines.filter((l) => l.tracking);
  const headings = [...new Set(tracked.map((l) => l.group || "No heading"))];
  const shown = heading ? tracked.filter((l) => (l.group || "No heading") === heading) : tracked;
  const groups = headings
    .filter((h) => !heading || h === heading)
    .map((h) => ({
      name: h,
      lines: shown.filter((l) => (l.group || "No heading") === h),
    }));
  const stepIndex = step ? allSteps.findIndex((s) => s.id === step.id) : -1;
  const reached = (l: JobLineView) => allSteps.reduce((sum, s, i) => (i >= stepIndex ? sum + (l.tracking?.at[s.id] ?? 0) : sum), 0);
  // Units out on each item, for its first line.
  const firstLine = new Map<string, string>();
  for (const l of tracked) if (l.item && !firstLine.has(l.item.id)) firstLine.set(l.item.id, l.id);
  const stepName = (id: string) => allSteps.find((s) => s.id === id)?.name ?? "";

  return (
    <div className={`${layout === "board" ? "max-w-6xl" : "max-w-3xl"} w-full mx-auto flex flex-col gap-4`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Breadcrumbs crumbs={[{ label: "Projects", to: "/projects" }, { label: `#${job.number} ${job.name}`, to: `/projects/${job.id}` }, { label: "Scan" }]} />
        <TrackingStatus progress={linesProgress(allSteps, tracked)} />
      </div>

      <TrackingSuggestion summary={summary} />

      {/* Where the next scans take the kit. */}
      <div className="flex items-stretch gap-2" role="radiogroup" aria-label="Tracking step">
        {steps.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={s.id === stepId}
            onClick={() => {
              setStepId(s.id);
              inputRef.current?.focus();
            }}
            className={`flex-1 py-3 px-2 rounded-md text-base font-semibold border transition-colors truncate ${
              s.id === stepId
                ? `${STATUS_COLOURS[s.colour || "gray"].dot} border-transparent text-white`
                : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
        className="card p-3 flex items-center gap-2 flex-wrap"
      >
        <input
          ref={inputRef}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={step ? `Scan to ${step.name}, or type a barcode and Enter` : "Scan or type a barcode, then Enter"}
          className="input py-2.5 text-base flex-1 min-w-48 font-mono"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-500" title="For bulk items (cables, consumables): how many this scan counts as">
          ×
          <NumberInput value={quantity} min={1} onChange={(n) => setQuantity(Math.max(1, Math.round(n)))} className="input w-16 py-2" />
        </label>
        <button type="submit" disabled={busy || !code.trim() || !step} className="btn-primary py-2.5">
          {busy ? "…" : "Enter"}
        </button>
        <button type="button" onClick={() => setCamera((c) => !c)} className="btn-secondary py-2.5">
          {camera ? "Stop camera" : "Camera"}
        </button>
      </form>

      {camera && <CameraScanner onCode={submit} />}

      {reporting?.back && (
        <NewRepairModal
          itemId={reporting.back.item}
          serials={reporting.back.serial ? [reporting.back.serial] : []}
          job={{ id: job.id, number: job.number, name: job.name }}
          onClose={() => {
            setReporting(null);
            inputRef.current?.focus();
          }}
          onCreated={async (repair) => {
            const entry = reporting;
            setReporting(null);
            setFeed((prev) => prev.map((f) => (f.id === entry.id ? { ...f, repair: { id: repair.id, number: repair.number } } : f)));
            showToast("success", `Opened repair R${repair.number}`);
            await invalidateMaintenance(queryClient);
            inputRef.current?.focus();
          }}
        />
      )}

      {feed.length > 0 && (
        <div className="card divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {feed.map((f) => (
            <div key={f.id} className={`px-3 py-2 text-sm flex items-start justify-between gap-3 ${f.ok ? "text-gray-800" : "text-red-700 bg-red-50/60"}`}>
              <span>
                {f.ok ? "✓ " : "✗ "}
                {f.text}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {f.repair ? (
                  <Link to={`/maintenance/repairs/${f.repair.id}`} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
                    Repair R{f.repair.number}
                  </Link>
                ) : (
                  f.back &&
                  can("units.flag") &&
                  repairsOn && (
                    <button onClick={() => setReporting(f)} className="text-xs font-medium text-gray-500 hover:text-fault-ink">
                      Report fault
                    </button>
                  )
                )}
                <span className="text-xs text-gray-400">{f.at.toLocaleTimeString()}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-500">On this project</h2>
          <span className="flex items-center gap-2">
            {headings.length > 1 && (
              <select value={heading} onChange={(e) => setHeading(e.target.value)} className="input py-1 w-auto text-xs" aria-label="Heading">
                <option value="">All headings</option>
                {headings.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            )}
            <LayoutSwitch layout={layout} onChange={setLayout} />
          </span>
        </div>
        {layout === "board" && tracked.length > 0 && (
          <div className="px-3 pb-3 pt-1 bg-gray-50/60 border-t border-gray-200">
            <TrackingBoard
              steps={allSteps}
              items={shown}
              itemKey={(l) => l.id}
              at={(l) => l.tracking!.at}
              total={(l) => Math.round(l.quantity)}
              empty="Nothing here"
              card={(l, progress) => {
                const units = l.item && firstLine.get(l.item.id) === l.id ? (packing.items.find((p) => p.itemId === l.item!.id)?.serialsOut ?? []) : [];
                return (
                  <div className="card px-3 py-2.5 flex flex-col gap-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900 leading-snug">{l.name}</span>
                      <span className="text-xs tabular-nums text-gray-500 shrink-0">× {Math.round(l.quantity)}</span>
                    </span>
                    {headings.length > 1 && !heading && <span className="text-[11px] uppercase tracking-wide text-gray-400">{l.group || "No heading"}</span>}
                    {units.length > 0 && (
                      <span className="text-xs text-gray-400">{units.map((u) => `${u.label || u.barcode} (${stepName(u.step)})`).join(", ")}</span>
                    )}
                    <NextStep progress={progress} />
                  </div>
                );
              }}
            />
          </div>
        )}
        {layout === "list" && (
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-y border-gray-200 text-left text-gray-500">
                <th className="px-4 py-1.5 font-medium">Item</th>
                <th className="px-2 py-1.5 font-medium text-right">{step ? step.name : "Done"}</th>
                <th className="px-4 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.name} className="divide-y divide-gray-100">
                {headings.length > 1 && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={2} className="px-4 py-1.5 font-semibold text-gray-800">
                      {g.name}
                    </td>
                    <td className="px-4 py-1.5">
                      <TrackingStatus progress={linesProgress(allSteps, g.lines)} compact />
                    </td>
                  </tr>
                )}
                {g.lines.map((l) => {
                  const qty = Math.round(l.quantity);
                  const done = qty > 0 && reached(l) >= qty;
                  const units = l.item && firstLine.get(l.item.id) === l.id ? (packing.items.find((p) => p.itemId === l.item!.id)?.serialsOut ?? []) : [];
                  return (
                    <tr key={l.id} className={done ? "text-gray-400" : ""}>
                      <td className="px-4 py-1.5">
                        {done && <span className="text-emerald-600 mr-1">✓</span>}
                        {l.name}
                        {units.length > 0 && (
                          <span className="block text-xs text-gray-400">{units.map((u) => `${u.label || u.barcode} (${stepName(u.step)})`).join(", ")}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {reached(l)}/{qty}
                      </td>
                      <td className="px-4 py-1.5">
                        <TrackingStatus progress={progressOf(allSteps, l.tracking!.at, qty)} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
        {tracked.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No physical kit on this project.</p>}
      </section>
    </div>
  );
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new () => BarcodeDetectorLike;

// Reads codes from the camera. Uses the browser's own BarcodeDetector where
// there is one (Chrome on Android) and otherwise loads the ZXing decoder
// (iPhone/iPad Safari, Firefox) — only then, so nobody else downloads it.
function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    let stop = () => {};
    // The same code stays in view for a while; only act on it once.
    let last = { code: "", at: 0 };
    const seen = (code: string) => {
      if (code === last.code && Date.now() - last.at < 2500) return;
      last = { code, at: Date.now() };
      onCodeRef.current(code);
    };

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem("The camera only works when R2 is opened over https://. Use a Bluetooth scanner, or type the code.");
      return;
    }
    const failed = (err: unknown) => {
      if (!stopped) setProblem(`Couldn't open the camera: ${err instanceof Error ? err.message : String(err)}`);
    };

    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Detector) {
      const detector = new Detector();
      let timer: number | undefined;
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          stop = () => {
            if (timer) window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
          if (stopped) return stop();
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          video.play().catch(() => {});
          const tick = async () => {
            if (stopped) return;
            try {
              if (video.readyState >= 2) {
                const code = (await detector.detect(video))[0]?.rawValue;
                if (code) seen(code);
              }
            } catch {
              // a frame that can't be read — try the next one
            }
            timer = window.setTimeout(tick, 250);
          };
          tick();
        })
        .catch(failed);
    } else {
      import("@zxing/browser")
        .then(async ({ BrowserMultiFormatReader }) => {
          if (stopped || !videoRef.current) return;
          const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
            { video: { facingMode: "environment" } },
            videoRef.current,
            (result) => {
              if (result) seen(result.getText());
            },
          );
          stop = () => controls.stop();
          if (stopped) stop();
        })
        .catch(failed);
    }

    return () => {
      stopped = true;
      stop();
    };
  }, []);

  if (problem) return <p className="card px-4 py-3 text-sm text-amber-700 bg-amber-50/60">{problem}</p>;
  return (
    <div className="card overflow-hidden bg-black">
      <video ref={videoRef} muted playsInline className="w-full max-h-72 object-cover" />
    </div>
  );
}
