import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type StatusColour, type TrackingStage, type TrackingStepInput } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { STATUS_COLOURS } from "../lib/statuses";
import { TRACKING_STAGES, useTrackingSteps } from "../lib/tracking";
import { useJobStatuses } from "../lib/workflow";
import { useToast } from "./ToastProvider";

type Row = TrackingStepInput & { key: string };

let nextKey = 0;
const keyed = (s: TrackingStepInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// Settings > Equipment tracking: the steps kit goes through on its way to a
// project and back, in this business's own words and order (Prepped →
// Loaded → Returned; or straight to Loaded for a workshop that loads from
// the shelves). Each step's stage says where the kit is
// (pb_hooks/lib/tracking.js), and a step can move the project on once
// everything's reached it. A step kit's been tracked to keeps its stage.
export default function TrackingStepsSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { steps, isLoading } = useTrackingSteps();
  const { statuses } = useJobStatuses();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () => steps.map((s) => keyed({ id: s.id, name: s.name, stage: s.stage, colour: s.colour || "gray", jobStatus: s.jobStatus })),
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

  const strip = (r: Row[]) => JSON.stringify(r.map(({ key: _key, ...rest }) => rest));
  const dirty = strip(rows) !== strip(saved);
  const set = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((prev) => {
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row);
      return next;
    });
  const missing = !rows.some((r) => r.stage === "out") ? "Keep a step for kit going out" : !rows.some((r) => r.stage === "back") ? "Keep a step for kit coming back" : "";

  async function save() {
    setSaving(true);
    try {
      await api.saveTrackingSteps(rows.map(({ key: _key, ...rest }) => ({ ...rest, name: rest.name.trim() })));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["tracking-steps"] }), queryClient.invalidateQueries({ queryKey: ["job-summary"] })]);
      showToast("success", "Tracking steps saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Equipment tracking</h2>
      </div>

      <div className="card p-4 flex flex-col gap-2 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 pl-7">
            <span className="w-[5.5rem]">Colour</span>
            <span className="flex-1">Step</span>
            <span className="w-32">Where the kit is</span>
            <span className="w-44">When everything's here, offer</span>
            <span className="w-6" />
          </div>
        )}
        {rows.map((r, i) => {
          const used = !!(r.id && inUse[r.id]);
          return (
            <div key={r.key} className="flex items-center gap-2 flex-wrap border-b border-gray-100 pb-2 last:border-0 last:pb-0">
              <span className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs" aria-label={`Move ${r.name} up`}>
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs"
                  aria-label={`Move ${r.name} down`}
                >
                  ▼
                </button>
              </span>
              <select
                value={r.colour || "gray"}
                onChange={(e) => set(r.key, { colour: e.target.value as StatusColour })}
                className="input py-1.5 w-[5.5rem]"
                aria-label={`Colour of ${r.name}`}
              >
                {(Object.keys(STATUS_COLOURS) as StatusColour[]).map((c) => (
                  <option key={c} value={c}>
                    {STATUS_COLOURS[c].label}
                  </option>
                ))}
              </select>
              <input
                value={r.name}
                onChange={(e) => set(r.key, { name: e.target.value })}
                placeholder="Name, e.g. Loaded"
                className="input py-1.5 flex-1 min-w-36"
                maxLength={60}
              />
              <select
                value={r.stage}
                onChange={(e) => set(r.key, { stage: e.target.value as TrackingStage })}
                disabled={used}
                title={used ? "Kit has been tracked to this step, so where it is can't change" : TRACKING_STAGES.find((s) => s.value === r.stage)?.hint}
                className="input py-1.5 w-32"
                aria-label={`Where the kit is at ${r.name}`}
              >
                {TRACKING_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={r.jobStatus}
                onChange={(e) => set(r.key, { jobStatus: e.target.value })}
                className="input py-1.5 w-44"
                aria-label={`Project status to offer once everything's ${r.name}`}
              >
                <option value="">Nothing</option>
                {statuses
                  .filter((s) => s.stage !== "cancelled")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                title={used ? `Kit at ${r.name} moves to the next step where it's the same, or the first going-out step` : `Remove ${r.name}`}
                className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100"
                aria-label={`Remove ${r.name}`}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <button
            onClick={() => setRows((prev) => [...prev, keyed({ name: "", stage: "out", colour: "gray", jobStatus: "" })])}
            disabled={rows.length >= 20}
            className="btn-secondary"
          >
            Add step
          </button>
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

      <div className="card p-4 flex flex-col gap-1.5 text-xs text-gray-600">
        {TRACKING_STAGES.map((s) => (
          <p key={s.value}>
            <span className="font-medium text-gray-900">{s.label}:</span> {s.hint}.
          </p>
        ))}
        <p>
          Steps stay in that order: getting ready, then gone, then back. A project's status is always yours to set: once everything's reached a step (or gone past it), whoever's
          scanning is offered that step's status, if the project isn't already further along. Any project can go without tracking (switch it off on the project). Prepping, loading
          and returning can each be given to different roles (Settings → Users & access → Roles).
        </p>
      </div>
    </div>
  );
}
