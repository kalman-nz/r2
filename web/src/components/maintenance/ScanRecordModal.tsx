import { useRef, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { api } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { assetLabel, dueLabel, kindOf, today, usePlans, type JobWithExpand } from "../../lib/maintenance";
import Modal from "../Modal";

// A line in the feed: recorded passes and fails, and scans that found
// nothing or went wrong.
interface Entry {
  id: number;
  tone: "pass" | "fail" | "error";
  text: string;
}

const TONES = { pass: "text-gray-800", fail: "text-amber-800 bg-amber-50/60", error: "text-red-700 bg-red-50/60" };
const MARKS = { pass: "✓ ", fail: "⚠ ", error: "✗ " };

// An inspection or test & tag day: scan each unit (or a bulk item's code),
// see what's due on it, pass or fail it. A fail can take it out of service
// on a repair straight away. Works with a scanner (it types the code and
// presses Enter) or typing.
export default function ScanRecordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { data: plans = [] } = usePlans();
  const [plan, setPlan] = useState("");
  const [code, setCode] = useState("");
  const [jobs, setJobs] = useState<JobWithExpand[] | null>(null);
  const [scanned, setScanned] = useState("");
  const [failing, setFailing] = useState<string | null>(null);
  const [fault, setFault] = useState("");
  const [repair, setRepair] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const feedId = useRef(0);

  const log = (tone: Entry["tone"], text: string) => setFeed((prev) => [{ id: ++feedId.current, tone, text }, ...prev].slice(0, 30));
  const reset = () => {
    setJobs(null);
    setFailing(null);
    setFault("");
    setCode("");
    setTimeout(() => input.current?.focus(), 0);
  };

  async function look(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const found = await api.lookup(value);
      const which = found.kind === "serial" ? pb.filter("serial = {:id}", { id: found.id }) : pb.filter("item = {:id} && serial = ''", { id: found.id });
      const due = await pb.collection("maintenance_jobs").getFullList<JobWithExpand>({
        filter: orgFilter(`status = 'scheduled' && ${which}${plan ? ` && ${pb.filter("plan = {:plan}", { plan })}` : ""}`),
        sort: "dueOn",
        expand: "item,serial,plan",
      });
      setScanned(value);
      if (due.length === 0) {
        log("error", `Nothing ${plan ? "on that plan " : ""}is scheduled for ${value}`);
        reset();
      } else {
        setJobs(due);
        setFailing(null);
      }
    } catch (err) {
      log("error", `${value}: ${errorText(err)}`);
      reset();
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  async function record(job: JobWithExpand, pass: boolean) {
    setBusy(true);
    try {
      const k = kindOf(job.kind);
      const result = await api.completeJob(job.id, pass ? { result: "pass" } : { result: "fail", ...(repair && job.item ? { repair: { fault: fault.trim() } } : {}), notes: fault.trim() });
      log(pass ? "pass" : "fail", `${assetLabel(job)}: ${job.name} ${(pass ? k.pass : k.fail).toLowerCase()}${result.repair ? `, on repair R${result.repair.number}` : ""}`);
      onChanged();
      const rest = (jobs ?? []).filter((j) => j.id !== job.id);
      if (rest.length > 0) {
        setJobs(rest);
        setFailing(null);
        setFault("");
      } else reset();
    } catch (err) {
      log("error", `${assetLabel(job)}: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record by scanning" onClose={busy ? () => {} : onClose} wide>
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-gray-500">Recording</span>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input py-1 w-auto">
          <option value="">whatever's scheduled</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          look(code);
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={input}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan or type a barcode, then Enter"
          className="input py-2.5 text-base flex-1 font-mono"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary py-2.5">
          Look up
        </button>
      </form>

      {jobs && (
        <div className="card p-3 flex flex-col gap-2">
          <p className="text-sm text-gray-500">
            Scheduled for <span className="font-mono text-gray-900">{scanned}</span>
          </p>
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-2 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{assetLabel(j)}</span>
                  <span className="block text-xs text-gray-500">
                    {j.name} · <span className={j.dueOn < today() ? "text-fault-ink" : ""}>{dueLabel(j.dueOn)}</span>
                  </span>
                </span>
                {failing !== j.id && (
                  <span className="flex items-center gap-1.5">
                    <button onClick={() => setFailing(j.id)} disabled={busy} className="btn-secondary hover:text-fault-ink">
                      {kindOf(j.kind).fail}…
                    </button>
                    <button onClick={() => record(j, true)} disabled={busy} className="btn-primary">
                      {kindOf(j.kind).pass === "Done" ? "Done" : "Pass"}
                    </button>
                  </span>
                )}
              </div>
              {j.expand?.plan?.instructions && <p className="text-xs text-gray-600 whitespace-pre-line bg-gray-50 rounded px-2 py-1.5">{j.expand.plan.instructions}</p>}
              {failing === j.id && (
                <div className="flex flex-col gap-2">
                  <input autoFocus value={fault} onChange={(e) => setFault(e.target.value)} placeholder="What's wrong?" className="input py-1.5" />
                  {j.item && (
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={repair} onChange={(e) => setRepair(e.target.checked)} />
                      Take it out of service on a repair
                    </label>
                  )}
                  <span className="flex items-center gap-1.5">
                    <button onClick={() => record(j, false)} disabled={busy || (repair && !!j.item && !fault.trim())} className="btn-primary">
                      Record {kindOf(j.kind).fail.toLowerCase()}
                    </button>
                    <button onClick={() => setFailing(null)} disabled={busy} className="btn-secondary">
                      Back
                    </button>
                  </span>
                </div>
              )}
            </div>
          ))}
          <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-900 w-fit">
            Skip, scan the next one
          </button>
        </div>
      )}

      {feed.length > 0 && (
        <div className="card divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {feed.map((f) => (
            <div key={f.id} className={`px-3 py-2 text-sm ${TONES[f.tone]}`}>
              {MARKS[f.tone]}
              {f.text}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
