import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type ProjectFinancials } from "../lib/api";
import RefreshButton from "../components/RefreshButton";

// Admin-only list of every Rentman project, its rental value, and whether a
// discount was given — with CSV / JSON export. See
// pocketbase/pb_hooks/routes_projects.pb.js for how the figures are rolled up.

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function describeDiscounts(row: ProjectFinancials): string {
  return row.discounts
    .map((d) => {
      const value = d.percent != null ? `${d.percent}%` : money(d.amount ?? 0);
      const where = row.subprojectCount > 1 && d.subproject ? ` (${d.subproject})` : "";
      return `${d.type} ${value}${where}`;
    })
    .join("; ");
}

const CSV_HEADERS = [
  "Project ID",
  "Project",
  "Number",
  "Reference",
  "Customer",
  "Period start",
  "Subprojects",
  "Total price",
  "Discount given",
  "Discount detail",
];

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ProjectFinancials[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.number ?? "",
        r.reference,
        r.customer ?? "",
        r.periodStart ?? "",
        r.subprojectCount,
        r.totalPrice,
        r.hasDiscount ? "yes" : "no",
        describeDiscounts(r),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type SortKey = "name" | "customer" | "periodStart" | "totalPrice";

export default function ProjectFinancialsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-financials"],
    queryFn: api.listProjectFinancials,
    refetchInterval: 5 * 60_000,
  });

  const [search, setSearch] = useState("");
  const [discountFilter, setDiscountFilter] = useState<"all" | "with" | "without">("all");
  const [sortKey, setSortKey] = useState<SortKey>("periodStart");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = rows.filter((r) => {
      if (discountFilter === "with" && !r.hasDiscount) return false;
      if (discountFilter === "without" && r.hasDiscount) return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (r.customer ?? "").toLowerCase().includes(term) ||
        (r.reference ?? "").toLowerCase().includes(term) ||
        String(r.number ?? "").includes(term)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [rows, search, discountFilter, sortKey, sortDir]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      value: filtered.reduce((s, r) => s + r.totalPrice, 0),
      discounted: filtered.filter((r) => r.hasDiscount).length,
    }),
    [filtered],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "customer" ? "asc" : "desc");
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Project financials</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => download(`project-financials-${stamp}.csv`, toCsv(filtered), "text/csv")}
            disabled={filtered.length === 0}
            className="text-sm px-3 py-1.5 rounded-md bg-white text-black font-medium hover:bg-neutral-200 disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() =>
              download(
                `project-financials-${stamp}.json`,
                JSON.stringify(filtered, null, 2),
                "application/json",
              )
            }
            disabled={filtered.length === 0}
            className="text-sm px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-900 disabled:opacity-50"
          >
            Export JSON
          </button>
          <RefreshButton queryKeys={[["project-financials"]]} />
        </div>
      </div>

      {isLoading && <p className="text-neutral-500 text-sm">Loading… (this pulls every project from Rentman)</p>}
      {error && (
        <p className="text-red-400 text-sm">
          Couldn't load financials: {(error as Error).message}. Rentman can be slow — try Refresh again.
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Projects", value: totals.count.toLocaleString() },
              { label: "Total rental value", value: money(totals.value) },
              { label: "Discount given", value: totals.discounted.toLocaleString() },
            ].map((tile) => (
              <div key={tile.label} className="border border-neutral-800 rounded-lg p-4 flex flex-col gap-1">
                <span className="text-sm text-neutral-500">{tile.label}</span>
                <span className="text-2xl font-semibold tabular-nums">{tile.value}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search project / customer / reference…"
              className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-1.5 text-sm w-72 focus:outline-none focus:border-neutral-600"
            />
            <select
              value={discountFilter}
              onChange={(e) => setDiscountFilter(e.target.value as typeof discountFilter)}
              className="bg-neutral-900 border border-neutral-800 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-600"
            >
              <option value="all">All projects</option>
              <option value="with">Discount given</option>
              <option value="without">No discount</option>
            </select>
            <span className="text-xs text-neutral-600 ml-auto">
              {filtered.length}/{rows.length} · data as of {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="border border-neutral-800 rounded-lg overflow-hidden">
            <div className="max-h-[40rem] overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-neutral-950 z-10">
                  <tr className="border-b border-neutral-800 text-left text-neutral-500 text-xs">
                    <th onClick={() => toggleSort("name")} className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300">
                      Project{arrow("name")}
                    </th>
                    <th onClick={() => toggleSort("customer")} className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300">
                      Customer{arrow("customer")}
                    </th>
                    <th onClick={() => toggleSort("periodStart")} className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300">
                      Period{arrow("periodStart")}
                    </th>
                    <th onClick={() => toggleSort("totalPrice")} className="px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 text-right">
                      Total{arrow("totalPrice")}
                    </th>
                    <th className="px-3 py-2 font-medium">Discount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <Link to={`/projects/${r.id}`} className="text-neutral-200 hover:text-white">
                          {r.name}
                        </Link>
                        {r.number != null && <span className="text-neutral-600 text-xs"> · #{r.number}</span>}
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{r.customer ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-500 text-xs whitespace-nowrap">{date(r.periodStart)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">{money(r.totalPrice)}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.hasDiscount ? (
                          <span
                            title={describeDiscounts(r)}
                            className="text-amber-400 border border-amber-400/30 bg-amber-400/10 rounded px-1.5 py-0.5"
                          >
                            {describeDiscounts(r)}
                          </span>
                        ) : (
                          <span className="text-neutral-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-neutral-500 text-sm">No projects match this filter.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
