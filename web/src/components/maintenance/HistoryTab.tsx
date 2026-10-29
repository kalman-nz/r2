import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ViewConfig } from "../../lib/api";
import { localDateInput, nzd } from "../../lib/format";
import { formatDay, monthOf, resultLabel, unitName, useMaintenanceJobs, usePlans, type JobWithExpand } from "../../lib/maintenance";
import { saveFile } from "../../lib/download";
import { readGroups, readSorts, readWidths, sortRows, sortSettings, type GroupOption, type Sort } from "../../lib/table";
import { asString, asStrings } from "../../lib/views";
import ColumnsMenu from "../ColumnsMenu";
import DataTable, { type TableColumn } from "../DataTable";
import FiltersMenu, { FilterField, GroupFields, SortList } from "../FiltersMenu";
import PageViews from "../PageViews";
import { ResultBadge } from "./ResultBadge";

type Since = "3" | "12" | "all";
type Result = "" | "pass" | "fail";
type Column = TableColumn<JobWithExpand> & { toggleable: boolean; shown: boolean };

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return localDateInput(d);
}

const cell = (v: unknown) => {
  const text = String(v ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);

const COLUMNS: Column[] = [
  {
    key: "done",
    label: "Done",
    toggleable: false,
    shown: true,
    width: 140,
    minWidth: 110,
    sortValue: (j) => j.doneOn,
    render: (j) => <span className="text-gray-700 tabular-nums">{formatDay(j.doneOn)}</span>,
  },
  {
    key: "work",
    label: "Work",
    toggleable: false,
    shown: true,
    width: 220,
    minWidth: 130,
    sortValue: (j) => j.name.toLowerCase(),
    title: (j) => j.name,
    render: (j) => <span className="font-medium text-gray-900">{j.name}</span>,
  },
  {
    key: "item",
    label: "Item",
    toggleable: true,
    shown: true,
    width: 200,
    minWidth: 110,
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
    key: "result",
    label: "Result",
    toggleable: false,
    shown: true,
    width: 130,
    sortValue: (j) => (j.result === "fail" ? 0 : 1),
    render: (j) => <ResultBadge job={j} />,
  },
  {
    key: "by",
    label: "By",
    toggleable: true,
    shown: true,
    width: 140,
    sortValue: (j) => j.doneBy.toLowerCase() || "￿",
    title: (j) => j.doneBy,
    render: (j) => muted(j.doneBy),
  },
  {
    key: "notes",
    label: "Notes",
    toggleable: true,
    shown: true,
    width: 220,
    sortValue: (j) => j.notes.toLowerCase() || "￿",
    title: (j) => j.notes,
    render: (j) => muted(j.notes.split("\n")[0]),
  },
  {
    key: "plan",
    label: "Plan",
    toggleable: true,
    shown: false,
    width: 170,
    sortValue: (j) => j.expand?.plan?.name.toLowerCase() ?? "￿",
    title: (j) => j.expand?.plan?.name ?? "One-off",
    render: (j) => (j.expand?.plan ? <span className="text-gray-600">{j.expand.plan.name}</span> : <span className="text-gray-400">One-off</span>),
  },
  {
    key: "cost",
    label: "Cost",
    toggleable: true,
    shown: true,
    align: "right",
    width: 100,
    sortValue: (j) => j.cost || 0,
    render: (j) => (j.cost ? <span className="text-gray-700 tabular-nums">{nzd(j.cost)}</span> : muted("")),
  },
  {
    key: "files",
    label: "Files",
    toggleable: true,
    shown: false,
    align: "right",
    width: 72,
    sortValue: (j) => j.files?.length ?? 0,
    render: (j) => (j.files?.length ? <span className="text-gray-600 tabular-nums">{j.files.length}</span> : muted("")),
  },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);
const SORTABLE = COLUMNS.filter((c) => c.sortValue);
const DEFAULT_SORT: Sort = { key: "done", dir: "desc" };

const GROUPS: GroupOption<JobWithExpand>[] = [
  // Newest month first.
  { key: "month", label: "Month", value: (j) => ({ ...monthOf(j.doneOn), order: -(Number(j.doneOn.slice(0, 4)) * 12 + Number(j.doneOn.slice(5, 7))) || 0 }) },
  { key: "result", label: "Result", value: (j) => (j.result === "fail" ? { id: "fail", label: "Failed", order: 0 } : { id: "pass", label: "Passed or done", order: 1 }) },
  { key: "item", label: "Item", value: (j) => ({ id: j.item, label: j.expand?.item?.name ?? "No item", order: j.expand?.item?.name.toLowerCase() ?? "￿" }) },
  {
    key: "plan",
    label: "Plan",
    value: (j) => (j.expand?.plan ? { id: j.plan, label: j.expand.plan.name, order: j.expand.plan.name.toLowerCase() } : { id: "", label: "One-off", order: "￿" }),
  },
  { key: "by", label: "Done by", value: (j) => ({ id: j.doneBy || "-", label: j.doneBy || "Not recorded", order: j.doneBy.toLowerCase() || "￿" }) },
];
const GROUP_KEYS = GROUPS.map((g) => g.key);

const DEFAULT_VIEW: ViewConfig = {
  since: "12",
  result: "",
  plan: "",
  columns: COLUMNS.filter((c) => c.toggleable && c.shown).map((c) => c.key),
  widths: {},
  groupBy: [],
  ...sortSettings([DEFAULT_SORT]),
};

// The register of what's been done, newest first: what passed and failed,
// who did it and when. Downloads as a spreadsheet for an auditor or a
// client's safety officer.
export default function HistoryTab() {
  const navigate = useNavigate();
  const [since, setSince] = useState<Since>("12");
  const [result, setResult] = useState<Result>("");
  const [plan, setPlan] = useState("");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([DEFAULT_SORT]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const { data: plans = [] } = usePlans();
  const filter = `status = 'done'${since === "all" ? "" : ` && doneOn >= "${monthsAgo(Number(since))}"`}`;
  const { data: jobs = [], isLoading, error } = useMaintenanceJobs(filter, "-doneOn,-updated");

  const settings: ViewConfig = { since, result, plan, columns: shown, widths, groupBy, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    const a = asString(s.since, "12");
    setSince(a === "3" || a === "all" ? a : "12");
    const r = asString(s.result);
    setResult(r === "pass" || r === "fail" ? r : "");
    setPlan(asString(s.plan));
    setShown(asStrings(s.columns, COLUMN_KEYS));
    setWidths(readWidths(s));
    setGroupBy(readGroups(s, GROUP_KEYS));
    setSorts(readSorts(s, SORTABLE.map((c) => c.key), DEFAULT_SORT));
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = jobs.filter((j) => {
      if (result && j.result !== result) return false;
      if (plan === "one-off" ? j.plan : plan && j.plan !== plan) return false;
      if (!term) return true;
      const unit = j.expand?.serial;
      return [j.name, j.expand?.item?.name, unit?.barcode, unit?.label, unit?.serialNumber, j.doneBy, j.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
    return sortRows(out, COLUMNS, sorts);
  }, [jobs, result, plan, search, sorts]);
  const failed = rows.filter((j) => j.result === "fail").length;

  function download(list: JobWithExpand[]) {
    const header = ["Done on", "Work", "Item", "Unit", "Barcode", "Serial number", "Result", "Done by", "Notes", "Cost", "Plan"];
    const lines = list.map((j) =>
      [
        j.doneOn,
        j.name,
        j.expand?.item?.name ?? "",
        j.expand?.serial?.label ?? "",
        j.expand?.serial?.barcode ?? "",
        j.expand?.serial?.serialNumber ?? "",
        resultLabel(j) + (j.failedQty ? ` (${j.failedQty})` : ""),
        j.doneBy,
        j.notes,
        j.cost || "",
        j.expand?.plan?.name ?? "",
      ]
        .map(cell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv" });
    saveFile({ blob, filename: `maintenance-${localDateInput(new Date())}.csv` });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page="maintenance-history" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work, item, barcode, who…" className="input flex-1 min-w-40 max-w-72" />
        <select value={since} onChange={(e) => setSince(e.target.value as Since)} className="input w-auto" aria-label="How far back">
          <option value="3">Last 3 months</option>
          <option value="12">Last 12 months</option>
          <option value="all">Everything</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-gray-500 tabular-nums mr-1 hidden sm:inline">
            {rows.length.toLocaleString()} done{failed > 0 && <span className="text-fault-ink"> · {failed} failed</span>}
          </span>
          <FiltersMenu
            active={(result ? 1 : 0) + (plan ? 1 : 0)}
            onReset={() => {
              setResult("");
              setPlan("");
            }}
          >
            <FilterField label="Result">
              <select value={result} onChange={(e) => setResult(e.target.value as Result)} className="input">
                <option value="">Passed and failed</option>
                <option value="pass">Passed or done</option>
                <option value="fail">Failed</option>
              </select>
            </FilterField>
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
          <button onClick={() => download(rows)} disabled={rows.length === 0} className="btn-secondary" title="What's shown, as a spreadsheet">
            Download CSV
          </button>
        </div>
      </div>

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
        empty={
          isLoading ? (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">Loading…</p>
          ) : (
            rows.length === 0 && <p className="px-4 py-8 text-gray-500 text-sm text-center">{jobs.length === 0 ? "Nothing recorded in this time." : "Nothing matches."}</p>
          )
        }
      />
    </div>
  );
}
