import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Equipment, type EquipmentView } from "../lib/api";
import { renderEquipmentLabelImage, sendRenderedLabel } from "../lib/print";
import { money, num } from "../lib/format";
import RefreshButton from "../components/RefreshButton";
import BatchPrintBar from "../components/BatchPrintBar";

const COLUMNS_STORAGE_KEY = "assets.visibleColumns";
const WIDTHS_STORAGE_KEY = "assets.columnWidths";
const ACTIVE_VIEW_STORAGE_KEY = "assets.activeViewId";
const CHECKBOX_COLUMN_WIDTH = 36;
const MIN_COLUMN_WIDTH = 60;

interface Column {
  key: string;
  label: string;
  align?: "right";
  toggleable: boolean;
  defaultVisible: boolean;
  defaultWidth: number;
  sortValue: (item: Equipment) => string | number;
  render: (item: Equipment) => React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    toggleable: false,
    defaultVisible: true,
    defaultWidth: 240,
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
    defaultWidth: 110,
    sortValue: (i) => (i.code ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.code || "—"}</span>,
  },
  {
    key: "type",
    label: "Type",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 130,
    sortValue: (i) => (i.type ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.type || "—"}</span>,
  },
  {
    key: "location",
    label: "Location",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 140,
    sortValue: (i) => (i.location_in_warehouse ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.location_in_warehouse || "—"}</span>,
  },
  {
    key: "tags",
    label: "Tags",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 170,
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
    defaultWidth: 100,
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
    defaultWidth: 160,
    sortValue: (i) => i.current_quantity_excl_cases ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.current_quantity_excl_cases)}</span>,
  },
  {
    key: "price",
    label: "Price",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 100,
    sortValue: (i) => i.price ?? 0,
    render: (i) => <span className="text-gray-700 tabular-nums">{money(i.price)}</span>,
  },
  {
    key: "listPrice",
    label: "List price",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 110,
    sortValue: (i) => i.list_price ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{money(i.list_price)}</span>,
  },
  {
    key: "weight",
    label: "Weight (kg)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 120,
    sortValue: (i) => i.weight ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.weight)}</span>,
  },
  {
    key: "power",
    label: "Power (W)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 120,
    sortValue: (i) => i.power ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.power)}</span>,
  },
  {
    key: "criticalStock",
    label: "Critical stock",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 130,
    sortValue: (i) => i.critical_stock_level ?? 0,
    render: (i) => <span className="text-gray-600 tabular-nums">{num(i.critical_stock_level)}</span>,
  },
  {
    key: "country",
    label: "Country of origin",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 160,
    sortValue: (i) => (i.country_of_origin ?? "").toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.country_of_origin || "—"}</span>,
  },
  {
    key: "rentalSales",
    label: "Rental / sales",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 130,
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

function loadColumnWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(WIDTHS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to defaults
  }
  return {};
}

function loadActiveViewId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface ViewConfig {
  columns: string[];
  widths: Record<string, number>;
  sortKey: string;
  sortDir: "asc" | "desc";
}

function ViewRow({
  view,
  active,
  busy,
  onApply,
  onPatch,
  onDelete,
}: {
  view: EquipmentView;
  active: boolean;
  busy: boolean;
  onApply: (view: EquipmentView) => void;
  onPatch: (view: EquipmentView, patch: Partial<Pick<EquipmentView, "name" | "shared">>) => void;
  onDelete: (view: EquipmentView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(view.name);

  function commitRename() {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) onPatch(view, { name: trimmed });
    else setName(view.name);
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${active ? "bg-blue-50" : "hover:bg-gray-50"}`}>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setName(view.name);
              setEditing(false);
            }
          }}
          className="input py-0.5 text-sm flex-1 min-w-0"
        />
      ) : (
        <button
          onClick={() => onApply(view)}
          className={`flex-1 text-left text-sm truncate ${active ? "text-[#167cfb] font-medium" : "text-gray-700"}`}
        >
          {view.name}
        </button>
      )}
      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
        <input
          type="checkbox"
          checked={view.shared}
          disabled={busy}
          onChange={(e) => onPatch(view, { shared: e.target.checked })}
        />
        Shared
      </label>
      <button
        onClick={() => setEditing(true)}
        title="Rename"
        className="text-gray-400 hover:text-gray-600 text-xs shrink-0"
      >
        Rename
      </button>
      <button
        onClick={() => onDelete(view)}
        disabled={busy}
        title="Delete view"
        className="text-gray-400 hover:text-red-500 text-sm shrink-0"
      >
        ×
      </button>
    </div>
  );
}

function ManageViewsModal({
  views,
  activeView,
  visibleColumns,
  onToggleColumn,
  getCurrentConfig,
  onApply,
  onSaved,
  onPatched,
  onDeleted,
  onClose,
}: {
  views: EquipmentView[];
  activeView: EquipmentView | null;
  visibleColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  getCurrentConfig: () => ViewConfig;
  onApply: (view: EquipmentView | null) => void;
  onSaved: (view: EquipmentView) => void;
  onPatched: (view: EquipmentView) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [shareNew, setShareNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const myViews = views.filter((v) => v.isOwner);
  const sharedViews = views.filter((v) => !v.isOwner);

  async function saveAsNew() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const view = await api.createEquipmentView({ name, shared: shareNew, ...getCurrentConfig() });
      setNewName("");
      setShareNew(false);
      onSaved(view);
    } finally {
      setBusy(false);
    }
  }

  async function updateActive() {
    if (!activeView || busy) return;
    setBusy(true);
    try {
      const view = await api.updateEquipmentView(activeView.id, {
        name: activeView.name,
        shared: activeView.shared,
        ...getCurrentConfig(),
      });
      onSaved(view);
    } finally {
      setBusy(false);
    }
  }

  async function patchView(view: EquipmentView, patch: Partial<Pick<EquipmentView, "name" | "shared">>) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.updateEquipmentView(view.id, {
        name: patch.name ?? view.name,
        shared: patch.shared ?? view.shared,
        columns: view.columns,
        widths: view.widths,
        sortKey: view.sortKey,
        sortDir: view.sortDir,
      });
      onPatched(updated);
    } finally {
      setBusy(false);
    }
  }

  async function remove(view: EquipmentView) {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteEquipmentView(view.id);
      onDeleted(view.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg card p-5 shadow-xl flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Manage views</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ×
          </button>
        </div>

        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Columns</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {COLUMNS.filter((c) => c.toggleable).map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => onToggleColumn(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Save current column setup
          </h3>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onApply(null)}
              className={`text-left text-sm ${!activeView ? "text-[#167cfb] font-medium" : "text-gray-500 hover:text-gray-700"}`}
            >
              Reset to default
            </button>
            {activeView?.isOwner && (
              <button onClick={updateActive} disabled={busy} className="text-left text-xs text-[#167cfb] hover:text-[#0f6ae0]">
                Save changes to "{activeView.name}"
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAsNew()}
                placeholder="New view name…"
                className="input py-1.5 text-sm flex-1 min-w-0"
              />
              <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                <input type="checkbox" checked={shareNew} onChange={(e) => setShareNew(e.target.checked)} />
                Share
              </label>
              <button onClick={saveAsNew} disabled={busy || !newName.trim()} className="btn-secondary py-1.5 text-sm shrink-0">
                Save as new
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">My views</h3>
          <div className="flex flex-col gap-0.5">
            {myViews.map((v) => (
              <ViewRow
                key={v.id}
                view={v}
                active={activeView?.id === v.id}
                busy={busy}
                onApply={onApply}
                onPatch={patchView}
                onDelete={remove}
              />
            ))}
            {myViews.length === 0 && <p className="text-xs text-gray-400">No saved views yet.</p>}
          </div>
        </div>

        {sharedViews.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Shared with you</h3>
            <div className="flex flex-col gap-0.5">
              {sharedViews.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onApply(v)}
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-sm ${
                    activeView?.id === v.id ? "bg-blue-50 text-[#167cfb] font-medium" : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">by {v.ownerName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-secondary">
            Done
          </button>
        </div>
      </div>
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
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(loadActiveViewId);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem(WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (activeViewId) localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeViewId);
    else localStorage.removeItem(ACTIVE_VIEW_STORAGE_KEY);
  }, [activeViewId]);

  const { data: views = [] } = useQuery({
    queryKey: ["equipmentViews"],
    queryFn: api.listEquipmentViews,
  });
  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  function applyView(view: EquipmentView | null) {
    if (view) {
      setVisibleColumns(new Set(view.columns));
      setColumnWidths(view.widths);
      if (view.sortKey) setSortKey(view.sortKey);
      setSortDir(view.sortDir);
      setActiveViewId(view.id);
    } else {
      setVisibleColumns(new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)));
      setColumnWidths({});
      setActiveViewId(null);
    }
  }

  function getCurrentViewConfig(): ViewConfig {
    return {
      columns: COLUMNS.filter((c) => c.toggleable && visibleColumns.has(c.key)).map((c) => c.key),
      widths: columnWidths,
      sortKey,
      sortDir,
    };
  }

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

  function columnWidth(c: Column): number {
    return columnWidths[c.key] ?? c.defaultWidth;
  }

  const tableWidth = CHECKBOX_COLUMN_WIDTH + columns.reduce((sum, c) => sum + columnWidth(c), 0);

  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  function onResizeMove(e: MouseEvent) {
    const r = resizingRef.current;
    if (!r) return;
    const width = Math.max(MIN_COLUMN_WIDTH, Math.round(r.startWidth + (e.clientX - r.startX)));
    setColumnWidths((prev) => ({ ...prev, [r.key]: width }));
  }

  function onResizeEnd() {
    resizingRef.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }

  function startResize(e: React.MouseEvent, c: Column) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key: c.key, startX: e.clientX, startWidth: columnWidth(c) };
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  }

  function handleViewSaved(view: EquipmentView) {
    queryClient.setQueryData<EquipmentView[]>(["equipmentViews"], (prev) => {
      const others = (prev ?? []).filter((v) => v.id !== view.id);
      return [...others, view].sort((a, b) => a.name.localeCompare(b.name));
    });
    setActiveViewId(view.id);
  }

  function handleViewDeleted(id: string) {
    queryClient.setQueryData<EquipmentView[]>(["equipmentViews"], (prev) => (prev ?? []).filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(null);
  }

  // Renaming or (un)sharing a view (any view, not just the active one)
  // just updates its row in the views list — unlike handleViewSaved, it
  // never touches activeViewId or applies anything to the table.
  function handleViewPatched(view: EquipmentView) {
    queryClient.setQueryData<EquipmentView[]>(["equipmentViews"], (prev) =>
      (prev ?? []).map((v) => (v.id === view.id ? view : v)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) + (locationFilter !== "all" ? 1 : 0) + (showArchived ? 1 : 0) + (lowStockOnly ? 1 : 0);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((i) => String(i.id)))));
  }

  const selectedEquipment = filtered.filter((i) => selected.has(String(i.id)));

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Assets</h1>
          <p className="text-xs text-gray-500">
            {filtered.length.toLocaleString()} of {items.length.toLocaleString()} equipment types
          </p>
        </div>
        <RefreshButton queryKeys={[["equipment"]]} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
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
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setManageViewsOpen(true)} className="btn-secondary">
            View: {activeView ? activeView.name : "Default"}
          </button>
        </div>
      </div>

      {manageViewsOpen && (
        <ManageViewsModal
          views={views}
          activeView={activeView}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          getCurrentConfig={getCurrentViewConfig}
          onApply={applyView}
          onSaved={handleViewSaved}
          onPatched={handleViewPatched}
          onDeleted={handleViewDeleted}
          onClose={() => setManageViewsOpen(false)}
        />
      )}

      {isLoading && <p className="text-gray-500 text-sm shrink-0">Loading…</p>}
      {error && (
        <p className="text-red-600 text-sm shrink-0">
          Couldn't load equipment: {(error as Error).message}. Check RENTMAN_API_TOKEN in server/.env.
        </p>
      )}

      {selectedEquipment.length > 0 && (
        <div className="shrink-0">
          <BatchPrintBar<Equipment>
            items={selectedEquipment}
            getDisplayName={(i) => i.displayname ?? i.name}
            renderImage={(i, t) => renderEquipmentLabelImage(i, t)}
            sendPrint={(image, t) => sendRenderedLabel(image, t)}
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}

      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="min-w-full text-[13px] border-collapse" style={{ width: tableWidth, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: CHECKBOX_COLUMN_WIDTH }} />
              {columns.map((c) => (
                <col key={c.key} style={{ width: columnWidth(c) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-3 py-2">
                  {filtered.length > 0 && (
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.size > 0 && selected.size < filtered.length;
                      }}
                      onChange={toggleSelectAll}
                    />
                  )}
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`relative px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap overflow-hidden text-ellipsis border-r border-gray-200 ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.label}
                    {arrow(c.key)}
                    <div
                      onMouseDown={(e) => startResize(e, c)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-[#167cfb]/30 active:bg-[#167cfb]/50"
                    />
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
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(String(item.id))}
                      onChange={() => toggleSelect(String(item.id))}
                    />
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-1.5 overflow-hidden text-ellipsis border-r border-gray-100 ${
                        c.align === "right" ? "text-right" : ""
                      }`}
                    >
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
