import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { MaintenancePlan } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import { describePlan, dueLabel, formatDay, today, usePlans } from "../../lib/maintenance";
import { sortRows, type Sort } from "../../lib/table";
import DataTable, { type TableColumn } from "../DataTable";

type Row = MaintenancePlan & { count: number; overdue: number; next: string };

const INTERVAL_DAYS = { day: 1, week: 7, month: 30.4, year: 365 };

const COLUMNS: TableColumn<Row>[] = [
  {
    key: "name",
    label: "Plan",
    width: 240,
    minWidth: 140,
    flex: true,
    sortValue: (p) => p.name.toLowerCase(),
    title: (p) => p.name,
    render: (p) => <span className="font-medium text-gray-900">{p.name}</span>,
  },
  {
    key: "every",
    label: "Repeats",
    width: 230,
    sortValue: (p) => p.every * INTERVAL_DAYS[p.unit],
    title: (p) => describePlan(p),
    render: (p) => <span className="text-gray-700">{describePlan(p)}</span>,
  },
  {
    key: "items",
    label: "Items",
    align: "right",
    width: 80,
    sortValue: (p) => p.items.length,
    render: (p) => <span className="text-gray-700 tabular-nums">{p.items.length}</span>,
  },
  {
    key: "count",
    label: "Scheduled",
    align: "right",
    width: 100,
    sortValue: (p) => p.count,
    render: (p) => <span className="text-gray-700 tabular-nums">{p.count || <span className="text-gray-300">—</span>}</span>,
  },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    width: 90,
    sortValue: (p) => p.overdue,
    render: (p) => (p.overdue > 0 ? <span className="text-fault-ink font-medium tabular-nums">{p.overdue}</span> : <span className="text-gray-300">—</span>),
  },
  {
    key: "next",
    label: "Next due",
    width: 220,
    sortValue: (p) => p.next || "￿",
    title: (p) => (p.next ? formatDay(p.next) : ""),
    render: (p) =>
      p.next ? (
        <span className="tabular-nums">
          <span className={p.next < today() ? "text-fault-ink" : "text-gray-800"}>{dueLabel(p.next)}</span>
          <span className="text-gray-400"> · {formatDay(p.next)}</span>
        </span>
      ) : (
        <span className="text-gray-400">{p.items.length === 0 ? "Nothing covered yet" : "Nothing scheduled"}</span>
      ),
  },
];

// Repeating maintenance: each plan with how often it comes round, what it
// covers, and how its scheduled work stands.
export default function PlansTab({ canManage, onNew }: { canManage: boolean; onNew: () => void }) {
  const navigate = useNavigate();
  const [sorts, setSorts] = useState<Sort[]>([{ key: "name", dir: "asc" }]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const { data: plans = [], isLoading } = usePlans();
  const { data: scheduled = [] } = useQuery({
    queryKey: ["maintenance-jobs", "plan-due"],
    queryFn: () =>
      pb.collection("maintenance_jobs").getFullList<{ plan: string; dueOn: string }>({ filter: orgFilter("status = 'scheduled' && plan != ''"), fields: "plan,dueOn" }),
  });
  const rows = useMemo(() => {
    const now = today();
    const stats = new Map<string, { count: number; overdue: number; next: string }>();
    for (const j of scheduled) {
      const s = stats.get(j.plan) ?? { count: 0, overdue: 0, next: "" };
      s.count++;
      if (j.dueOn < now) s.overdue++;
      if (!s.next || j.dueOn < s.next) s.next = j.dueOn;
      stats.set(j.plan, s);
    }
    return sortRows(
      plans.map((p) => ({ ...p, ...(stats.get(p.id) ?? { count: 0, overdue: 0, next: "" }) })),
      COLUMNS,
      sorts,
    );
  }, [plans, scheduled, sorts]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;

  if (plans.length === 0) {
    return (
      <div className="card px-6 py-8 flex flex-col items-center gap-3 text-center text-sm text-gray-600">
        <p>No plans yet.</p>
        {canManage && (
          <button onClick={onNew} className="btn-primary">
            New plan
          </button>
        )}
      </div>
    );
  }

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(p) => p.id}
      onRowClick={(p) => navigate(`/maintenance/plans/${p.id}`)}
      sorts={sorts}
      onSortsChange={setSorts}
      widths={widths}
      onWidthsChange={setWidths}
    />
  );
}
