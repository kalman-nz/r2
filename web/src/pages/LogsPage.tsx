import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type LogEntry, type Stats } from "../lib/api";

const TILES: { key: keyof Stats; label: string }[] = [
  { key: "upcomingJobs", label: "Active projects" },
  { key: "items", label: "Inventory items" },
  { key: "stockUnits", label: "Units in stock" },
  { key: "kits", label: "Kits" },
  { key: "contacts", label: "Contacts" },
  { key: "labelsPrinted", label: "Labels printed" },
];

// "quote_issued" → "Quote issued"
function eventName(type: string): string {
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function exportLogs(logs: LogEntry[]) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Settings → Audit log: who did what, with a usage summary on top.
export default function LogsPage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ["stats"],
    queryFn: api.getStats,
  });
  const { data: logs, isLoading: logsLoading, error: logsError } = useQuery({
    queryKey: ["logs"],
    queryFn: api.getLogs,
  });

  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const types = useMemo(() => (logs ? Array.from(new Set(logs.map((l) => l.type))).sort() : []), [logs]);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    const term = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (typeFilter !== "all" && entry.type !== typeFilter) return false;
      if (!term) return true;
      return (
        entry.summary.toLowerCase().includes(term) ||
        (entry.who ?? "").toLowerCase().includes(term) ||
        JSON.stringify(entry.details).toLowerCase().includes(term)
      );
    });
  }, [logs, typeFilter, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Usage</h2>
          <p className="text-xs text-gray-500">A snapshot of this organisation right now.</p>
        </div>

        {statsLoading && <p className="text-gray-500 text-sm">Loading…</p>}
        {statsError && <p className="text-red-600 text-sm">Couldn't load stats: {(statsError as Error).message}</p>}

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TILES.map(({ key, label }) => (
              <div key={key} className="card p-4 flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">{label}</span>
                <span className="text-2xl font-semibold text-gray-900">{stats[key].toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Audit log</h2>
            <p className="text-xs text-gray-500">
              {logs ? `${filteredLogs.length.toLocaleString()} of ${logs.length.toLocaleString()} events` : "Every change, scan and print in this organisation."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input py-1.5 text-xs">
              <option value="all">All events</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {eventName(t)}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search person, summary or details…"
              className="input py-1.5 text-xs w-64"
            />
            <button
              onClick={() => exportLogs(filteredLogs)}
              disabled={!logs || filteredLogs.length === 0}
              className="btn-secondary text-xs py-1.5"
            >
              Download JSON
            </button>
          </div>
        </div>

        {logsLoading && <p className="text-gray-500 text-sm">Loading…</p>}
        {logsError && <p className="text-red-600 text-sm">Couldn't load the audit log: {(logsError as Error).message}</p>}

        {logs && (
          <div className="card overflow-hidden">
            <div className="max-h-[36rem] overflow-y-auto overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Event</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">Person</th>
                    <th className="px-3 py-2 font-medium">Summary</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 align-top text-gray-800">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{eventName(entry.type)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{entry.who || "—"}</td>
                      <td className="px-3 py-2">{entry.summary}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono break-all max-w-xs">
                        {JSON.stringify(entry.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLogs.length === 0 && (
                <p className="px-3 py-6 text-gray-500 text-sm">
                  {logs.length === 0 ? "No activity yet." : "No events match this filter."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
