import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type RepairStage, type RepairStatusInput, type StatusColour } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { useRepairStatuses } from "../lib/maintenance";
import { REPAIR_STAGES, STATUS_COLOURS } from "../lib/statuses";
import { useToast } from "./ToastProvider";

type Row = RepairStatusInput & { key: string };

let nextKey = 0;
const keyed = (s: RepairStatusInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// Settings > Repair statuses: the steps a repair goes through, in this
// business's own words and order. What each one does to the kit is its
// stage (pb_hooks/lib/repairs.js): out of service while it's there, or
// ending the repair repaired or unrepairable. A status with repairs in it
// keeps its stage and can't be removed until they've moved on.
export default function RepairStatusesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { statuses, isLoading } = useRepairStatuses();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(
    () => statuses.map((s) => keyed({ id: s.id, name: s.name, stage: s.stage, colour: s.colour || "gray", isDefault: s.isDefault })),
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

  async function save() {
    setSaving(true);
    try {
      await api.saveRepairStatuses(rows.map(({ key: _key, ...rest }) => ({ ...rest, name: rest.name.trim() })));
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
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Repair statuses</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          The steps a repair goes through, in your words and order. What each one does to the kit is set by its stage; new repairs start in the default.
        </p>
      </div>

      <div className="card p-4 flex flex-col gap-2 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.map((r, i) => {
          const count = r.id ? (inUse[r.id] ?? 0) : 0;
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
                className="input py-1.5 w-auto"
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
                placeholder="Name, e.g. Waiting for parts"
                className="input py-1.5 flex-1 min-w-40"
                maxLength={60}
              />
              <select
                value={r.stage}
                onChange={(e) => set(r.key, { stage: e.target.value as RepairStage, isDefault: e.target.value === "open" && r.isDefault })}
                disabled={count > 0}
                title={count > 0 ? "Repairs are in this status, so what it does can't change" : REPAIR_STAGES.find((s) => s.value === r.stage)?.hint}
                className="input py-1.5 w-auto"
                aria-label={`What ${r.name} does`}
              >
                {REPAIR_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className={`flex items-center gap-1.5 text-xs ${r.stage === "open" ? "text-gray-600" : "invisible"}`}>
                <input
                  type="radio"
                  name="default-status"
                  checked={r.isDefault}
                  onChange={() => setRows((prev) => prev.map((x) => ({ ...x, isDefault: x.key === r.key })))}
                />
                Default
              </label>
              <span className="text-xs text-gray-400 w-20 text-right">{count > 0 ? `${count} repair${count === 1 ? "" : "s"}` : ""}</span>
              <button
                onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                disabled={count > 0}
                title={count > 0 ? "Move its repairs to another status first" : `Remove ${r.name}`}
                className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={`Remove ${r.name}`}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={() => setRows((prev) => [...prev, keyed({ name: "", stage: "open", colour: "gray", isDefault: false })])}
            disabled={rows.length >= 20}
            className="btn-secondary"
          >
            Add status
          </button>
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

      <div className="card p-4 flex flex-col gap-1.5 text-xs text-gray-600">
        {REPAIR_STAGES.map((s) => (
          <p key={s.value}>
            <span className="font-medium text-gray-900">{s.label}:</span> {s.hint}.
          </p>
        ))}
        <p>Keep at least one out-of-service status for new repairs to start in, and one repaired status to finish them.</p>
      </div>
    </div>
  );
}
