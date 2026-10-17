import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type EquipmentView, type Item } from "../lib/api";
import { renderItemLabelImage, sendRenderedLabel } from "../lib/print";
import { money, num, PRICE_SUFFIX } from "../lib/format";
import { displayPath, useCategories, useCategoryPaths } from "../lib/catalog";
import { useRole } from "../lib/roles";
import BatchPrintBar from "../components/BatchPrintBar";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { folderOf, indexFolders, subtree, trail } from "../lib/folders";
import FolderTree, { FolderIcon } from "../components/item/FolderTree";
import FolderPicker from "../components/item/FolderPicker";
import FolderActions, { useFolderActions } from "../components/item/FolderActions";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import BulkEditModal, { updateEach } from "../components/item/BulkEditModal";

const COLUMNS_STORAGE_KEY = "inventory.visibleColumns";
const WIDTHS_STORAGE_KEY = "inventory.columnWidths";
const ACTIVE_VIEW_STORAGE_KEY = "inventory.activeViewId";
const CHECKBOX_COLUMN_WIDTH = 36;
const MIN_COLUMN_WIDTH = 60;

// An item plus what the table needs that isn't on the record itself.
interface Row extends Item {
  categoryPath: string;
  stock: number | null;
  freeNow: number | null;
}

interface Column {
  key: string;
  label: string;
  align?: "right";
  toggleable: boolean;
  defaultVisible: boolean;
  defaultWidth: number;
  sortValue: (row: Row) => string | number;
  render: (row: Row) => React.ReactNode;
}

const TYPE_LABEL = (i: Item) => (i.kind === "kit" ? "Kit" : i.tracking === "serial" ? "Serialised" : "Bulk");

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    toggleable: false,
    defaultVisible: true,
    defaultWidth: 260,
    sortValue: (i) => i.name.toLowerCase(),
    render: (i) => (
      <div className="flex flex-col min-w-0">
        <span className="font-medium text-gray-900 truncate">{i.name}</span>
        {i.archived && <span className="text-xs text-gray-400">Archived</span>}
      </div>
    ),
  },
  {
    key: "code",
    label: "Code",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 110,
    sortValue: (i) => i.code.toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.code || "—"}</span>,
  },
  {
    key: "category",
    label: "Folder",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 180,
    sortValue: (i) => i.categoryPath.toLowerCase(),
    render: (i) => <span className="text-gray-600 truncate">{displayPath(i.categoryPath) || "—"}</span>,
  },
  {
    key: "type",
    label: "Type",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 100,
    sortValue: (i) => TYPE_LABEL(i),
    render: (i) => <span className="text-gray-600">{TYPE_LABEL(i)}</span>,
  },
  {
    key: "stock",
    label: "Stock",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 80,
    sortValue: (i) => i.stock ?? -1,
    render: (i) => <span className="text-gray-700 tabular-nums">{i.stock === null ? "—" : num(i.stock)}</span>,
  },
  {
    key: "freeNow",
    label: "Free now",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 100,
    sortValue: (i) => i.freeNow ?? -Infinity,
    render: (i) => {
      if (i.freeNow === null) return <span className="text-gray-300">…</span>;
      const none = i.freeNow <= 0;
      return (
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          <span className={`status-dot ${none ? "bg-fault" : "bg-lock"}`} />
          <span className={none ? "text-fault-ink font-medium" : "text-gray-700"}>{i.freeNow}</span>
        </span>
      );
    },
  },
  {
    key: "outOfService",
    label: "Out of service",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 130,
    sortValue: (i) => i.outOfServiceQty,
    render: (i) => <span className="text-gray-600 tabular-nums">{i.tracking === "bulk" ? num(i.outOfServiceQty) : "—"}</span>,
  },
  {
    // Was the day rate; the key stays so saved column choices still apply.
    key: "dayRate",
    label: "Price",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 100,
    sortValue: (i) => i.price,
    render: (i) => (
      <span className="text-gray-700 tabular-nums">
        {money(i.price)}
        <span className="text-gray-400 text-xs">{PRICE_SUFFIX[i.priceUnit] ?? "/day"}</span>
      </span>
    ),
  },
  {
    key: "location",
    label: "Location",
    toggleable: true,
    defaultVisible: true,
    defaultWidth: 130,
    sortValue: (i) => i.locationInWarehouse.toLowerCase(),
    render: (i) => <span className="text-gray-600">{i.locationInWarehouse || "—"}</span>,
  },
  {
    key: "barcode",
    label: "Barcode",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 130,
    sortValue: (i) => i.barcode.toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.barcode || "—"}</span>,
  },
  {
    key: "replacementValue",
    label: "Replacement value",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 150,
    sortValue: (i) => i.replacementValue,
    render: (i) => <span className="text-gray-600 tabular-nums">{money(i.replacementValue)}</span>,
  },
  {
    key: "weight",
    label: "Weight (kg)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 120,
    sortValue: (i) => i.weightKg,
    render: (i) => <span className="text-gray-600 tabular-nums">{i.weightKg ? num(i.weightKg) : "—"}</span>,
  },
  {
    key: "power",
    label: "Power (W)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    defaultWidth: 120,
    sortValue: (i) => i.powerW,
    render: (i) => <span className="text-gray-600 tabular-nums">{i.powerW ? num(i.powerW) : "—"}</span>,
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
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${active ? "bg-signal-soft" : "hover:bg-gray-50"}`}>
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
          className={`flex-1 text-left text-sm truncate ${active ? "text-signal-ink font-medium" : "text-gray-700"}`}
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
              className={`text-left text-sm ${!activeView ? "text-signal-ink font-medium" : "text-gray-500 hover:text-gray-700"}`}
            >
              Reset to default
            </button>
            {activeView?.isOwner && (
              <button onClick={updateActive} disabled={busy} className="text-left text-xs text-signal-ink hover:text-signal-ink-hover">
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
                    activeView?.id === v.id ? "bg-signal-soft text-signal-ink font-medium" : "hover:bg-gray-50 text-gray-700"
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

export default function ItemsList() {
  const navigate = useNavigate();
  const { can } = useRole();
  const [search, setSearch] = useState("");
  // The folder being looked at ("" is the top, Inventory), in the URL so
  // Back and links work like a file browser.
  const [params, setParams] = useSearchParams();
  const askedFolder = params.get("folder") ?? "";
  const openFolder = (id: string) => {
    setParams(id ? { folder: id } : {});
    setSelected(new Set());
  };
  const [movingItems, setMovingItems] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [typeFilter, setTypeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [unavailableOnly, setUnavailableOnly] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(loadVisibleColumns);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(loadActiveViewId);
  const [manageViewsOpen, setManageViewsOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();
  const folders = useMemo(() => indexFolders(categories), [categories]);
  // A link to a folder that's gone (or another organisation's) opens the top.
  const folder = folders.byId.has(askedFolder) ? askedFolder : "";

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

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ["items"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter(), sort: "name" }),
  });

  // "Stock" and "free now" for every item in one call: the availability
  // engine over the next minute.
  const { data: availability } = useQuery({
    queryKey: ["availability", "now"],
    queryFn: () => {
      const now = Date.now();
      return api.availability(new Date(now).toISOString(), new Date(now + 60_000).toISOString());
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo<Row[]>(
    () =>
      items.map((i) => ({
        ...i,
        categoryPath: paths.get(i.category) ?? "",
        stock: availability?.[i.id]?.stock ?? null,
        freeNow: availability?.[i.id]?.free ?? null,
      })),
    [items, paths, availability],
  );

  // Searching or filtering looks through this folder and everything in it;
  // otherwise it's like opening a folder: its subfolders, then the items
  // sitting directly in it.
  const searching = search.trim() !== "" || typeFilter !== "all" || unavailableOnly;
  const scope = useMemo(() => subtree(folders, folder), [folders, folder]);
  const subfolders = searching ? [] : (folders.children.get(folder) ?? []);

  // Items inside each folder at any depth (for the tree and folder rows).
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of rows) {
      if (!showArchived && r.archived) continue;
      out.set("", (out.get("") ?? 0) + 1);
      for (const f of trail(folders, folderOf(folders, r.category))) out.set(f.id, (out.get(f.id) ?? 0) + 1);
    }
    return out;
  }, [rows, folders, showArchived]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = rows.filter((i) => {
      if (!showArchived && i.archived) return false;
      const where = folderOf(folders, i.category);
      if (searching ? !scope.has(where) : where !== folder) return false;
      if (typeFilter !== "all" && TYPE_LABEL(i) !== typeFilter) return false;
      if (unavailableOnly && !(i.freeNow !== null && i.freeNow <= 0)) return false;
      if (
        term &&
        ![i.name, i.code, i.barcode, i.categoryPath, i.locationInWarehouse].some((v) => v.toLowerCase().includes(term))
      ) {
        return false;
      }
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
  }, [rows, search, folders, folder, scope, searching, typeFilter, showArchived, unavailableOnly, sortKey, sortDir]);

  async function moveSelected(target: string) {
    const ids = [...selected];
    try {
      for (const id of ids) await pb.collection("items").update(id, { category: target });
      showToast("success", `Moved ${ids.length} item${ids.length === 1 ? "" : "s"} to ${folders.byId.get(target)?.name ?? "Inventory"}`);
      setSelected(new Set());
      setMovingItems(false);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["items"] });
    }
  }

  // Archiving or restoring the selection. Items already that way are left alone.
  async function archiveSelected(archived: boolean) {
    const targets = selectedItems.filter((i) => i.archived !== archived);
    const what = `${targets.length} item${targets.length === 1 ? "" : "s"}`;
    if (archived) {
      const ok = await confirm({
        title: `Archive ${what}`,
        message: `Archive ${what}? They're hidden from lists and can't be added to projects. Anything already booked keeps them, and you can restore them any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    const failed = await updateEach("items", targets, () => ({ archived }));
    setBulkBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["items"] });
    if (failed.length === 0) {
      showToast("success", `${archived ? "Archived" : "Restored"} ${what}`);
      setSelected(new Set());
    } else {
      showToast("error", `${failed.length} of ${targets.length} couldn't be ${archived ? "archived" : "restored"}: ${errorText(failed[0].error)}`);
    }
  }

  // The server refuses items that have been on a project or scanned; those
  // are counted and left selected, to archive instead.
  async function deleteSelected() {
    const targets = selectedItems;
    const what = `${targets.length} item${targets.length === 1 ? "" : "s"}`;
    const ok = await confirm({
      title: `Delete ${what}`,
      message: `Delete ${what}, with their units and kit links? This can't be undone. Anything that's been on a project or scanned is skipped: archive those instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    const kept = new Set<string>();
    for (const item of targets) {
      try {
        await pb.collection("items").delete(item.id);
      } catch {
        kept.add(item.id);
      }
    }
    setBulkBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["items"] });
    setSelected(kept);
    const deleted = targets.length - kept.size;
    if (kept.size === 0) showToast("success", `Deleted ${what}`);
    else
      showToast(
        "error",
        `Deleted ${deleted}. ${kept.size} couldn't be deleted (they've been used on projects or scanned) and are still selected, so you can archive them.`,
      );
  }

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
    (typeFilter !== "all" ? 1 : 0) + (showArchived ? 1 : 0) + (unavailableOnly ? 1 : 0);

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

  const selectedItems = filtered.filter((i) => selected.has(String(i.id)));

  const folderActions = useFolderActions({ index: folders, items, onOpen: openFolder });
  const here = trail(folders, folder);
  const current = here[here.length - 1] ?? null;

  return (
    <div className="w-full h-full flex gap-4 min-h-0">
      <aside className="hidden lg:flex w-64 shrink-0 card p-2 flex-col min-h-0">
        <div className="overflow-y-auto min-h-0">
          <FolderTree index={folders} current={folder} onOpen={openFolder} counts={counts} actions={folderActions} />
        </div>
      </aside>

      <div className="flex-1 min-w-0 h-full flex flex-col gap-3 min-h-0">
        <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
          <div className="min-w-0">
            <nav className="flex items-center gap-1 text-xs text-gray-500 flex-wrap" aria-label="Folder">
              <button onClick={() => openFolder("")} className="hover:text-gray-900">
                Inventory
              </button>
              {here.map((f) => (
                <span key={f.id} className="flex items-center gap-1">
                  <span className="text-gray-300">›</span>
                  <button onClick={() => openFolder(f.id)} className="hover:text-gray-900">
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>
            <h1 className="text-lg font-semibold text-gray-900 truncate">{current ? current.name : "Inventory"}</h1>
            <p className="text-xs text-gray-500">
              {searching
                ? `${filtered.length.toLocaleString()} found${current ? ` in ${current.name}` : ""}`
                : [
                    subfolders.length > 0 && `${subfolders.length} folder${subfolders.length === 1 ? "" : "s"}`,
                    `${filtered.length.toLocaleString()} item${filtered.length === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <FolderActions actions={folderActions} current={folder} />
            {folderActions.dialogs}
            {can("items.create") && (
              <Link to={folder ? `/inventory/new?folder=${folder}` : "/inventory/new"} className="btn-primary">
                New item
              </Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={current ? `Search in ${current.name}…` : "Search name, code, barcode…"}
            className="input w-60"
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input w-auto">
            <option value="all">All types</option>
            <option value="Bulk">Bulk</option>
            <option value="Serialised">Serialised</option>
            <option value="Kit">Kits</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 px-1.5">
            <input type="checkbox" checked={unavailableOnly} onChange={(e) => setUnavailableOnly(e.target.checked)} />
            None free now
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 px-1.5">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setTypeFilter("all");
                setShowArchived(false);
                setUnavailableOnly(false);
              }}
              className="text-xs text-signal-ink hover:text-signal-ink-hover px-1.5"
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
        {error && <p className="text-red-600 text-sm shrink-0">Couldn't load inventory: {(error as Error).message}</p>}

        {selectedItems.length > 0 && (
          <div className="shrink-0 card px-4 py-2 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium text-gray-900 mr-1">{selectedItems.length} selected</span>
            {can("items.edit") && (
              <>
                <button onClick={() => setBulkEditing(true)} disabled={bulkBusy} className="btn-primary">
                  Edit
                </button>
                <button onClick={() => setMovingItems(true)} disabled={bulkBusy} className="btn-secondary">
                  Move
                </button>
              </>
            )}
            <BatchPrintBar<Row>
              bare
              items={selectedItems}
              getDisplayName={(i) => i.name}
              renderImage={(i, t) => renderItemLabelImage(i, i.categoryPath, t)}
              sendPrint={(image, t) => sendRenderedLabel(image, t)}
              onDone={() => setSelected(new Set())}
            />
            {can("items.edit") &&
              (selectedItems.some((i) => !i.archived) ? (
                <button onClick={() => archiveSelected(true)} disabled={bulkBusy} className="btn-secondary">
                  Archive
                </button>
              ) : (
                <button onClick={() => archiveSelected(false)} disabled={bulkBusy} className="btn-secondary">
                  Restore
                </button>
              ))}
            {can("items.delete") && (
              <button onClick={deleteSelected} disabled={bulkBusy} className="btn-secondary hover:text-fault-ink">
                Delete
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-900 ml-auto">
              Clear selection
            </button>
          </div>
        )}
        {bulkEditing && (
          <BulkEditModal
            items={selectedItems}
            onClose={() => setBulkEditing(false)}
            onDone={async (failed) => {
              setBulkEditing(false);
              await queryClient.invalidateQueries({ queryKey: ["items"] });
              if (failed === 0) showToast("success", `Updated ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`);
              else showToast("error", `${failed} of ${selectedItems.length} items couldn't be updated`);
            }}
          />
        )}
        {movingItems && (
          <FolderPicker
            title={`Move ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} to…`}
            index={folders}
            initial={folder}
            confirmLabel="Move here"
            onPick={moveSelected}
            onClose={() => setMovingItems(false)}
          />
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
                        className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-signal/30 active:bg-signal/50"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subfolders.map((f) => (
                  <tr key={f.id} onClick={() => openFolder(f.id)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-1.5" />
                    <td colSpan={columns.length} className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <FolderIcon className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">{f.name}</span>
                        <span className="font-mono text-[11px] text-gray-400">{counts.get(f.id) ?? 0}</span>
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/inventory/${item.id}`)}
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
          {!isLoading && filtered.length === 0 && subfolders.length === 0 && (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">
              {rows.length === 0 ? "No inventory yet — add items here, or import them in Settings > Import." : searching ? "No items match." : "This folder is empty."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
