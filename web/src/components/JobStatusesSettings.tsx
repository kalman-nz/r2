import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type JobStatus, type JobStatusInput, type StatusColour } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { JOB_STAGES, STATUS_COLOURS } from "../lib/statuses";
import { useJobStatuses } from "../lib/workflow";
import { useToast } from "./ToastProvider";

type Row = JobStatusInput & { key: string; moveTo?: string };

let nextKey = 0;
const keyed = (s: JobStatusInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });
const stageOf = (stage: JobStatus) => JOB_STAGES.find((s) => s.value === stage);

// Settings > Project statuses: the steps a project goes through, in this
// business's words and order (Prepping, Prepped, Loaded, On site…). Each
// sits on one of the fixed stages, which decides what happens to the kit:
// held or not, out, done (pb_hooks/lib/jobStatuses.js). Removing a status
// that has projects says where they go; changing a status's stage takes
// its projects with it.
export default function JobStatusesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { statuses, isLoading } = useJobStatuses();
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () => statuses.map((s) => keyed({ id: s.id, name: s.name, stage: s.stage, colour: s.colour || "gray", isDefault: s.isDefault })),
    [statuses],
  );
  useEffect(() => {
    setRows(saved);
    setRemoved([]);
  }, [saved]);

  // How many projects each status has.
  const { data: counts = {} } = useQuery({
    queryKey: ["jobs", "by-status"],
    queryFn: async () => {
      const c: Record<string, number> = {};
      for (const j of await pb.collection("jobs").getFullList<{ jobStatus: string }>({ filter: orgFilter(), fields: "jobStatus" })) {
        c[j.jobStatus] = (c[j.jobStatus] ?? 0) + 1;
      }
      return c;
    },
  });
  const countOf = (r: Row) => (r.id ? (counts[r.id] ?? 0) : 0);

  const strip = (list: Row[]) => JSON.stringify(list.map(({ key: _k, moveTo: _m, ...rest }) => rest));
  const dirty = removed.length > 0 || strip(rows) !== strip(saved);
  const set = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((prev) => {
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row);
      return next;
    });
  function remove(r: Row) {
    setRows((prev) => prev.filter((x) => x.key !== r.key));
    if (countOf(r) > 0) setRemoved((prev) => [...prev, { ...r, moveTo: "" }]);
  }
  function undoRemove(r: Row) {
    setRemoved((prev) => prev.filter((x) => x.key !== r.key));
    setRows((prev) => [...prev, r]);
  }
  const keptWithIds = rows.filter((r) => r.id);
  const unmoved = removed.filter((r) => !r.moveTo);

  async function save() {
    setSaving(true);
    try {
      const moves = Object.fromEntries(removed.map((r) => [r.id!, r.moveTo!]));
      await api.saveJobStatuses(
        rows.map(({ key: _k, moveTo: _m, ...rest }) => ({ ...rest, name: rest.name.trim() })),
        moves,
      );
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["job-statuses"] }), queryClient.invalidateQueries({ queryKey: ["jobs"] })]);
      showToast("success", "Project statuses saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Project statuses</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          The steps a project goes through, in your words and order: add Prepping, Prepped or Loaded if that's how you work. What each one means for
          the kit is set by its stage. New projects start in the default.
        </p>
      </div>

      <div className="card p-4 flex flex-col gap-2 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.map((r, i) => {
          const count = countOf(r);
          const original = saved.find((s) => s.id === r.id);
          const restaged = !!original && original.stage !== r.stage && count > 0;
          return (
            <div key={r.key} className="flex flex-col gap-1 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 flex-wrap">
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
                <select value={r.colour || "gray"} onChange={(e) => set(r.key, { colour: e.target.value as StatusColour })} className="input py-1.5 w-auto" aria-label={`Colour of ${r.name}`}>
                  {(Object.keys(STATUS_COLOURS) as StatusColour[]).map((c) => (
                    <option key={c} value={c}>
                      {STATUS_COLOURS[c].label}
                    </option>
                  ))}
                </select>
                <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Name, e.g. Prepping" className="input py-1.5 flex-1 min-w-36" maxLength={60} />
                <select
                  value={r.stage}
                  onChange={(e) => set(r.key, { stage: e.target.value as JobStatus, isDefault: r.isDefault && !!stageOf(e.target.value as JobStatus)?.starts })}
                  title={stageOf(r.stage)?.hint}
                  className="input py-1.5 w-auto"
                  aria-label={`Stage of ${r.name}`}
                >
                  {JOB_STAGES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <label className={`flex items-center gap-1.5 text-xs ${stageOf(r.stage)?.starts ? "text-gray-600" : "invisible"}`}>
                  <input type="radio" name="default-job-status" checked={r.isDefault} onChange={() => setRows((prev) => prev.map((x) => ({ ...x, isDefault: x.key === r.key })))} />
                  Default
                </label>
                <span className="text-xs text-gray-400 w-20 text-right">{count > 0 ? `${count} project${count === 1 ? "" : "s"}` : ""}</span>
                <button onClick={() => remove(r)} title={`Remove ${r.name}`} className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100" aria-label={`Remove ${r.name}`}>
                  ×
                </button>
              </div>
              {restaged && (
                <p className="text-xs text-amber-700 pl-7">
                  Its {count} project{count === 1 ? "" : "s"} move to {stageOf(r.stage)?.label} too: {stageOf(r.stage)?.hint.toLowerCase()}.
                </p>
              )}
            </div>
          );
        })}

        {removed.map((r) => (
          <div key={r.key} className="flex items-center gap-2 flex-wrap rounded-md bg-amber-50/70 px-3 py-2 text-xs text-gray-700">
            <span>
              Removing <span className="font-medium">{r.name}</span>: its {countOf(r)} project{countOf(r) === 1 ? "" : "s"} move to
            </span>
            <select value={r.moveTo ?? ""} onChange={(e) => setRemoved((prev) => prev.map((x) => (x.key === r.key ? { ...x, moveTo: e.target.value } : x)))} className="input py-1 w-auto text-xs">
              <option value="">Pick a status…</option>
              {keptWithIds.map((k) => (
                <option key={k.key} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <button onClick={() => undoRemove(r)} className="text-gray-500 hover:text-gray-900 ml-auto">
              Undo
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <button onClick={() => setRows((prev) => [...prev, keyed({ name: "", stage: "confirmed", colour: "gray", isDefault: false })])} disabled={rows.length >= 30} className="btn-secondary">
            Add status
          </button>
          <button onClick={save} disabled={!dirty || saving || rows.some((r) => !r.name.trim()) || unmoved.length > 0} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
          {dirty && (
            <button
              onClick={() => {
                setRows(saved);
                setRemoved([]);
              }}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              Discard changes
            </button>
          )}
          {unmoved.length > 0 && <span className="text-xs text-amber-700">Say where the removed statuses' projects go.</span>}
        </div>
      </div>

      <div className="card p-4 flex flex-col gap-1.5 text-xs text-gray-600">
        <p className="font-medium text-gray-900">Stages</p>
        {JOB_STAGES.map((s) => (
          <p key={s.value}>
            <span className="font-medium text-gray-900">{s.label}:</span> {s.hint}.
          </p>
        ))}
      </div>
    </div>
  );
}
