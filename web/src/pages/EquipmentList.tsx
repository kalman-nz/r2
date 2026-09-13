import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Equipment } from "../lib/api";
import RefreshButton from "../components/RefreshButton";

const COLUMNS_STORAGE_KEY = "assets.visibleColumns";

interface Column {
  key: string;
  label: string;
  align?: "right";
  toggleable: boolean;
  defaultVisible: boolean;
  sortValue: (item: Equipment) => string | number;
  render: (item: Equipment) => React.ReactNode;
}

function money(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    toggleable: false,
    defaultVisible: true,
    sortValue: (i) => (i.displayname ?? i.name ?? "").toLowerCase(),
    render: (i) => (
      <div className="flex flex-col min-w-0">
        <span className="font-medium text-gray-900 truncate">{i.displayname ?? i.name}</span>
        {i.in_archive && (
          <span className="text-xs text-gray-400">Archived</span>
        )}
      </div>
    ),
  },
  {
    key: "code",
    label: "Code",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => (i.code ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.code || "—"}</span>,
  },
  {
    key: "type",
    label: "Type",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => (i.type ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.type || "—"}</span>,
  },
  {
    key: "location",
    label: "Location",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => (i.location_in_warehouse ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.location_in_warehouse || "—"}</span>,
  },
  {
    key: "tags",
    label: "Tags",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => (i.tags ?? "").toLowerCase(),
    render: (i) =>
      i.tags ? (
        <span className="text-gray-500 truncate">{i.tags}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
  },
  {
    key: "quantity",
    label: "In stock",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => i.current_quantity ?? 0,
    render: (i) => {
      const qty = i.current_quantity ?? 0;
      const low = i.critical_stock_level > 0 && qty <= i.critical_stock_level;
      return (
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          <span className={`status-dot ${low ? "bg-[#fc3465]" : "bg-[#16d590]"}`} />
          <span className={low ? "text-[#fc3465] font-medium" : "text-gray-700"}>{qty}</span>
        </span>
      );
    },
  },
  {
    key: "quantityExclCases",
    label: "Qty (excl. cases)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => i.current_quantity_excl_cases ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.current_quantity_excl_cases)}</span>,
  },
  {
    key: "price",
    label: "Price",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    sortValue: (i) => i.price ?? 0,
    render: (i) => <span className="text-gray-700 tabular-nums">{money(i.price)}</span>,
  },
  {
    key: "listPrice",
    label: "List price",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => i.list_price ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{money(i.list_price)}</span>,
  },
  {
    key: "weight",
    label: "Weight (kg)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => i.weight ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.weight)}</span>,
  },
  {
    key: "power",
    label: "Power (W)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => i.power ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.power)}</span>,
  },
  {
    key: "criticalStock",
    label: "Critical stock",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => i.critical_stock_level ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.critical_stock_level)}</span>,
  },
  {
    key: "country",
    label: "Country of origin",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => (i.country_of_origin ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.country_of_origin || "—"}</span>,
  },
  {
    key: "rentalSales",
    label: "Rental / sales",
    toggleable: true,
    defaultVisible: false,
    sortValue: (i) => (i.rental_sales ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.rental_sales || "—"}</span>,
  },
];

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // fall through to defaults
  }
  return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key));
}

function ColumnPicker({ visible, onToggle }: { visible: Set<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary">
        Columns
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 card shadow-lg z-20 py-1 max-h-80 overflow-y-auto">
          {COLUMNS.filter((c) => c.toggleable).map((c) => (
            <label
              key={c.key}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              <input type="checkbox" checked={visible.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EquipmentList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(loadVisibleColumns);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["equipment"],
    queryFn: api.listEquipment,
    // Matches the server's Rentman cache TTL (see rentman/client.ts) — polling
    // faster than that just forces an expensive full catalog + full
    // stock-movement-history re-walk against Rentman for no fresher data.
    refetchInterval: 5 * 60_000,
  });

  const items = useMemo(() => data?.data ?? [], [data]);

  const types = useMemo(
    () => Array.from(new Set(items.map((i) => i.type).filter(Boolean))).sort(),
    [items],
  );
  const locations = useMemo(
    () => Array.from(new Set(items.map((i) => i.location_in_warehouse).filter(Boolean))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = items.filter((e) => {
      if (!showArchived && e.in_archive) return false;
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (locationFilter !== "all" && e.location_in_warehouse !== locationFilter) return false;
      if (lowStockOnly && !(e.critical_stock_level > 0 && (e.current_quantity ?? 0) <= e.critical_stock_level)) {
        return false;
      }
      if (term && !JSON.stringify(e).toLowerCase().includes(term)) return false;
      return true;
    });

    const column = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0];
    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      const av = column.sortValue(a);
      const bv = column.sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return result;
  }, [items, search, typeFilter, locationFilter, showArchived, lowStockOnly, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleColumn(key: string) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const columns = COLUMNS.filter((c) => !c.toggleable || visibleColumns.has(c.key));
  const arrow = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) + (locationFilter !== "all" ? 1 : 0) + (showArchived ? 1 : 0) + (lowStockOnly ? 1 : 0);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Assets</h1>
          <p className="text-xs text-gray-500">
            {filtered.length.toLocaleString()} of {items.length.toLocaleString()} equipment types
          </p>
        </div>
        <RefreshButton queryKeys={[["equipment"]]} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search equipment, code, tag…"
          className="input w-60"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input w-auto">
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="input w-auto">
          <option value="all">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 px-1.5">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 px-1.5">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {activeFilterCount > 0 && (
          <button
            onClick={() => {
              setTypeFilter("all");
              setLocationFilter("all");
              setShowArchived(false);
              setLowStockOnly(false);
            }}
            className="text-xs text-[#167cfb] hover:text-[#0f6ae0] px-1.5"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto">
          <ColumnPicker visible={visibleColumns} onToggle={toggleColumn} />
        </div>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && (
        <p className="text-red-600 text-sm">
          Couldn't load equipment: {(error as Error).message}. Check RENTMAN_API_TOKEN in server/.env.
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-gray-200 text-left text-gray-500">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.label}
                    {arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/equipment/${item.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 ${c.align === "right" ? "text-right" : ""}`}>
                      {c.render(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">No equipment found.</p>
        )}
      </div>
    </div>
  );
}
