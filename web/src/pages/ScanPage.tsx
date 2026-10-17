import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Contact, type Job } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { errorText } from "../lib/errors";
import { JobStatusBadge } from "../components/StatusBadge";
import NumberInput from "../components/NumberInput";
import { orgFilter } from "../lib/currentOrg";
import { useCan } from "../lib/roles";

// Scanning kit out to a job and back in. Works with a Bluetooth/USB scanner
// (it types the code and presses Enter into the focused box) or the phone's
// camera (see CameraScanner). Every rule — double scans, wrong job,
// over-scans, broken units — is checked server-side in lib/scan.js.
export default function ScanPage() {
  const { id } = useParams();
  return id ? <ScanJob jobId={id} /> : <ChooseJob />;
}

type JobWithClient = Job & { expand?: { client?: Contact } };

function ChooseJob() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", "scannable"],
    queryFn: () =>
      pb.collection("jobs").getFullList<JobWithClient>({
        filter: orgFilter("status = 'provisional' || status = 'confirmed' || status = 'out'"),
        sort: "prepAt",
        expand: "client",
      }),
  });
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    if (!term) return jobs;
    return jobs.filter((j) =>
      [String(j.number), j.name, j.expand?.client?.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [jobs, search]);

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-3">
      <h1 className="text-lg font-semibold text-gray-900">Scan kit</h1>
      <p className="text-sm text-gray-500">Pick the job you're packing or unpacking.</p>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job number or name" className="input py-2" />
      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      <div className="card divide-y divide-gray-100 overflow-hidden">
        {filtered.map((job) => (
          <button
            key={job.id}
            onClick={() => navigate(`/jobs/${job.id}/scan`)}
            className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3"
          >
            <span className="flex flex-col min-w-0">
              <span className="font-medium text-gray-900 truncate">
                #{job.number} {job.name}
              </span>
              <span className="text-xs text-gray-500 truncate">
                {[job.expand?.client?.name, `prep ${formatDateTime(job.prepAt)}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <JobStatusBadge status={job.status} />
          </button>
        ))}
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No provisional, confirmed or out jobs.</p>
        )}
      </div>
    </div>
  );
}

interface FeedEntry {
  id: number;
  ok: boolean;
  text: string;
  at: Date;
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
  const { data: summary, error } = useQuery({ queryKey: ["job-summary", jobId], queryFn: () => api.getJobSummary(jobId) });
  const can = useCan();
  const directions = useMemo(() => (["out", "in"] as const).filter((d) => can(d === "out" ? "scan.out" : "scan.in")), [can]);
  const [direction, setDirection] = useState<"out" | "in">(directions[0] ?? "out");
  const [quantity, setQuantity] = useState(1);
  const [code, setCode] = useState("");
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedId = useRef(0);

  // Opening a job that's already out defaults to scanning in. Decided once,
  // on load: the first scan out flips the job to "out", and switching
  // direction under someone mid-pack would scan the next unit back in.
  const status = summary?.job.status;
  const defaulted = useRef(false);
  useEffect(() => {
    if (!status || defaulted.current) return;
    defaulted.current = true;
    if (status === "out" && directions.includes("in")) setDirection("in");
  }, [status, directions]);

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await api.scan(jobId, { code: value, direction, quantity });
      queryClient.setQueryData(["job-summary", jobId], result.summary);
      setFeed((prev) => [{ id: ++feedId.current, ok: true, text: result.message, at: new Date() }, ...prev].slice(0, 50));
      beep(true);
      setQuantity(1);
    } catch (err) {
      setFeed((prev) => [{ id: ++feedId.current, ok: false, text: errorText(err), at: new Date() }, ...prev].slice(0, 50));
      beep(false);
    } finally {
      setBusy(false);
      setCode("");
      inputRef.current?.focus();
    }
  }

  if (error) return <p className="text-red-600 text-sm">Couldn't load this job: {errorText(error)}</p>;
  if (!summary) return <p className="text-gray-500 text-sm">Loading…</p>;
  const { job, packing } = summary;
  if (directions.length === 0) {
    return <p className="text-gray-500 text-sm">Your role doesn't include scanning kit out or in.</p>;
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Link to={`/jobs/${job.id}`} className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← #{job.number} {job.name}
      </Link>

      <div className="flex items-center gap-2">
        {directions.map((d) => (
          <button
            key={d}
            onClick={() => {
              setDirection(d);
              inputRef.current?.focus();
            }}
            className={`flex-1 py-3 rounded-md text-base font-semibold border transition-colors ${
              direction === d
                ? d === "out"
                  ? "bg-[#167cfb] border-[#167cfb] text-white"
                  : "bg-emerald-600 border-emerald-600 text-white"
                : "bg-white border-gray-300 text-gray-600"
            }`}
          >
            {d === "out" ? "Scan OUT" : "Scan IN"}
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
          placeholder="Scan or type a barcode, then Enter"
          className="input py-2.5 text-base flex-1 min-w-48 font-mono"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-500" title="For bulk items (cables, consumables): how many this scan counts as">
          ×
          <NumberInput value={quantity} min={1} onChange={(n) => setQuantity(Math.max(1, Math.round(n)))} className="input w-16 py-2" />
        </label>
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary py-2.5">
          {busy ? "…" : "Enter"}
        </button>
        <button type="button" onClick={() => setCamera((c) => !c)} className="btn-secondary py-2.5">
          {camera ? "Stop camera" : "Camera"}
        </button>
      </form>

      {camera && <CameraScanner onCode={submit} />}

      {feed.length > 0 && (
        <div className="card divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {feed.map((f) => (
            <div key={f.id} className={`px-3 py-2 text-sm flex items-start justify-between gap-3 ${f.ok ? "text-gray-800" : "text-red-700 bg-red-50/60"}`}>
              <span>
                {f.ok ? "✓ " : "✗ "}
                {f.text}
              </span>
              <span className="text-xs text-gray-400 shrink-0">{f.at.toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">On this job</h2>
          <span className="text-xs text-gray-500">{packing.packed ? "Everything's out" : packing.allBack ? "" : "Some kit still out"}</span>
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-y border-gray-200 text-left text-gray-500">
              <th className="px-4 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium text-right">Need</th>
              <th className="px-2 py-1.5 font-medium text-right">Out</th>
              <th className="px-4 py-1.5 font-medium text-right">Back</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {packing.items.map((p) => {
              const done = direction === "out" ? p.scannedOut >= p.needed : p.out <= 0 && p.scannedOut > 0;
              return (
                <tr key={p.itemId} className={done ? "text-gray-400" : ""}>
                  <td className="px-4 py-1.5">
                    {done && <span className="text-emerald-600 mr-1">✓</span>}
                    {p.name}
                    {p.serialsOut.length > 0 && (
                      <span className="block text-xs text-gray-400">Out: {p.serialsOut.map((s) => s.label || s.barcode).join(", ")}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.needed}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Math.max(0, p.out)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{p.returned}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {packing.items.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No physical kit on this job.</p>}
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
