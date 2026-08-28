import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type ProjectFinancials } from "../lib/api";
import RefreshButton from "../components/RefreshButton";

// Admin-only rollup of every Rentman project's money — see
// pocketbase/pb_hooks/routes_projects.pb.js for how the figures are summed
// across each project's in_financial subprojects.

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

type NumericKey =
  | "totalPrice"
  | "rentalPrice"
  | "salePrice"
  | "crewPrice"
  | "transportPrice"
  | "otherPrice"
  | "servicesPrice"
  | "actualCost"
  | "margin"
  | "alreadyInvoiced";

type SortKey = "name" | "customer" | "projectType" | "status" | "periodStart" | NumericKey;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Project" },
  { key: "customer", label: "Customer" },
  { key: "projectType", label: "Type" },
  { key: "status", label: "Status" },
  { key: "periodStart", label: "Period" },
  { key: "totalPrice", label: "Total", numeric: true },
  { key: "rentalPrice", label: "Rental", numeric: true },
  { key: "salePrice", label: "Sale", numeric: true },
  { key: "crewPrice", label: "Crew", numeric: true },
  { key: "transportPrice", label: "Transport", numeric: true },
  { key: "otherPrice", label: "Other", numeric: true },
  { key: "servicesPrice", label: "Services", numeric: true },
  { key: "actualCost", label: "Cost", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "alreadyInvoiced", label: "Invoiced", numeric: true },
];

const CSV_HEADERS = [
  "Project ID",
  "Project",
  "Number",
  "Reference",
  "Customer",
  "Account manager",
  "Type",
  "Status",
  "Period start",
  "Period end",
  "Subprojects",
  "Total price",
  "Rental",
  "Sale",
  "Crew",
  "Transport",
  "Other",
  "Insurance",
  "Services",
  "Estimated cost",
  "Planned cost",
  "Actual cost",
  "Margin",
  "Already invoiced",
  "Has discount",
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
        r.accountManager ?? "",
        r.projectType ?? "",
        r.status ?? "",
        r.periodStart ?? "",
        r.periodEnd ?? "",
        r.subprojectCount,
        r.totalPrice,
        r.rentalPrice,
        r.salePrice,
        r.crewPrice,
        r.transportPrice,
        r.otherPrice,
        r.insurancePrice,
        r.servicesPrice,
        r.estimatedCost,
        r.plannedCost,
        r.actualCost,
        r.margin,
        r.alreadyInvoiced,
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

export default function ProjectFinancialsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-financials"],
    queryFn: api.listProjectFinancials,
    refetchInterval: 5 * 60_000,
  });

  const [search, setSearch] = useState("");
  const [discountsOnly, setDiscountsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("periodStart");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => data?.data ?? [], [data]);

  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.projectType).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = rows.filter((r) => {
      if (discountsOnly && !r.hasDiscount) return false;
      if (typeFilter !== "all" && r.projectType !== typeFilter) return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (r.customer ?? "").toLowerCase().includes(term) ||
        (r.accountManager ?? "").toLowerCase().includes(term) ||
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
  }, [rows, search, discountsOnly, typeFilter, sortKey, sortDir]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      value: filtered.reduce((s, r) => s + r.totalPrice, 0),
      discounted: filtered.filter((r) => r.hasDiscount).length,
      margin: filtered.reduce((s, r) => s + r.margin, 0),
    }),
    [filtered],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "customer" || key === "projectType" ? "asc" : "desc");
    }
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return (
    <div className="max-w-[90rem] mx-auto flex flex-col gap-6">
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

      {isLoading && <p className="text-neutral-500 text-sm">Loading…</p>}
      {error && (
        <p className="text-red-400 text-sm">Couldn't load financials: {(error as Error).message}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Projects", value: totals.count.toLocaleString() },
              { label: "Total value", value: money(totals.value) },
              { label: "With a discount", value: totals.discounted.toLocaleString() },
              { label: "Total margin", value: money(totals.margin) },
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
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-neutral-900 border border-neutral-800 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-600"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-400 select-none">
              <input
                type="checkbox"
                checked={discountsOnly}
                onChange={(e) => setDiscountsOnly(e.target.checked)}
              />
              Discounts only
            </label>
            <span className="text-xs text-neutral-600 ml-auto">
              {filtered.length}/{rows.length} projects · data as of{" "}
              {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="border border-neutral-800 rounded-lg overflow-hidden">
            <div className="max-h-[40rem] overflow-auto">
              <table className="w-full text-xs border-collapse whitespace-nowrap">
                <thead className="sticky top-0 bg-neutral-950 z-10">
                  <tr className="border-b border-neutral-800 text-left text-neutral-500">
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        className={`px-3 py-2 font-medium cursor-pointer hover:text-neutral-300 ${
                          col.numeric ? "text-right" : ""
                        }`}
                      >
                        {col.label}
                        {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Discount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-neutral-900/50">
                      <td className="px-3 py-2">
                        <Link to={`/projects/${r.id}`} className="hover:text-white text-neutral-200">
                          {r.name}
                        </Link>
                        {r.subprojectCount > 1 && (
                          <span className="text-neutral-600"> · {r.subprojectCount} subprojects</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{r.customer ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">{r.projectType ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">{r.status ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-500">{date(r.periodStart)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.totalPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.rentalPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.salePrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.crewPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.transportPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.otherPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.servicesPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.actualCost)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          r.margin < 0 ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {money(r.margin)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{money(r.alreadyInvoiced)}</td>
                      <td className="px-3 py-2">
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
