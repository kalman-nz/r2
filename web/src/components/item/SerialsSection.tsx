import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { Item, Serial, SerialStatus } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { formatDate } from "../../lib/format";
import type { LabelUnit } from "../../lib/labelSpec";
import { sortRows, type GroupOption, type Sort } from "../../lib/table";
import { SERIAL_STATUS_LABELS } from "../../lib/statuses";
import DataTable, { type TableColumn } from "../DataTable";
import ColumnsMenu from "../ColumnsMenu";
import FiltersMenu, { FilterField, GroupFields, SortList } from "../FiltersMenu";
import UnitBulkBar from "./UnitBulkBar";
import { SerialStatusBadge } from "../StatusBadge";
import { useToast } from "../ToastProvider";
import { withOrg } from "../../lib/currentOrg";

// An item's units, laid out like the inventory list: search, filters,
// sorting, grouping (by storage location to start with) and columns, with
// tick boxes for doing things to several at once (UnitBulkBar).

interface Row extends Serial {
  locationName: string;
}

interface Column extends TableColumn<Row> {
  toggleable: boolean;
  defaultVisible: boolean;
}

const STATUS_ORDER: SerialStatus[] = ["active", "repair", "lost", "retired"];
const dash = <span className="text-gray-300">—</span>;

const COLUMNS: Column[] = [
  {
    key: "unit",
    label: "Unit",
    toggleable: false,
    defaultVisible: true,
    width: 220,
    minWidth: 140,
    flex: true,
    sortValue: (s) => s.barcode.toLowerCase(),
    title: (s) => [s.barcode, s.label].filter(Boolean).join(" · "),
    render: (s) => (
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="font-medium text-gray-900 font-mono shrink-0">{s.barcode || "(no barcode)"}</span>
        {s.label && <span className="text-gray-500 truncate">{s.label}</span>}
      </span>
    ),
  },
  {
    key: "location",
    label: "Location",
    toggleable: true,
    defaultVisible: true,
    width: 150,
    minWidth: 90,
    sortValue: (s) => s.locationName.toLowerCase() || "￿",
    render: (s) => (s.locationName ? <span className="text-gray-700 truncate">{s.locationName}</span> : <span className="text-gray-400">No location</span>),
  },
  {
    key: "bin",
    label: "Shelf / bin",
    toggleable: true,
    defaultVisible: true,
    width: 120,
    minWidth: 90,
    sortValue: (s) => s.bin.toLowerCase() || "￿",
    render: (s) => (s.bin ? <span className="text-gray-600 truncate">{s.bin}</span> : dash),
  },
  {
    key: "status",
    label: "Status",
    toggleable: true,
    defaultVisible: true,
    width: 110,
    minWidth: 90,
    sortValue: (s) => STATUS_ORDER.indexOf(s.status),
    render: (s) => <SerialStatusBadge status={s.status} />,
  },
  {
    key: "serialNumber",
    label: "Manufacturer serial",
    toggleable: true,
    defaultVisible: true,
    width: 150,
    minWidth: 100,
    sortValue: (s) => s.serialNumber.toLowerCase(),
    render: (s) => (s.serialNumber ? <span className="text-gray-600 font-mono text-xs truncate">{s.serialNumber}</span> : dash),
  },
  {
    key: "nextInspection",
    label: "Next test & tag",
    toggleable: true,
    defaultVisible: false,
    width: 140,
    sortValue: (s) => s.nextInspection || "￿",
    render: (s) => (s.nextInspection ? <span className="text-gray-600">{formatDate(s.nextInspection)}</span> : dash),
  },
  {
    key: "purchaseDate",
    label: "Purchased",
    toggleable: true,
    defaultVisible: false,
    width: 140,
    sortValue: (s) => s.purchaseDate || "￿",
    render: (s) => (s.purchaseDate ? <span className="text-gray-600">{formatDate(s.purchaseDate)}</span> : dash),
  },
];

const byText = (id: string, label: string, empty: string) =>
  id ? { id, label: label || empty, order: (label || empty).toLowerCase() } : { id: "", label: empty, order: "￿" };

const GROUPS: GroupOption<Row>[] = [
  { key: "location", label: "Location", value: (s) => byText(s.location, s.locationName, "No location") },
  { key: "bin", label: "Shelf / bin", value: (s) => byText(s.bin, s.bin, "No shelf or bin") },
  { key: "status", label: "Status", value: (s) => ({ id: s.status, label: SERIAL_STATUS_LABELS[s.status] ?? s.status, order: STATUS_ORDER.indexOf(s.status) }) },
];
const SORTABLE = COLUMNS.filter((c) => c.sortValue);

// The layout people pick (columns, grouping, sort) stays for next time, on
// this device. Never needed for the page to work.
const LAYOUT_KEY = "r2.units.layout";
interface Layout {
  columns: string[];
  groupBy: string[];
  sorts: Sort[];
  widths: Record<string, number>;
}
const DEFAULT_LAYOUT: Layout = {
  columns: COLUMNS.filter((c) => c.toggleable && c.defaultVisible).map((c) => c.key),
  groupBy: ["location"],
  sorts: [{ key: "unit", dir: "asc" }],
  widths: {},
};
function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_LAYOUT;
    return {
      columns: Array.isArray(saved.columns) ? saved.columns.filter((k: string) => COLUMNS.some((c) => c.key === k)) : DEFAULT_LAYOUT.columns,
      groupBy: Array.isArray(saved.groupBy) ? saved.groupBy.filter((k: string) => GROUPS.some((g) => g.key === k)) : DEFAULT_LAYOUT.groupBy,
      sorts: Array.isArray(saved.sorts) ? saved.sorts.filter((s: Sort) => SORTABLE.some((c) => c.key === s?.key)) : DEFAULT_LAYOUT.sorts,
      widths: saved.widths && typeof saved.widths === "object" ? saved.widths : {},
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export default function SerialsSection({ item, categoryPath, canAdd }: { item: Item; categoryPath: string; canAdd: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: locations = [] } = useLocations();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  // Where new units go; stays set for the next one.
  const [location, setLocation] = useState("");
  const [bin, setBin] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (patch: Partial<Layout>) =>
    setLayoutState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {
        // Fine without it.
      }
      return next;
    });
  const queryKey = ["serials", item.id];

  const { data: serials = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item.id }), sort: "barcode" }),
  });
  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const rows = useMemo<Row[]>(() => serials.map((s) => ({ ...s, bin: s.bin ?? "", locationName: locationName.get(s.location) ?? "" })), [serials, locationName]);
  const addTo = location || locations[0]?.id || "";

  function unitFor(serial: Serial): LabelUnit {
    return { serial, item, categoryPath, locationName: [locationName.get(serial.location), serial.bin].filter(Boolean).join(", "), currentJob: "" };
  }

  async function add() {
    const code = barcode.trim();
    setSaving(true);
    try {
      await pb.collection("serials").create(
        withOrg({
          item: item.id,
          barcode: code,
          serialNumber: serialNumber.trim(),
          label: label.trim(),
          status: "active",
          location: addTo,
          bin: bin.trim(),
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["serials"] }),
        queryClient.invalidateQueries({ queryKey: ["availability"] }),
      ]);
      // Ready for the next unit.
      setBarcode("");
      setSerialNumber("");
      setLabel("");
      showToast("success", "Unit added");
    } catch (err) {
      showToast("error", `Couldn't add the unit: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = rows.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (locationFilter && s.location !== locationFilter) return false;
      return !term || [s.barcode, s.label, s.serialNumber, s.locationName, s.bin].some((v) => v.toLowerCase().includes(term));
    });
    return sortRows(out, COLUMNS, layout.sorts);
  }, [rows, search, statusFilter, locationFilter, layout.sorts]);

  const selectedSerials = serials.filter((s) => selected.has(s.id));
  const active = serials.filter((s) => s.status === "active").length;
  const columns = COLUMNS.filter((c) => !c.toggleable || layout.columns.includes(c.key));
  const activeFilters = (statusFilter ? 1 : 0) + (locationFilter ? 1 : 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-500 mr-1">
          {active} active{serials.length !== active ? ` of ${serials.length}` : ""}
        </h2>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search units…" className="input flex-1 min-w-40 max-w-60" />
        <div className="ml-auto flex items-center gap-1.5">
          <FiltersMenu
            active={activeFilters}
            onReset={() => {
              setStatusFilter("");
              setLocationFilter("");
            }}
          >
            <FilterField label="Status">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input">
                <option value="">Any status</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {SERIAL_STATUS_LABELS[s]}
                  </option>
                ))}
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
            <SortList columns={SORTABLE} sorts={layout.sorts} onChange={(sorts) => setLayout({ sorts })} />
            <GroupFields options={GROUPS} groupBy={layout.groupBy} onChange={(groupBy) => setLayout({ groupBy })} />
          </FiltersMenu>
          <ColumnsMenu columns={COLUMNS.filter((c) => c.toggleable)} visible={layout.columns} onChange={(cols) => setLayout({ columns: cols })} />
          {canAdd && !adding && (
            <button onClick={() => setAdding(true)} className="btn-primary">
              Add unit
            </button>
          )}
        </div>
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="card p-3 flex items-end gap-2 flex-wrap"
        >
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Barcode / asset tag
            <input autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Blank = generate" className="input py-1.5 font-mono w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Manufacturer serial
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="input py-1.5 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Name (optional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="input py-1.5 w-32" placeholder="e.g. Desk 2" />
          </label>
          {locations.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Storage location
              <select value={addTo} onChange={(e) => setLocation(e.target.value)} className="input py-1.5 w-40">
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Shelf / bin
            <input value={bin} onChange={(e) => setBin(e.target.value)} className="input py-1.5 w-28" placeholder="e.g. Bay 3" />
          </label>
          <button type="submit" disabled={saving} className="btn-primary py-1.5">
            {saving ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-secondary py-1.5">
            Done
          </button>
        </form>
      )}

      {selectedSerials.length > 0 && (
        <UnitBulkBar
          item={item}
          units={selectedSerials}
          unitFor={unitFor}
          onClear={() => setSelected(new Set())}
          setSelected={setSelected}
          onChanged={() =>
            Promise.all([
              queryClient.invalidateQueries({ queryKey: ["serials"] }),
              queryClient.invalidateQueries({ queryKey: ["availability"] }),
              queryClient.invalidateQueries({ queryKey: ["repairs"] }),
              queryClient.invalidateQueries({ queryKey: ["maintenance-jobs"] }),
              queryClient.invalidateQueries({ queryKey: ["item"] }),
            ])
          }
        />
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        onRowClick={(s, e) => (e.metaKey || e.ctrlKey ? window.open(`/assets/${s.id}`, "_blank") : navigate(`/assets/${s.id}`))}
        sorts={layout.sorts}
        onSortsChange={(sorts) => setLayout({ sorts })}
        groups={layout.groupBy.map((k) => GROUPS.find((g) => g.key === k)!).filter(Boolean)}
        widths={layout.widths}
        onWidthsChange={(widths) => setLayout({ widths })}
        selected={selected}
        onSelectedChange={setSelected}
        empty={
          !isLoading &&
          filtered.length === 0 && (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">
              {serials.length === 0 ? "No units yet. Each unit gets its own barcode to scan." : "No units match."}
            </p>
          )
        }
      />
    </section>
  );
}
