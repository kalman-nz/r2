import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ViewConfig } from "../../lib/api";
import { formatDate, nzd, parseDate } from "../../lib/format";
import { unitName, useRepairStatuses, useRepairs, type RepairWithItem } from "../../lib/maintenance";
import { useFeature } from "../../lib/roles";
import { readGroups, readSorts, readWidths, sortRows, sortSettings, type GroupOption, type Sort } from "../../lib/table";
import { asString, asStrings } from "../../lib/views";
import ColumnsMenu from "../ColumnsMenu";
import DataTable, { type TableColumn } from "../DataTable";
import FiltersMenu, { FilterField, GroupFields, SortList } from "../FiltersMenu";
import PageViews from "../PageViews";
import { RepairStatusBadge } from "../StatusBadge";

type Column = TableColumn<RepairWithItem> & { toggleable: boolean; shown: boolean; needsProjects?: boolean };

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);
const time = (iso: string) => parseDate(iso)?.getTime() ?? Infinity;

// "3 units: H-0003, H-0007…" or "× 4" for bulk kit.
function unitsText(r: RepairWithItem): string {
  if (r.serials.length === 0) return `× ${r.quantity}`;
  const names = (r.expand?.serials ?? []).map(unitName);
  if (names.length === 0) return `${r.serials.length} unit${r.serials.length === 1 ? "" : "s"}`;
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

const DEFAULT_SORT: Sort = { key: "number", dir: "desc" };

// What's broken: everything out of service for repair first (or one
// status, or everything), in a list like Inventory's. Open repairs past
// their expected-back date are flagged.
export default function RepairsTab() {
  const navigate = useNavigate();
  const feature = useFeature();
  const projectsOn = feature("projects");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [assignee, setAssignee] = useState("");
  const { data: repairs = [], isLoading, error } = useRepairs();
  const { statuses, isOpen, byId, name: statusName } = useRepairStatuses();
  const now = Date.now();
  const overdue = (r: RepairWithItem) => isOpen(r.status) && time(r.dueAt) < now;

  const columns = useMemo<Column[]>(
    () => [
      {
        key: "number",
        label: "#",
        toggleable: false,
        shown: true,
        width: 72,
        minWidth: 56,
        sortValue: (r) => r.number,
        render: (r) => <span className="font-mono text-xs text-gray-500">R{r.number}</span>,
      },
      {
        key: "item",
        label: "Item",
        toggleable: false,
        shown: true,
        width: 220,
        minWidth: 130,
        sortValue: (r) => r.expand?.item?.name.toLowerCase() ?? "￿",
        title: (r) => r.expand?.item?.name ?? "",
        render: (r) => <span className="font-medium text-gray-900">{r.expand?.item?.name ?? "(deleted item)"}</span>,
      },
      {
        key: "units",
        label: "Units",
        toggleable: true,
        shown: true,
        width: 150,
        sortValue: (r) => (r.serials.length > 0 ? r.serials.length : r.quantity),
        title: (r) => (r.expand?.serials ?? []).map(unitName).join(", "),
        render: (r) => <span className={r.serials.length > 0 ? "font-mono text-xs text-gray-700" : "text-gray-600 tabular-nums"}>{unitsText(r)}</span>,
      },
      {
        key: "fault",
        label: "Fault",
        toggleable: true,
        shown: true,
        width: 280,
        minWidth: 120,
        flex: true,
        sortValue: (r) => r.fault.toLowerCase(),
        title: (r) => r.fault,
        render: (r) => <span className="text-gray-700">{r.fault.split("\n")[0]}</span>,
      },
      {
        key: "repairer",
        label: "Assigned to",
        toggleable: true,
        shown: true,
        width: 150,
        sortValue: (r) => r.repairer.toLowerCase() || "￿",
        title: (r) => r.repairer,
        render: (r) => muted(r.repairer),
      },
      {
        key: "project",
        label: "From project",
        toggleable: true,
        shown: false,
        needsProjects: true,
        width: 180,
        sortValue: (r) => r.expand?.job?.number ?? Infinity,
        title: (r) => (r.expand?.job ? `#${r.expand.job.number} ${r.expand.job.name}` : ""),
        render: (r) =>
          r.expand?.job ? (
            <span className="text-gray-600">
              <span className="text-gray-400 tabular-nums">#{r.expand.job.number}</span> {r.expand.job.name}
            </span>
          ) : (
            muted("")
          ),
      },
      {
        key: "opened",
        label: "Opened",
        toggleable: true,
        shown: true,
        width: 135,
        sortValue: (r) => r.created,
        render: (r) => <span className="text-gray-600 tabular-nums">{formatDate(r.created)}</span>,
      },
      {
        key: "due",
        label: "Expected back",
        toggleable: true,
        shown: true,
        width: 140,
        sortValue: (r) => time(r.dueAt),
        title: (r) => (overdue(r) ? "Overdue" : ""),
        render: (r) =>
          r.dueAt ? <span className={`tabular-nums ${overdue(r) ? "text-fault-ink font-medium" : "text-gray-600"}`}>{formatDate(r.dueAt)}</span> : muted(""),
      },
      {
        key: "closed",
        label: "Closed",
        toggleable: true,
        shown: false,
        width: 135,
        sortValue: (r) => r.closedAt || "￿",
        render: (r) => (r.closedAt ? <span className="text-gray-600 tabular-nums">{formatDate(r.closedAt)}</span> : muted("")),
      },
      {
        key: "cost",
        label: "Cost",
        toggleable: true,
        shown: true,
        align: "right",
        width: 100,
        sortValue: (r) => r.cost || 0,
        render: (r) => (r.cost ? <span className="text-gray-700 tabular-nums">{nzd(r.cost)}</span> : muted("")),
      },
      {
        key: "files",
        label: "Files",
        toggleable: true,
        shown: false,
        align: "right",
        width: 72,
        sortValue: (r) => r.files?.length ?? 0,
        render: (r) => (r.files?.length ? <span className="text-gray-600 tabular-nums">{r.files.length}</span> : muted("")),
      },
      {
        key: "status",
        label: "Status",
        toggleable: false,
        shown: true,
        width: 140,
        sortValue: (r) => statuses.findIndex((s) => s.id === r.status),
        render: (r) => <RepairStatusBadge status={r.status} />,
      },
    ],
    // overdue only reads isOpen and the time, so isOpen covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, isOpen],
  );
  const available = columns.filter((c) => !c.needsProjects || projectsOn);
  const columnKeys = columns.map((c) => c.key);
  const sortable = available.filter((c) => c.sortValue);

  const groups = useMemo<GroupOption<RepairWithItem>[]>(
    () =>
      [
        {
          key: "status",
          label: "Status",
          value: (r: RepairWithItem) => ({ id: r.status, label: statusName(r.status) || "No status", order: statuses.findIndex((s) => s.id === r.status) }),
        },
        { key: "item", label: "Item", value: (r: RepairWithItem) => ({ id: r.item, label: r.expand?.item?.name ?? "(deleted item)", order: r.expand?.item?.name.toLowerCase() ?? "￿" }) },
        { key: "repairer", label: "Assigned to", value: (r: RepairWithItem) => ({ id: r.repairer || "-", label: r.repairer || "Not assigned", order: r.repairer.toLowerCase() || "￿" }) },
        ...(projectsOn
          ? [
              {
                key: "project",
                label: "From project",
                value: (r: RepairWithItem) =>
                  r.expand?.job ? { id: r.job, label: `#${r.expand.job.number} ${r.expand.job.name}`, order: -r.expand.job.number } : { id: "", label: "No project", order: Infinity },
              },
            ]
          : []),
      ] as GroupOption<RepairWithItem>[],
    [statuses, statusName, projectsOn],
  );
  const groupKeys = groups.map((g) => g.key);

  const defaults = useMemo<ViewConfig>(
    () => ({
      show: "all",
      assignee: "",
      columns: columns.filter((c) => c.toggleable && c.shown).map((c) => c.key),
      widths: {},
      groupBy: [],
      ...sortSettings([DEFAULT_SORT]),
    }),
    [columns],
  );
  const [shown, setShown] = useState<string[]>(() => defaults.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([DEFAULT_SORT]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const settings: ViewConfig = { show: filter, assignee, columns: shown, widths, groupBy, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    setFilter(asString(s.show, "all") || "all");
    setAssignee(asString(s.assignee));
    setShown(asStrings(s.columns, columnKeys));
    setWidths(readWidths(s));
    setGroupBy(readGroups(s, groupKeys));
    setSorts(readSorts(s, sortable.map((c) => c.key), DEFAULT_SORT));
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, all: repairs.length };
    for (const r of repairs) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (isOpen(r.status)) c.open++;
    }
    return c;
  }, [repairs, isOpen]);
  const assignees = useMemo(() => [...new Set(repairs.map((r) => r.repairer).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [repairs]);
  // A view's status that's since been deleted shows everything.
  const show = filter === "open" || filter === "all" || byId.has(filter) || statuses.length === 0 ? filter : "all";

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    const out = repairs.filter((r) => {
      if (show === "open" ? !isOpen(r.status) : show !== "all" && r.status !== show) return false;
      if (assignee && (assignee === "-" ? r.repairer : r.repairer !== assignee)) return false;
      if (!term) return true;
      const job = r.expand?.job;
      return [
        `r${r.number}`,
        String(r.number),
        r.expand?.item?.name ?? "",
        r.fault,
        r.repairer,
        r.notes,
        job ? `${job.number} ${job.name}` : "",
        ...(r.expand?.serials ?? []).flatMap((u) => [u.barcode, u.label, u.serialNumber]),
      ].some((v) => (v ?? "").toLowerCase().includes(term));
    });
    return sortRows(out, available, sorts);
  }, [repairs, search, show, assignee, isOpen, available, sorts]);
  const late = rows.filter(overdue).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page="repairs" settings={settings} defaults={defaults} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, item, unit, fault, who…" className="input flex-1 min-w-40 max-w-80" />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-gray-500 tabular-nums mr-1 hidden sm:inline">
            {rows.length.toLocaleString()} shown{late > 0 && <span className="text-fault-ink"> · {late} late back</span>}
          </span>
          <FiltersMenu
            active={(show !== "all" ? 1 : 0) + (assignee ? 1 : 0)}
            onReset={() => {
              setFilter("all");
              setAssignee("");
            }}
          >
            <FilterField label="Status">
              <select value={show} onChange={(e) => setFilter(e.target.value)} className="input">
                <option value="all">All repairs ({counts.all})</option>
                <option value="open">Out of service ({counts.open})</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({counts[s.id] ?? 0})
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Assigned to">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input">
                <option value="">Anyone</option>
                <option value="-">Not assigned</option>
                {assignees.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FilterField>
            <SortList columns={sortable} sorts={sorts} onChange={setSorts} />
            <GroupFields options={groups} groupBy={groupBy} onChange={setGroupBy} />
          </FiltersMenu>
          <ColumnsMenu columns={available.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">Couldn't load repairs: {(error as Error).message}</p>}

      <DataTable
        columns={available.filter((c) => !c.toggleable || shown.includes(c.key))}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/maintenance/repairs/${r.id}`)}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groupBy.map((k) => groups.find((g) => g.key === k)!).filter(Boolean)}
        widths={widths}
        onWidthsChange={setWidths}
        empty={
          isLoading ? (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">Loading…</p>
          ) : (
            rows.length === 0 && (
              <p className="px-4 py-8 text-gray-500 text-sm text-center">
                {repairs.length === 0 ? "No repairs yet." : show === "open" && !search && !assignee ? "Nothing's out for repair." : "No repairs match."}
              </p>
            )
          )
        }
      />
    </div>
  );
}
