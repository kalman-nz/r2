import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { ViewConfig } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import {
  daysUntil,
  dueBucket,
  dueLabel,
  formatDay,
  inDays,
  monthOf,
  unitName,
  useMaintenanceJobs,
  usePlans,
  type JobWithExpand,
} from "../../lib/maintenance";
import { readGroups, readSorts, readWidths, sortRows, sortSettings, type GroupOption, type Sort } from "../../lib/table";
import { asString, asStrings } from "../../lib/views";
import ColumnsMenu from "../ColumnsMenu";
import DataTable, { type TableColumn } from "../DataTable";
import FiltersMenu, { FilterField, GroupFields, SortList } from "../FiltersMenu";
import PageViews from "../PageViews";
import Segmented from "../Segmented";
import SelectionBar from "../SelectionBar";

type Ahead = "30" | "90" | "all";
type Column = TableColumn<JobWithExpand> & { toggleable: boolean; shown: boolean };

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);

const COLUMNS: Column[] = [
  {
    key: "due",
    label: "Due",
    toggleable: false,
    shown: true,
    width: 220,
    minWidth: 150,
    sortValue: (j) => j.dueOn,
    title: (j) => formatDay(j.dueOn),
    render: (j) => {
      const days = daysUntil(j.dueOn);
      return (
        <span className="tabular-nums">
          <span className={days < 0 ? "text-fault-ink font-medium" : days <= 7 ? "text-gray-900 font-medium" : "text-gray-700"}>{dueLabel(j.dueOn)}</span>
          <span className="text-gray-400"> · {formatDay(j.dueOn)}</span>
        </span>
      );
    },
  },
  {
    key: "work",
    label: "Work",
    toggleable: false,
    shown: true,
    width: 240,
    minWidth: 140,
    sortValue: (j) => j.name.toLowerCase(),
    title: (j) => j.name,
    render: (j) => <span className="font-medium text-gray-900">{j.name}</span>,
  },
  {
    key: "item",
    label: "Item",
    toggleable: true,
    shown: true,
    width: 220,
    minWidth: 120,
    flex: true,
    sortValue: (j) => j.expand?.item?.name.toLowerCase() ?? "￿",
    title: (j) => j.expand?.item?.name ?? "",
    render: (j) => (j.expand?.item ? <span className="text-gray-800">{j.expand.item.name}</span> : muted(j.item ? "(deleted item)" : "")),
  },
  {
    key: "unit",
    label: "Unit",
    toggleable: true,
    shown: true,
    width: 120,
    sortValue: (j) => unitName(j.expand?.serial) || "￿",
    render: (j) => (j.expand?.serial ? <span className="font-mono text-xs text-gray-700">{unitName(j.expand.serial)}</span> : muted("")),
  },
  {
    key: "serialNumber",
    label: "Serial number",
    toggleable: true,
    shown: false,
    width: 140,
    sortValue: (j) => j.expand?.serial?.serialNumber || "￿",
    render: (j) => muted(j.expand?.serial?.serialNumber ?? ""),
  },
  {
    key: "plan",
    label: "Plan",
    toggleable: true,
    // A plan's jobs take its name, so it'd mostly repeat Work.
    shown: false,
    width: 180,
    sortValue: (j) => j.expand?.plan?.name.toLowerCase() ?? "￿",
    title: (j) => j.expand?.plan?.name ?? "One-off",
    render: (j) => (j.expand?.plan ? <span className="text-gray-600">{j.expand.plan.name}</span> : <span className="text-gray-400">One-off</span>),
  },
  {
    key: "notes",
    label: "Notes",
    toggleable: true,
    shown: false,
    width: 220,
    sortValue: (j) => j.notes.toLowerCase() || "￿",
    title: (j) => j.notes,
    render: (j) => muted(j.notes.split("\n")[0]),
  },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);
const SORTABLE = COLUMNS.filter((c) => c.sortValue);
const DEFAULT_SORT: Sort = { key: "due", dir: "asc" };

const GROUPS: GroupOption<JobWithExpand>[] = [
  { key: "when", label: "When", value: (j) => dueBucket(j.dueOn) },
  { key: "month", label: "Month", value: (j) => monthOf(j.dueOn) },
  {
    key: "plan",
    label: "Plan",
    value: (j) => (j.expand?.plan ? { id: j.plan, label: j.expand.plan.name, order: j.expand.plan.name.toLowerCase() } : { id: "", label: "One-off", order: "￿" }),
  },
  { key: "item", label: "Item", value: (j) => ({ id: j.item, label: j.expand?.item?.name ?? "No item", order: j.expand?.item?.name.toLowerCase() ?? "￿" }) },
];
const GROUP_KEYS = GROUPS.map((g) => g.key);

const DEFAULT_VIEW: ViewConfig = {
  ahead: "30",
  plan: "",
  columns: COLUMNS.filter((c) => c.toggleable && c.shown).map((c) => c.key),
  widths: {},
  groupBy: ["when"],
  ...sortSettings([DEFAULT_SORT]),
};

// Scheduled maintenance, soonest first, grouped by what's overdue, due
// this week and later (or however the view groups it). Tick a batch to pass
// it in one go (an inspection day) or move its due date; fails are recorded
// one at a time from the job, with what's wrong.
export default function DueTab({
  canRecord,
  onPass,
  onReschedule,
  batchesDone,
}: {
  canRecord: boolean;
  // Goes up each time a batch is passed or moved, which clears the ticks.
  batchesDone: number;
  onPass: (jobs: JobWithExpand[]) => void;
  onReschedule: (jobs: JobWithExpand[]) => void;
}) {
  const navigate = useNavigate();
  const [ahead, setAhead] = useState<Ahead>("30");
  const [plan, setPlan] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([DEFAULT_SORT]);
  const [groupBy, setGroupBy] = useState<string[]>(["when"]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [batchesDone]);
  const { data: plans = [] } = usePlans();
  const filter = `status = 'scheduled'${ahead === "all" ? "" : ` && dueOn <= "${inDays(Number(ahead))}"`}`;
  const { data: jobs = [], isLoading, error } = useMaintenanceJobs(filter);
  // When nothing's due in the window: is anything scheduled at all, and when?
  const { data: soonest } = useQuery({
    queryKey: ["maintenance-jobs", "soonest"],
    queryFn: async () => {
      const page = await pb.collection("maintenance_jobs").getList<JobWithExpand>(1, 1, { filter: orgFilter("status = 'scheduled'"), sort: "dueOn", skipTotal: false });
      return { total: page.totalItems, next: page.items[0]?.dueOn ?? "" };
    },
    enabled: !isLoading && jobs.length === 0,
  });

  const settings: ViewConfig = { ahead, plan, columns: shown, widths, groupBy, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    const a = asString(s.ahead, "30");
    setAhead(a === "90" || a === "all" ? a : "30");
    setPlan(asString(s.plan));
    setShown(asStrings(s.columns, COLUMN_KEYS));
    setWidths(readWidths(s));
    setGroupBy(readGroups(s, GROUP_KEYS));
    setSorts(readSorts(s, SORTABLE.map((c) => c.key), DEFAULT_SORT));
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = jobs.filter((j) => {
      if (plan === "one-off" ? j.plan : plan && j.plan !== plan) return false;
      if (!term) return true;
      const unit = j.expand?.serial;
      return [j.name, j.expand?.item?.name, unit?.barcode, unit?.label, unit?.serialNumber, j.expand?.plan?.name, j.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
    return sortRows(out, COLUMNS, sorts);
  }, [jobs, plan, search, sorts]);

  const picked = rows.filter((j) => selected.has(j.id));
  const overdue = rows.filter((j) => daysUntil(j.dueOn) < 0).length;
  const activeFilters = (plan ? 1 : 0);
  const clear = () => setSelected(new Set());

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page="maintenance" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work, item, barcode…" className="input flex-1 min-w-40 max-w-72" />
        <Segmented
          label="How far ahead"
          value={ahead}
          onChange={setAhead}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "all", label: "Everything" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-gray-500 tabular-nums mr-1 hidden sm:inline">
            {rows.length.toLocaleString()} scheduled{overdue > 0 && <span className="text-fault-ink"> · {overdue} overdue</span>}
          </span>
          <FiltersMenu
            active={activeFilters}
            onReset={() => {
              setPlan("");
            }}
          >
            <FilterField label="Plan">
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input">
                <option value="">All work</option>
                <option value="one-off">One-off jobs</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <SortList columns={SORTABLE} sorts={sorts} onChange={setSorts} />
            <GroupFields options={GROUPS} groupBy={groupBy} onChange={setGroupBy} />
          </FiltersMenu>
          <ColumnsMenu columns={COLUMNS.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      {canRecord && picked.length > 0 && (
        <SelectionBar count={picked.length} onClear={clear}>
          <button onClick={() => onPass(picked)} className="btn-primary py-1">
            Mark passed
          </button>
          <button onClick={() => onReschedule(picked)} className="btn-secondary py-1">
            Move due date…
          </button>
        </SelectionBar>
      )}

      {error && <p className="text-red-600 text-sm">Couldn't load maintenance: {(error as Error).message}</p>}

      <DataTable
        columns={COLUMNS.filter((c) => !c.toggleable || shown.includes(c.key))}
        rows={rows}
        rowKey={(j) => j.id}
        onRowClick={(j) => navigate(`/maintenance/jobs/${j.id}`)}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groupBy.map((k) => GROUPS.find((g) => g.key === k)!).filter(Boolean)}
        widths={widths}
        onWidthsChange={setWidths}
        selected={canRecord ? selected : undefined}
        onSelectedChange={canRecord ? setSelected : undefined}
        empty={
          isLoading ? (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">Loading…</p>
          ) : (
            rows.length === 0 && (
              <p className="px-4 py-8 text-gray-500 text-sm text-center">
                {jobs.length > 0
                  ? "Nothing matches."
                  : soonest && soonest.total > 0
                    ? ahead === "all"
                      ? "Nothing scheduled."
                      : `Nothing due in the next ${ahead} days. The next is due ${formatDay(soonest.next)}.`
                    : "Nothing scheduled."}
              </p>
            )
          )
        }
      />
    </div>
  );
}
