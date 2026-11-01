import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type RepairStage, type RepairStatusInput } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { useRepairStatuses } from "../lib/maintenance";
import { useToast } from "./ToastProvider";
import ColourPicker from "./ColourPicker";
import Segmented from "./Segmented";

type Row = RepairStatusInput & { key: string };

let nextKey = 0;
const keyed = (s: RepairStatusInput): Row => ({ ...s, key: s.id ?? `new-${++nextKey}` });

// What a status does to the kit (its stage, pb_hooks/lib/repairs.js).
const KIT: { value: RepairStage; label: string }[] = [
  { value: "open", label: "Out of service" },
  { value: "repaired", label: "Back in service" },
  { value: "unrepairable", label: "Retired" },
];

// Settings > Repair statuses: the steps a repair goes through, in this
// business's own words and order, each with what it does set by hand: what
// happens to the kit, and whether it closes the repair (kit out of service
// never does). A status with repairs in it can't change what it does, or
// be removed, until they've moved on.
export default function RepairStatusesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { statuses, isLoading } = useRepairStatuses();
  const [rows, setRows] = useState<Row[]>([]);
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
          // Saved before closes existed: as the stage had it.
          closes: s.stage !== "open" && s.closes !== false,
        }),
      ),
    [statuses],
  );
  useEffect(() => setRows(saved), [saved]);

  // How many repairs are in each status, to say which can't change.
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
  // Kit out of service never closes; leaving it, a repair usually does.
  const setKit = (r: Row, stage: RepairStage) =>
    set(r.key, { stage, closes: stage === "open" ? false : r.stage === "open" ? true : r.closes, isDefault: r.isDefault && stage === "open" });
  const add = () => setRows((prev) => [...prev, keyed({ name: "", stage: "open", colour: "gray", isDefault: false, closes: false })]);
  // Repairs need somewhere to start and somewhere to finish.
  const missing = !rows.some((r) => r.stage === "open")
    ? "Keep a status that takes the kit out of service, for new repairs to start in"
    : !rows.some((r) => r.stage === "repaired")
      ? "Keep a status that puts the kit back in service"
      : "";

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
      <h2 className="text-sm font-semibold text-gray-900">Repair statuses</h2>

      <div className="card p-4 flex flex-col gap-3 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {rows.map((r, i) => {
          const count = r.id ? (inUse[r.id] ?? 0) : 0;
          const locked = count > 0;
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
                {r.stage === "open" && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0" title="New repairs start here">
                    <input type="radio" name="default-status" checked={r.isDefault} onChange={() => setRows((prev) => prev.map((x) => ({ ...x, isDefault: x.key === r.key })))} />
                    Default
                  </label>
                )}
                <span className="text-xs text-gray-400 w-20 text-right shrink-0">{count > 0 ? `${count} repair${count === 1 ? "" : "s"}` : ""}</span>
                <button
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  disabled={locked}
                  title={locked ? "Move its repairs to another status first" : `Remove ${r.name}`}
                  className="w-6 h-6 shrink-0 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  aria-label={`Remove ${r.name}`}
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-x-4 gap-y-2 flex-wrap pl-[4.25rem]" title={locked ? "It has repairs in it, so what it does can't change: add a new status instead" : undefined}>
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Kit</span>
                  <Segmented compact label={`What ${r.name} does to the kit`} value={r.stage} options={KIT} disabled={locked} onChange={(stage) => setKit(r, stage)} />
                </span>
                <label
                  className={`flex items-center gap-1.5 text-xs ${r.stage === "open" || locked ? "text-gray-400" : "text-gray-700 cursor-pointer"}`}
                  title={r.stage === "open" ? "Kit out of service keeps the repair open" : "Finishes the repair: it's stamped closed"}
                >
                  <input type="checkbox" checked={r.closes} disabled={r.stage === "open" || locked} onChange={(e) => set(r.key, { closes: e.target.checked })} />
                  Closes the repair
                </label>
              </div>
            </div>
          );
        })}
        <button onClick={add} disabled={rows.length >= 20} className="self-start text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40">
          + Add status
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
