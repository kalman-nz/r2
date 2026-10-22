import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDate, parseDate } from "../../lib/format";
import { useRepairStatuses, useRepairs } from "../../lib/maintenance";
import { RepairStatusBadge } from "../StatusBadge";

// "open" (everything out of service), "all", or one status's id.
type Filter = string;

// What's broken: everything out of service for repair first, then the
// history. Open repairs past their expected-back date are flagged.
export default function RepairsTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const { data: repairs = [], isLoading, error } = useRepairs();
  const { statuses, isOpen } = useRepairStatuses();
  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, all: repairs.length };
    for (const r of repairs) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (isOpen(r.status)) c.open++;
    }
    return c;
  }, [repairs, isOpen]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    return repairs.filter((r) => {
      if (filter === "open" ? !isOpen(r.status) : filter !== "all" && r.status !== filter) return false;
      if (!term) return true;
      const job = r.expand?.job;
      return [`r${r.number}`, String(r.number), r.expand?.item?.name ?? "", r.fault, r.repairer, job ? `${job.number} ${job.name}` : ""].some((v) =>
        v.toLowerCase().includes(term),
      );
    });
  }, [repairs, search, filter, isOpen]);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, item, fault, repairer, project…"
          className="input w-80 max-w-full"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="input w-auto">
          <option value="open">Out of service ({counts.open})</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({counts[s.id] ?? 0})
            </option>
          ))}
          <option value="all">All repairs ({counts.all})</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length.toLocaleString()} shown</span>
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
              const open = isOpen(r.status);
              const overdue = open && (parseDate(r.dueAt)?.getTime() ?? Infinity) < now;
              const serialised = r.serials.length > 0;
              const job = r.expand?.job;
              return (
                <tr key={r.id} onClick={() => navigate(`/maintenance/repairs/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">R{r.number}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-gray-900 truncate">{r.expand?.item?.name ?? "(deleted item)"}</span>
                      <span className="text-xs text-gray-500 truncate">
                        {serialised ? `${r.serials.length} unit${r.serials.length === 1 ? "" : "s"}` : `× ${r.quantity}`}
                        {job && ` · from #${job.number} ${job.name}`}
                        {r.files?.length > 0 && ` · ${r.files.length} file${r.files.length === 1 ? "" : "s"}`}
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
    </div>
  );
}
