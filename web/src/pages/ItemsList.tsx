import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type ViewConfig } from "../lib/api";
import ColumnsMenu from "../components/ColumnsMenu";
import FiltersMenu, { FilterCheck, FilterField, SortList } from "../components/FiltersMenu";
import DataTable, { type TableColumn } from "../components/DataTable";
import { readSorts, sortRows, sortSettings, type Sort } from "../lib/table";
import PageViews from "../components/PageViews";
import { asBool, asString, asStrings } from "../lib/views";
import { money, num, PRICE_SUFFIX } from "../lib/format";
import { displayPath, useCategories, useCategoryPaths, useLocations } from "../lib/catalog";
import { placesText, useStockPlaces } from "../lib/stock";
import { useFeature, useRole } from "../lib/roles";
import BatchPrintBar from "../components/BatchPrintBar";
import SelectionBar from "../components/SelectionBar";
import { buildItemLabelContext } from "../lib/labelSpec";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { folderOf, indexFolders, subtree, trail } from "../lib/folders";
import FolderTree, { FolderIcon } from "../components/item/FolderTree";
import FolderActions, { useFolderActions } from "../components/item/FolderActions";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import BulkEditModal, { updateEach } from "../components/item/BulkEditModal";

// An item plus what the table needs that isn't on the record itself.
interface Row extends Item {
  categoryPath: string;
  stock: number | null;
  freeNow: number | null;
  // Where it's kept (lib/stock.ts), and the storage locations that holds.
  where: string;
  locationIds: string[];
}

interface Column extends TableColumn<Row> {
  toggleable: boolean;
  defaultVisible: boolean;
}

// How far each level of opened folders steps in, in px.
const FOLDER_STEP = 24;

const TYPE_LABEL = (i: Item) => (i.kind === "kit" ? "Kit" : i.tracking === "serial" ? "Serialised" : "Bulk");

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    toggleable: false,
    defaultVisible: true,
    width: 260,
    minWidth: 150,
    flex: true,
    sortValue: (i) => i.name.toLowerCase(),
    title: (i) => i.name,
    render: (i) => (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-gray-900 truncate">{i.name}</span>
        {i.archived && <span className="shrink-0 text-[11px] text-gray-400">Archived</span>}
      </span>
    ),
  },
  {
    key: "code",
    label: "Code",
    toggleable: true,
    defaultVisible: true,
    width: 110,
    minWidth: 64,
    sortValue: (i) => i.code.toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.code || "—"}</span>,
  },
  {
    key: "category",
    label: "Folder",
    toggleable: true,
    defaultVisible: true,
    width: 180,
    minWidth: 90,
    sortValue: (i) => i.categoryPath.toLowerCase(),
    title: (i) => displayPath(i.categoryPath),
    render: (i) => <span className="text-gray-600 truncate">{displayPath(i.categoryPath) || "—"}</span>,
  },
  {
    key: "type",
    label: "Item type",
    toggleable: true,
    defaultVisible: true,
    width: 100,
    minWidth: 84,
    sortValue: (i) => TYPE_LABEL(i),
    render: (i) => <span className="text-gray-600">{TYPE_LABEL(i)}</span>,
  },
  {
    key: "stock",
    label: "Stock",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    width: 80,
    minWidth: 56,
    sortValue: (i) => i.stock ?? -1,
    render: (i) => <span className="text-gray-700 tabular-nums">{i.stock === null ? "—" : num(i.stock)}</span>,
  },
  {
    key: "freeNow",
    label: "Free now",
    align: "right",
    toggleable: true,
    defaultVisible: true,
    width: 100,
    minWidth: 72,
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
    width: 130,
    minWidth: 80,
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
    width: 100,
    minWidth: 76,
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
    width: 130,
    minWidth: 72,
    sortValue: (i) => i.where.toLowerCase(),
    title: (i) => i.where,
    render: (i) => <span className="text-gray-600 truncate">{i.where || "—"}</span>,
  },
  {
    key: "barcode",
    label: "Barcode",
    toggleable: true,
    defaultVisible: false,
    width: 130,
    minWidth: 80,
    sortValue: (i) => i.barcode.toLowerCase(),
    render: (i) => <span className="text-gray-600 font-mono text-xs">{i.barcode || "—"}</span>,
  },
  {
    key: "replacementValue",
    label: "Replacement value",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    width: 150,
    minWidth: 90,
    sortValue: (i) => i.replacementValue,
    render: (i) => <span className="text-gray-600 tabular-nums">{money(i.replacementValue)}</span>,
  },
  {
    key: "weight",
    label: "Weight (kg)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    width: 120,
    minWidth: 72,
    sortValue: (i) => i.weightKg,
    render: (i) => <span className="text-gray-600 tabular-nums">{i.weightKg ? num(i.weightKg) : "—"}</span>,
  },
  {
    key: "power",
    label: "Power (W)",
    align: "right",
    toggleable: true,
    defaultVisible: false,
    width: 120,
    minWidth: 72,
    sortValue: (i) => i.powerW,
    render: (i) => <span className="text-gray-600 tabular-nums">{i.powerW ? num(i.powerW) : "—"}</span>,
  },
];

const TYPES = ["all", "Bulk", "Serialised", "Kit"];

const SORT_KEYS = COLUMNS.map((c) => c.key);

// The page as it comes, and what a saved view keeps (components/PageViews.tsx):
// the filters, and the columns with their widths and sort.
const DEFAULT_VIEW: ViewConfig = {
  type: "all",
  archived: false,
  unavailable: false,
  where: "",
  columns: COLUMNS.filter((c) => c.toggleable && c.defaultVisible).map((c) => c.key),
  widths: {},
  ...sortSettings([{ key: "name", dir: "asc" }]),
};

export default function ItemsList() {
  const navigate = useNavigate();
  const { can } = useRole();
  // Price columns only with prices and quotes. Without projects nothing's
  // booked, so what's free is what's in service (as on the item's page).
  const feature = useFeature();
  const projectsOn = feature("projects");
  const offered = (feature("pricing") ? COLUMNS : COLUMNS.filter((c) => c.key !== "dayRate" && c.key !== "replacementValue")).map((c) =>
    c.key === "freeNow" && !projectsOn ? { ...c, label: "In service" } : c,
  );
  const [search, setSearch] = useState("");
  // The folder being looked at ("" is the top, Inventory), in the URL so
  // Back and links work like a file browser.
  const [params, setParams] = useSearchParams();
  const askedFolder = params.get("folder") ?? "";
  const openFolder = (id: string) => {
    setParams(id ? { folder: id } : {});
    setSelected(new Set());
  };
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [typeFilter, setTypeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [unavailableOnly, setUnavailableOnly] = useState(false);
  // A storage location's id ("" for anywhere).
  const [locationFilter, setLocationFilter] = useState("");
  const { data: locations = [] } = useLocations();
  const places = useStockPlaces();
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(DEFAULT_VIEW.columns as string[]));
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([{ key: "name", dir: "asc" }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();
  const folders = useMemo(() => indexFolders(categories), [categories]);
  // A link to a folder that's gone (or another organisation's) opens the top.
  const folder = folders.byId.has(askedFolder) ? askedFolder : "";

  // What a saved view keeps, as the page is now.
  const settings: ViewConfig = {
    type: typeFilter,
    archived: showArchived,
    unavailable: unavailableOnly,
    // Older saved views kept a shelf name as `where`, which is ignored now.
    location: locationFilter,
    columns: COLUMNS.filter((c) => c.toggleable && visibleColumns.has(c.key)).map((c) => c.key),
    widths: columnWidths,
    ...sortSettings(sorts),
  };

  function applySettings(s: ViewConfig) {
    const type = asString(s.type, "all");
    setTypeFilter(TYPES.includes(type) ? type : "all");
    setShowArchived(asBool(s.archived));
    setUnavailableOnly(asBool(s.unavailable));
    setLocationFilter(asString(s.location));
    setVisibleColumns(new Set(asStrings(s.columns, COLUMNS.map((c) => c.key))));
    const widths: Record<string, number> = {};
    if (s.widths && typeof s.widths === "object") {
      for (const [k, v] of Object.entries(s.widths)) if (typeof v === "number" && v > 0) widths[k] = v;
    }
    setColumnWidths(widths);
    setSorts(readSorts(s, SORT_KEYS, { key: "name", dir: "asc" }));
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

  const rows = useMemo<Row[]>(() => {
    const name = new Map(locations.map((l) => [l.id, l.name]));
    return items.map((i) => {
      const here = (places.get(i.id) ?? []).filter((p) => p.qty > 0);
      return {
        ...i,
        categoryPath: paths.get(i.category) ?? "",
        stock: availability?.[i.id]?.stock ?? null,
        freeNow: availability?.[i.id]?.free ?? null,
        where: placesText(here, (id) => name.get(id) ?? ""),
        locationIds: [...new Set(here.map((p) => p.location).filter(Boolean))],
      };
    });
  }, [items, paths, availability, places, locations]);

  // Searching or filtering looks through this folder and everything in it;
  // otherwise it's like opening a folder: its subfolders, then the items
  // sitting directly in it.
  const searching = search.trim() !== "" || typeFilter !== "all" || unavailableOnly || locationFilter !== "";
  const scope = useMemo(() => subtree(folders, folder), [folders, folder]);
  const subfolders = searching ? [] : (folders.children.get(folder) ?? []);
  // Folders opened in place in the list (the arrow on a folder row), so
  // their contents show indented under them without leaving this folder.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Folders whose items show: this one, and any opened in place under it.
  const shown = useMemo(() => {
    const out = new Set([folder]);
    const stack = [folder];
    while (stack.length > 0) {
      for (const child of folders.children.get(stack.pop()!) ?? []) {
        if (expanded.has(child.id)) {
          out.add(child.id);
          stack.push(child.id);
        }
      }
    }
    return out;
  }, [folders, folder, expanded]);

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
      if (searching ? !scope.has(where) : !shown.has(where)) return false;
      if (typeFilter !== "all" && TYPE_LABEL(i) !== typeFilter) return false;
      if (unavailableOnly && !(i.freeNow !== null && i.freeNow <= 0)) return false;
      if (locationFilter && !i.locationIds.includes(locationFilter)) return false;
      if (
        term &&
        ![i.name, i.code, i.barcode, i.categoryPath, i.where].some((v) => v.toLowerCase().includes(term))
      ) {
        return false;
      }
      return true;
    });

    result = sortRows(result, COLUMNS, sorts);
    return result;
  }, [rows, search, folders, scope, shown, searching, typeFilter, showArchived, unavailableOnly, locationFilter, sorts]);

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

  const columns = offered.filter((c) => !c.toggleable || visibleColumns.has(c.key));

  // The filters behind the Filters button (Type has its own place).
  const activeFilterCount = (showArchived ? 1 : 0) + (unavailableOnly ? 1 : 0) + (locationFilter ? 1 : 0) + (typeFilter !== "all" ? 1 : 0);

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
          <PageViews page="inventory" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={current ? `Search in ${current.name}…` : "Search name, code, barcode…"}
            className="input flex-1 min-w-40 max-w-60"
          />
          <div className="ml-auto flex items-center gap-1.5">
            <FiltersMenu
              active={activeFilterCount}
              onReset={() => {
                setShowArchived(false);
                setUnavailableOnly(false);
                setLocationFilter("");
                setTypeFilter("all");
              }}
            >
              <FilterField label="Type">
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input">
                  <option value="all">All item types</option>
                  <option value="Bulk">Bulk</option>
                  <option value="Serialised">Serialised</option>
                  <option value="Kit">Kits</option>
                </select>
              </FilterField>
              {locations.length > 1 && (
                <FilterField label="Storage location">
                  <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="input">
                    <option value="">Anywhere</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </FilterField>
              )}
              <FilterCheck checked={unavailableOnly} onChange={setUnavailableOnly}>
                {projectsOn ? "Only items with none free now" : "Only items with none in service"}
              </FilterCheck>
              <FilterCheck checked={showArchived} onChange={setShowArchived}>
                Show archived items
              </FilterCheck>
              <SortList columns={offered} sorts={sorts} onChange={setSorts} />
            </FiltersMenu>
            <ColumnsMenu
              columns={offered.filter((c) => c.toggleable)}
              visible={settings.columns as string[]}
              onChange={(keys) => setVisibleColumns(new Set(keys))}
            />
          </div>
        </div>

        {isLoading && <p className="text-gray-500 text-sm shrink-0">Loading…</p>}
        {error && <p className="text-red-600 text-sm shrink-0">Couldn't load inventory: {(error as Error).message}</p>}

        {selectedItems.length > 0 && (
          <SelectionBar count={selectedItems.length} onClear={() => setSelected(new Set())}>
            {can("items.edit") && (
              <button onClick={() => setBulkEditing(true)} disabled={bulkBusy} className="btn-primary">
                Edit
              </button>
            )}
            <BatchPrintBar<Row>
              items={selectedItems}
              getDisplayName={(i) => i.name}
              getContext={(i) => buildItemLabelContext(i, i.categoryPath)}
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
            </SelectionBar>
        )}
        {bulkEditing && (
          <BulkEditModal
            items={selectedItems}
            folders={folders}
            initialFolder={folder}
            onClose={() => setBulkEditing(false)}
            onDone={async (failed) => {
              setBulkEditing(false);
              await queryClient.invalidateQueries({ queryKey: ["items"] });
              if (failed === 0) showToast("success", `Updated ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`);
              else showToast("error", `${failed} of ${selectedItems.length} items couldn't be updated`);
            }}
          />
        )}

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(i) => String(i.id)}
          onRowClick={(i) => navigate(`/inventory/${i.id}`)}
          sorts={sorts}
          onSortsChange={setSorts}
          widths={columnWidths}
          onWidthsChange={setColumnWidths}
          selected={selected}
          onSelectedChange={setSelected}
          body={(renderRow, span) => {
            if (searching) return filtered.map((r) => renderRow(r));
            const byFolder = new Map<string, Row[]>();
            for (const r of filtered) {
              const where = folderOf(folders, r.category);
              byFolder.set(where, [...(byFolder.get(where) ?? []), r]);
            }
            // A folder's subfolders (each opened in place if expanded), then its items.
            const level = (parent: string, depth: number): ReactNode[] => [
              ...(folders.children.get(parent) ?? []).flatMap((f) => {
                const open = expanded.has(f.id);
                return [
                  <tr key={`folder-${f.id}`} onClick={() => openFolder(f.id)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-1.5" />
                    <td colSpan={span - 1} className="py-1.5 pr-3" style={{ paddingLeft: 6 + depth * FOLDER_STEP }}>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(f.id);
                          }}
                          aria-expanded={open}
                          aria-label={`${open ? "Collapse" : "Expand"} ${f.name}`}
                          className="p-1.5 -my-1 rounded hover:bg-gray-200/70"
                        >
                          <svg
                            viewBox="0 0 20 20"
                            className={`w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8 5l5 5-5 5" />
                          </svg>
                        </button>
                        <FolderIcon className="w-4 h-4 text-gray-400" />
                        <span className="ml-1 font-medium text-gray-900">{f.name}</span>
                        <span className="ml-1 font-mono text-[11px] text-gray-400">{counts.get(f.id) ?? 0}</span>
                      </span>
                    </td>
                  </tr>,
                  ...(open ? level(f.id, depth + 1) : []),
                ];
              }),
              // Items in an opened folder (tick box and all) line up under its icon.
              ...(byFolder.get(parent) ?? []).map((r) => renderRow(r, depth === 0 ? undefined : 10 + depth * FOLDER_STEP)),
            ];
            return level(folder, 0);
          }}
          empty={
            !isLoading &&
            filtered.length === 0 &&
            subfolders.length === 0 && (
              <p className="px-4 py-6 text-gray-500 text-sm text-center">
                {rows.length === 0 ? "No inventory yet — add items here, or import them in Settings > Import." : searching ? "No items match." : "This folder is empty."}
              </p>
            )
          }
        />
      </div>
    </div>
  );
}
