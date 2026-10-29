import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type RepairStage, type RepairStatusInput, type StatusColour } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { useRepairStatuses } from "../lib/maintenance";
import { REPAIR_STAGES, STATUS_COLOURS, repairStageHint } from "../lib/statuses";
import { useFeature } from "../lib/roles";
import { useToast } from "./ToastProvider";

type Row = RepairStatusInput & { key: string };

let nextKey = 0;
const keyed = (s: RepairStatusInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// Statuses in stage order, keeping their order within each stage.
const grouped = (list: Row[]) => REPAIR_STAGES.flatMap((s) => list.filter((r) => r.stage === s.value));

// Settings > Repair statuses: the steps a repair goes through, in this
// business's own words and order, grouped by stage (pb_hooks/lib/repairs.js):
// out of service while it's there, or ending the repair repaired or
// unrepairable. A status with repairs in it can't be removed until they've
// moved on.
export default function RepairStatusesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { statuses, isLoading } = useRepairStatuses();
  const projectsOn = useFeature()("projects");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () => grouped(statuses.map((s) => keyed({ id: s.id, name: s.name, stage: s.stage, colour: s.colour || "gray", isDefault: s.isDefault }))),
    [statuses],
  );
  useEffect(() => setRows(saved), [saved]);

  // How many repairs are in each status, to say which can't be removed.
  const { data: inUse = {} } = useQuery({
    queryKey: ["repairs", "by-status"],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      for (const r of await pb.collection("repairs").getFullList<{ status: string }>({ filter: orgFilter(), fields: "status" })) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      }
      return counts;
    },
  });

  const strip = (r: Row[]) => JSON.stringify(grouped(r).map(({ key: _key, ...rest }) => rest));
  const dirty = strip(rows) !== strip(saved);
  const set = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Swap a status with its neighbour in the same stage.
  const move = (row: Row, by: number) =>
    setRows((prev) => {
      const same = prev.filter((r) => r.stage === row.stage);
      const other = same[same.findIndex((r) => r.key === row.key) + by];
      if (!other) return prev;
      return prev.map((r) => (r.key === row.key ? other : r.key === other.key ? row : r));
    });
  const add = (stage: RepairStage) => setRows((prev) => [...prev, keyed({ name: "", stage, colour: "gray", isDefault: false })]);

  async function save() {
    setSaving(true);
    try {
      await api.saveRepairStatuses(grouped(rows).map(({ key: _key, ...rest }) => ({ ...rest, name: rest.name.trim() })));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["repair-statuses"] }), queryClient.invalidateQueries({ queryKey: ["repairs"] })]);
      showToast("success", "Repair statuses saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-gray-900">Repair statuses</h2>
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {REPAIR_STAGES.map((stage) => {
        const list = rows.filter((r) => r.stage === stage.value);
        // Repairs need somewhere to start and somewhere to finish.
        const needsOne = stage.value !== "unrepairable" && list.length === 1;
        return (
          <section key={stage.value} className="card p-4 flex flex-col gap-2 text-sm">
            <h3 className="font-medium text-gray-900" title={repairStageHint(stage.value, projectsOn)}>
              {stage.label}
            </h3>
            {list.map((r, i) => {
              const count = r.id ? (inUse[r.id] ?? 0) : 0;
              const locked = count > 0 || needsOne;
              return (
                <div key={r.key} className="flex items-center gap-2">
                  <span className="flex flex-col">
                    <button onClick={() => move(r, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs" aria-label={`Move ${r.name} up`}>
                      ▲
                    </button>
                    <button
                      onClick={() => move(r, 1)}
                      disabled={i === list.length - 1}
                      className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs"
                      aria-label={`Move ${r.name} down`}
                    >
                      ▼
                    </button>
                  </span>
                  <ColourPicker value={r.colour || "gray"} onChange={(colour) => set(r.key, { colour })} label={r.name} />
                  <input
                    value={r.name}
                    onChange={(e) => set(r.key, { name: e.target.value })}
                    placeholder={stage.value === "open" ? "Name, e.g. Waiting for parts" : "Name"}
                    className="input py-1.5 flex-1 min-w-0"
                    maxLength={60}
                  />
                  {stage.value === "open" && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0" title="New repairs start here">
                      <input
                        type="radio"
                        name="default-status"
                        checked={r.isDefault}
                        onChange={() => setRows((prev) => prev.map((x) => ({ ...x, isDefault: x.key === r.key })))}
                      />
                      Default
                    </label>
                  )}
                  <span className="text-xs text-gray-400 w-20 text-right shrink-0">{count > 0 ? `${count} repair${count === 1 ? "" : "s"}` : ""}</span>
                  <button
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    disabled={locked}
                    title={count > 0 ? "Move its repairs to another status first" : needsOne ? `Keep at least one ${stage.label.toLowerCase()} status` : `Remove ${r.name}`}
                    className="w-6 h-6 shrink-0 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                    aria-label={`Remove ${r.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button onClick={() => add(stage.value)} disabled={rows.length >= 20} className="self-start text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 pt-1">
              + Add status
            </button>
          </section>
        );
      })}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!dirty || saving || rows.some((r) => !r.name.trim())} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button onClick={() => setRows(saved)} disabled={saving} className="text-xs text-gray-500 hover:text-gray-900">
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

// A colour swatch that opens a row of the status colours.
function ColourPicker({ value, onChange, label }: { value: StatusColour; onChange: (c: StatusColour) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-md border border-gray-200 hover:border-gray-400 flex items-center justify-center"
        aria-label={`Colour of ${label}: ${STATUS_COLOURS[value].label}`}
        title={STATUS_COLOURS[value].label}
      >
        <span className={`w-3.5 h-3.5 rounded-full ${STATUS_COLOURS[value].dot}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 flex gap-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-md">
          {(Object.keys(STATUS_COLOURS) as StatusColour[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={`w-6 h-6 rounded flex items-center justify-center hover:bg-gray-100 ${c === value ? "ring-1 ring-gray-400" : ""}`}
              aria-label={STATUS_COLOURS[c].label}
              title={STATUS_COLOURS[c].label}
            >
              <span className={`w-3.5 h-3.5 rounded-full ${STATUS_COLOURS[c].dot}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
