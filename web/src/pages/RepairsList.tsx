import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Item, Repair, RepairStatus } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { formatDate, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { REPAIR_STATUSES } from "../lib/statuses";
import { RepairStatusBadge } from "../components/StatusBadge";
import NewRepairModal from "../components/repair/NewRepairModal";

export type RepairWithItem = Repair & { expand?: { item?: Item } };

type Filter = "open" | "all" | RepairStatus;

export function useRepairs() {
  return useQuery({
    queryKey: ["repairs"],
    queryFn: () => pb.collection("repairs").getFullList<RepairWithItem>({ filter: orgFilter(), sort: "-number", expand: "item" }),
  });
}

// What's broken: everything out of service for repair first, then the
// history. Open repairs past their expected-back date are flagged.
export default function RepairsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const { data: repairs = [], isLoading, error } = useRepairs();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return repairs.filter((r) => {
      if (filter === "open" ? !(r.status === "open" || r.status === "in_progress") : filter !== "all" && r.status !== filter) return false;
      if (!term) return true;
      return [`r${r.number}`, String(r.number), r.expand?.item?.name ?? "", r.fault, r.repairer].some((v) => v.toLowerCase().includes(term));
    });
  }, [repairs, search, filter]);

  const now = Date.now();

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Repairs</h1>
          <p className="text-xs text-gray-500">{filtered.length.toLocaleString()} shown</p>
        </div>
        {can("units.flag") && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            New repair
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, item, fault, repairer…"
          className="input w-72"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="input w-auto">
          <option value="open">Open (out of service)</option>
          <option value="all">All repairs</option>
          {REPAIR_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load repairs: {(error as Error).message}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2 font-medium w-16">#</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium hidden md:table-cell">Fault</th>
              <th className="px-3 py-2 font-medium hidden sm:table-cell">Repaired by</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Expected back</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => {
              const open = r.status === "open" || r.status === "in_progress";
              const overdue = open && (parseDate(r.dueAt)?.getTime() ?? Infinity) < now;
              const serialised = r.serials.length > 0;
              return (
                <tr key={r.id} onClick={() => navigate(`/repairs/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">R{r.number}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-gray-900 truncate">{r.expand?.item?.name ?? "(deleted item)"}</span>
                      <span className="text-xs text-gray-500">
                        {serialised ? `${r.serials.length} unit${r.serials.length === 1 ? "" : "s"}` : `× ${r.quantity}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden md:table-cell max-w-xs truncate" title={r.fault}>
                    {r.fault}
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden sm:table-cell">{r.repairer || "—"}</td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap ${overdue ? "text-fault-ink font-medium" : "text-gray-600"}`}
                    title={overdue ? "Overdue" : undefined}
                  >
                    {r.dueAt ? formatDate(r.dueAt) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <RepairStatusBadge status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">
            {repairs.length === 0 ? "No repairs yet." : filter === "open" && !search ? "Nothing's out for repair." : "No repairs match."}
          </p>
        )}
      </div>

      {creating && (
        <NewRepairModal
          onClose={() => setCreating(false)}
          onCreated={async (repair) => {
            setCreating(false);
            await invalidateRepairs(queryClient);
            navigate(`/repairs/${repair.id}`);
          }}
        />
      )}
    </div>
  );
}

// Everything a repair changes: the repairs, units, item stock and availability.
export function invalidateRepairs(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    ["repairs", "serials", "serial", "items", "item", "availability"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  );
}
