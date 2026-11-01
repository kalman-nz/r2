import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type JobStatus, type JobStatusInput } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { useJobStatuses } from "../lib/workflow";
import { useToast } from "./ToastProvider";
import ColourPicker from "./ColourPicker";
import Segmented from "./Segmented";

type Row = JobStatusInput & { key: string; moveTo?: string };

let nextKey = 0;
const keyed = (s: JobStatusInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// What a status does, as options set per status. Underneath, where the
// project is and what happens to its equipment make up its stage (which
// availability, scanning and the rest run on, pb_hooks/lib/jobStatuses.js);
// crew planning, the calendar and invoicing are each its own.
type Phase = "open" | "finished" | "cancelled";
type Equipment = "released" | "pencilled" | "held" | "out";

const PHASES: { value: Phase; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "finished", label: "Finished" },
  { value: "cancelled", label: "Cancelled" },
];
const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: "released", label: "Released" },
  { value: "pencilled", label: "Pencilled" },
  { value: "held", label: "Held" },
  { value: "out", label: "Out" },
];

const phaseOf = (stage: JobStatus): Phase => (stage === "returned" ? "finished" : stage === "cancelled" ? "cancelled" : "open");
const equipmentOf = (stage: JobStatus): Equipment => (stage === "provisional" ? "pencilled" : stage === "confirmed" ? "held" : stage === "out" ? "out" : "released");
function stageFrom(phase: Phase, equipment: Equipment): JobStatus {
  if (phase === "finished") return "returned";
  if (phase === "cancelled") return "cancelled";
  return equipment === "pencilled" ? "provisional" : equipment === "held" ? "confirmed" : equipment === "out" ? "out" : "enquiry";
}
// New projects start open, before their kit's gone.
const canStart = (stage: JobStatus) => stage === "enquiry" || stage === "provisional" || stage === "confirmed";

// The options a new status starts with (the same as the server's optionsFor).
const optionsFor = (stage: JobStatus) => ({ rostering: stage !== "cancelled", calendar: stage !== "cancelled", invoicing: stage !== "enquiry" && stage !== "cancelled" });

// Hover text for each option.
const EQUIPMENT_TITLES: Record<Equipment, string> = {
  released: "Doesn't hold any equipment",
  pencilled: "Holds the equipment, but shortages say it'd be free if released",
  held: "Holds the equipment",
  out: "The equipment's gone with the project, and it's overdue if it isn't back on time",
};

// Settings > Project statuses: the steps a project goes through, in this
// business's words and order, each with what it does set by hand. Removing
// a status that has projects says where they go; changing what a status
// does takes its projects with it.
export default function JobStatusesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { statuses, isLoading } = useJobStatuses();
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () =>
      statuses.map((s) =>
        keyed({
          id: s.id,
          name: s.name,
          stage: s.stage,
          colour: s.colour || "gray",
          isDefault: s.isDefault,
          // Statuses saved before the options existed go by their stage.
          rostering: s.rostering ?? optionsFor(s.stage).rostering,
          calendar: s.calendar ?? optionsFor(s.stage).calendar,
          invoicing: s.invoicing ?? optionsFor(s.stage).invoicing,
        }),
      ),
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
  // A status's stage from its options; one that can't start projects stops being the default.
  const setStage = (r: Row, stage: JobStatus) => set(r.key, { stage, isDefault: r.isDefault && canStart(stage) });
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
  const add = () => setRows((prev) => [...prev, keyed({ name: "", stage: "confirmed", colour: "gray", isDefault: false, ...optionsFor("confirmed") })]);
  const keptWithIds = rows.filter((r) => r.id);
  const unmoved = removed.filter((r) => !r.moveTo);
  const noStart = rows.length > 0 && !rows.some((r) => canStart(r.stage));

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
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-gray-900">Project statuses</h2>

      <div className="card p-4 flex flex-col gap-3 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.map((r, i) => {
          const count = countOf(r);
          const original = saved.find((s) => s.id === r.id);
          const restaged = !!original && original.stage !== r.stage && count > 0;
          const phase = phaseOf(r.stage);
          return (
            <div key={r.key} className="flex flex-col gap-2 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
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
                <ColourPicker value={r.colour || "gray"} onChange={(colour) => set(r.key, { colour })} label={r.name} />
                <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Name" className="input py-1.5 flex-1 min-w-0" maxLength={60} />
                {canStart(r.stage) && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0" title="New projects start here">
                    <input type="radio" name="default-job-status" checked={r.isDefault} onChange={() => setRows((prev) => prev.map((x) => ({ ...x, isDefault: x.key === r.key })))} />
                    Default
                  </label>
                )}
                <span className="text-xs text-gray-400 w-20 text-right shrink-0">{count > 0 ? `${count} project${count === 1 ? "" : "s"}` : ""}</span>
                <button
                  onClick={() => remove(r)}
                  title={`Remove ${r.name}`}
                  className="w-6 h-6 shrink-0 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100"
                  aria-label={`Remove ${r.name}`}
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-x-4 gap-y-2 flex-wrap pl-[4.25rem]">
                <Option label="Project">
                  <Segmented compact label={`What ${r.name} means for the project`} value={phase} options={PHASES} onChange={(p) => setStage(r, stageFrom(p, equipmentOf(r.stage)))} />
                </Option>
                <Option label="Equipment" title={EQUIPMENT_TITLES[equipmentOf(r.stage)]}>
                  <Segmented
                    compact
                    label={`What ${r.name} does with the equipment`}
                    value={equipmentOf(r.stage)}
                    options={EQUIPMENT}
                    disabled={phase !== "open"}
                    onChange={(e) => setStage(r, stageFrom("open", e))}
                  />
                </Option>
                <Check checked={r.rostering} onChange={(rostering) => set(r.key, { rostering })} title="Its projects are on the Rostering page">
                  Crew planning
                </Check>
                <Check checked={r.calendar} onChange={(calendar) => set(r.key, { calendar })} title="Its projects are in the calendar feed">
                  Calendar
                </Check>
                <Check checked={r.invoicing} onChange={(invoicing) => set(r.key, { invoicing })} title="Its projects can go in the Xero export">
                  Invoicing
                </Check>
              </div>
              {restaged && (
                <p className="text-xs text-amber-700 pl-[4.25rem]">
                  Its {count} project{count === 1 ? "" : "s"} change with it.
                </p>
              )}
            </div>
          );
        })}
        <button onClick={add} disabled={rows.length >= 30} className="self-start text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">
          + Add status
        </button>
      </div>

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

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!dirty || saving || rows.some((r) => !r.name.trim()) || unmoved.length > 0 || noStart} className="btn-primary">
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
        {unmoved.length > 0 && <span className="text-xs text-amber-700">Say where the removed statuses&apos; projects go.</span>}
        {noStart && <span className="text-xs text-amber-700">Keep an open status that isn&apos;t out, for new projects to start in.</span>}
      </div>
    </div>
  );
}

// A labelled option on a status's second line.
function Option({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </span>
  );
}

function Check({ checked, onChange, title, children }: { checked: boolean; onChange: (checked: boolean) => void; title: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
