import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type TrackingStage, type TrackingStepInput } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { TRACKING_STAGES, useTrackingSteps } from "../lib/tracking";
import { useJobStatuses } from "../lib/workflow";
import { useToast } from "./ToastProvider";
import ColourPicker from "./ColourPicker";
import Segmented from "./Segmented";
import { DragHandle, moveItem, useDragReorder } from "./DragReorder";

type Row = TrackingStepInput & { key: string };

let nextKey = 0;
const keyed = (s: TrackingStepInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// Steps in stage order (getting ready, gone, back), keeping their order within each.
const grouped = (list: Row[]) => TRACKING_STAGES.flatMap((s) => list.filter((r) => r.stage === s.value));

// Settings > Equipment tracking: the steps kit goes through on its way to a
// project and back, in this business's own words and order (Prepped →
// Loaded → Returned; or straight to Loaded for a workshop that loads from
// the shelves), laid out like Project statuses: one list, each step with
// its options set by hand: where the kit is (pb_hooks/lib/tracking.js) and
// the project status it goes with, offered once everything's reached the
// step and given to a project dragged to it on the board. Steps stay in
// kit order: getting ready, then gone, then back.
export default function TrackingStepsSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { steps, isLoading } = useTrackingSteps();
  const { statuses } = useJobStatuses();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () => grouped(steps.map((s) => keyed({ id: s.id, name: s.name, stage: s.stage, colour: s.colour || "gray", jobStatus: s.jobStatus }))),
    [steps],
  );
  useEffect(() => setRows(saved), [saved]);

  // Steps kit has been tracked to, which keep their stage.
  const { data: inUse = {} } = useQuery({
    queryKey: ["scans", "by-step"],
    queryFn: async () => {
      const used: Record<string, boolean> = {};
      for (const s of await pb.collection("scans").getFullList<{ step: string; fromStep: string }>({ filter: orgFilter(), fields: "step,fromStep" })) {
        if (s.step) used[s.step] = true;
        if (s.fromStep) used[s.fromStep] = true;
      }
      return used;
    },
  });

  const strip = (r: Row[]) => JSON.stringify(grouped(r).map(({ key: _key, ...rest }) => rest));
  const dirty = strip(rows) !== strip(saved);
  const set = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Steps stay grouped by stage, so one can only land among its own stage's.
  const drag = useDragReorder({
    count: rows.length,
    onMove: (from, to) => setRows((prev) => moveItem(prev, from, to)),
    gap: 24,
    allow: (from, to) => {
      const stage = rows[from].stage;
      return rows[to - 1]?.stage === stage || rows[to]?.stage === stage;
    },
  });
  const missing = !rows.some((r) => r.stage === "out") ? "Keep a step for kit going out" : !rows.some((r) => r.stage === "back") ? "Keep a step for kit coming back" : "";

  async function save() {
    setSaving(true);
    try {
      await api.saveTrackingSteps(grouped(rows).map(({ key: _key, ...rest }) => ({ ...rest, name: rest.name.trim() })));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["tracking-steps"] }), queryClient.invalidateQueries({ queryKey: ["job-summary"] })]);
      showToast("success", "Tracking steps saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // A step's kit stage: it moves to that part of the list.
  const setKit = (row: Row, stage: TrackingStage) => setRows((prev) => grouped(prev.map((r) => (r.key === row.key ? { ...r, stage } : r))));
  const add = () => setRows((prev) => grouped([...prev, keyed({ name: "", stage: "out", colour: "gray", jobStatus: "" })]));

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-gray-900">Equipment tracking</h2>

      <div className="card p-4 flex flex-col gap-3 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.map((r, i) => {
          const used = !!(r.id && inUse[r.id]);
          return (
            <div key={r.key} {...drag.item(i)} className={`flex flex-col gap-2 border-b border-gray-100 pb-3 last:border-0 last:pb-0 bg-white ${drag.cls(i)}`} style={drag.style}>
              <div className="flex items-center gap-2">
                <DragHandle {...drag.handle(i)} />
                <ColourPicker value={r.colour || "gray"} onChange={(colour) => set(r.key, { colour })} label={r.name} />
                <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Name" className="input py-1.5 flex-1 min-w-0" maxLength={60} />
                <button
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  title={used ? `Kit at ${r.name} moves to the next step in the same stage, or the first going-out step` : `Remove ${r.name}`}
                  className="w-6 h-6 shrink-0 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100"
                  aria-label={`Remove ${r.name}`}
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-x-4 gap-y-2 flex-wrap pl-[4.95rem]">
                <span className="flex items-center gap-1.5" title={used ? "Kit has been tracked to this step, so where it is can't change" : TRACKING_STAGES.find((s) => s.value === r.stage)?.hint}>
                  <span className="text-xs text-gray-500">Kit</span>
                  <Segmented
                    compact
                    label={`Where the kit is at ${r.name}`}
                    value={r.stage}
                    options={TRACKING_STAGES.map((s) => ({ value: s.value, label: s.label }))}
                    disabled={used}
                    onChange={(stage) => setKit(r, stage)}
                  />
                </span>
                <label className="flex items-center gap-1.5" title="Offered once everything's here, and given to a project dragged here on the board">
                  <span className="text-xs text-gray-500">Project status</span>
                  <select value={r.jobStatus} onChange={(e) => set(r.key, { jobStatus: e.target.value })} className="input py-1 w-auto text-xs" aria-label={`Project status for ${r.name}`}>
                    <option value="">None</option>
                    {statuses
                      .filter((s) => s.stage !== "cancelled")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
        <button onClick={add} disabled={rows.length >= 20} className="self-start text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">
          + Add step
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!dirty || saving || rows.some((r) => !r.name.trim()) || !!missing} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button onClick={() => setRows(saved)} disabled={saving} className="text-xs text-gray-500 hover:text-gray-900">
            Discard changes
          </button>
        )}
        {missing && <span className="text-xs text-amber-700">{missing}</span>}
      </div>
    </div>
  );
}
