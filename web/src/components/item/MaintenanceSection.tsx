import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Serial } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDate, nzd } from "../../lib/format";
import {
  dayPassed,
  daysUntil,
  describePlan,
  dueLabel,
  formatDay,
  invalidateMaintenance,
  resultLabel,
  unitName,
  useMaintenanceJobs,
  usePlans,
  useRepairStatuses,
  useRepairs,
  type JobWithExpand,
  type RepairWithItem,
} from "../../lib/maintenance";
import { useFeature, useRole } from "../../lib/roles";
import { sortRows, type Sort } from "../../lib/table";
import DataTable, { type TableColumn } from "../DataTable";
import { RepairStatusBadge, SerialStatusBadge } from "../StatusBadge";
import { ResultBadge } from "../maintenance/ResultBadge";
import NewJobModal from "../maintenance/NewJobModal";
import PassModal from "../maintenance/PassModal";
import { useToast } from "../ToastProvider";

// What's been done to it, newest first: maintenance and closed repairs together.
type Past = { at: string; job: JobWithExpand; repair: null } | { at: string; job: null; repair: RepairWithItem };

// Each unit's maintenance at a glance, for serialised kit.
interface UnitRow extends Serial {
  next?: JobWithExpand;
  last?: JobWithExpand;
  repair?: RepairWithItem;
}

const HISTORY_PAGE = 15;

// An item's maintenance tab: how it stands (what's next, what was last done,
// repairs and what it's all cost), each unit's state for serialised kit,
// what's due (tick and pass them here), open repairs, the plans it's on, and
// everything that's been done. Only what the organisation uses (Settings →
// Features).
export default function MaintenanceSection({ item, canRecord }: { item: Item; canRecord: boolean }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { can } = useRole();
  const feature = useFeature();
  const maintenanceOn = feature("maintenance");
  const repairsOn = feature("repairs");
  const serialised = item.tracking === "serial";
  const [scheduling, setScheduling] = useState<string[] | null>(null);
  const [passing, setPassing] = useState<JobWithExpand[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  const [unitSorts, setUnitSorts] = useState<Sort[]>([{ key: "next", dir: "asc" }]);
  const [unitWidths, setUnitWidths] = useState<Record<string, number>>({});

  const { data: plans = [] } = usePlans();
  const { data: jobs = [], isLoading: jobsLoading } = useMaintenanceJobs(`item = "${item.id}"`, "dueOn", maintenanceOn);
  const { data: repairs = [], isLoading: repairsLoading } = useRepairs(`item = "${item.id}"`, repairsOn);
  const { isOpen } = useRepairStatuses();
  const { data: units = [] } = useQuery({
    queryKey: ["serials", item.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item.id }), sort: "barcode" }),
    enabled: serialised && maintenanceOn,
  });

  const covering = plans.filter((p) => p.items.includes(item.id));
  const others = plans.filter((p) => !p.items.includes(item.id));
  const scheduled = useMemo(() => jobs.filter((j) => j.status === "scheduled"), [jobs]);
  const done = useMemo(() => jobs.filter((j) => j.status === "done").sort((a, b) => b.doneOn.localeCompare(a.doneOn)), [jobs]);
  // The same work due the same day (a plan's on every unit) is one row.
  const dueGroups = useMemo(() => {
    const byKey = new Map<string, JobWithExpand[]>();
    for (const j of scheduled) {
      const key = `${j.plan || j.name}|${j.dueOn}`;
      byKey.set(key, [...(byKey.get(key) ?? []), j]);
    }
    return [...byKey].map(([key, list]) => ({ key, jobs: list }));
  }, [scheduled]);
  const openRepairs = repairs.filter((r) => isOpen(r.status));
  const overdue = scheduled.filter((j) => daysUntil(j.dueOn) < 0);
  const spent = repairs.reduce((sum, r) => sum + (r.cost || 0), 0) + done.reduce((sum, j) => sum + (j.cost || 0), 0);

  const past = useMemo<Past[]>(
    () =>
      [
        ...done.map((j) => ({ at: j.doneOn, job: j, repair: null }) as Past),
        ...repairs.filter((r) => !isOpen(r.status)).map((r) => ({ at: (r.closedAt || r.created).slice(0, 10), job: null, repair: r }) as Past),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [done, repairs, isOpen],
  );

  // Each unit's next due, last done and open repair.
  const unitRows = useMemo<UnitRow[]>(() => {
    const next = new Map<string, JobWithExpand>();
    for (const j of scheduled) if (j.serial && (!next.has(j.serial) || j.dueOn < next.get(j.serial)!.dueOn)) next.set(j.serial, j);
    const last = new Map<string, JobWithExpand>();
    for (const j of done) if (j.serial && !last.has(j.serial)) last.set(j.serial, j);
    const repair = new Map<string, RepairWithItem>();
    for (const r of repairs) if (isOpen(r.status)) for (const s of r.serials) if (!repair.has(s)) repair.set(s, r);
    return units.map((u) => ({ ...u, next: next.get(u.id), last: last.get(u.id), repair: repair.get(u.id) }));
  }, [units, scheduled, done, repairs, isOpen]);
  const sortedUnits = useMemo(() => sortRows(unitRows, UNIT_COLUMNS, unitSorts), [unitRows, unitSorts]);

  async function addToPlan(planId: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    try {
      await api.updatePlan(plan.id, { items: [...plan.items, item.id] });
      await invalidateMaintenance(queryClient);
      showToast("success", `Added to ${plan.name}`);
    } catch (err) {
      showToast("error", `Couldn't add it: ${errorText(err)}`);
    }
  }

  const picked = scheduled.filter((j) => selected.has(j.id));

  if ((maintenanceOn && jobsLoading) || (repairsOn && repairsLoading)) return <p className="text-gray-500 text-sm">Loading…</p>;

  const nextDue = scheduled[0];
  const lastDone = done[0];

  return (
    <div className="flex flex-col gap-4">
      {/* How it stands, in one line of facts. */}
      <section className="card px-4 py-3 flex items-start gap-x-8 gap-y-3 flex-wrap text-sm">
        {maintenanceOn && (
          <Fact label="Next due">
            {nextDue ? (
              <Link to={`/maintenance/jobs/${nextDue.id}`} className="hover:underline">
                <span className={daysUntil(nextDue.dueOn) < 0 ? "text-fault-ink font-medium" : "text-gray-900"}>{dueLabel(nextDue.dueOn)}</span>
                <span className="text-gray-500"> · {nextDue.name}</span>
                {overdue.length > 1 && <span className="text-fault-ink"> · {overdue.length} overdue</span>}
              </Link>
            ) : (
              <span className="text-gray-400">Nothing scheduled</span>
            )}
          </Fact>
        )}
        {maintenanceOn && (
          <Fact label="Last done">
            {lastDone ? (
              <Link to={`/maintenance/jobs/${lastDone.id}`} className="hover:underline">
                <span className="text-gray-900">{formatDay(lastDone.doneOn)}</span>
                <span className={lastDone.result === "fail" ? "text-fault-ink" : "text-gray-500"}>
                  {" "}
                  · {lastDone.name} {resultLabel(lastDone).toLowerCase()}
                </span>
              </Link>
            ) : (
              <span className="text-gray-400">Never</span>
            )}
          </Fact>
        )}
        {repairsOn && (
          <Fact label="Repairs">
            {repairs.length === 0 ? (
              <span className="text-gray-400">Never repaired</span>
            ) : (
              <span className="text-gray-900">
                {openRepairs.length > 0 ? <span className="text-amber-700 font-medium">{openRepairs.length} open</span> : "None open"}
                <span className="text-gray-500"> · {repairs.length} in all</span>
              </span>
            )}
          </Fact>
        )}
        <Fact label="Spent">
          {spent > 0 ? <span className="text-gray-900 tabular-nums">{nzd(spent)}</span> : <span className="text-gray-400">Nothing recorded</span>}
        </Fact>
        {maintenanceOn && canRecord && (
          <button onClick={() => setScheduling([])} className="btn-secondary ml-auto self-center">
            Schedule job
          </button>
        )}
      </section>

      {maintenanceOn && (
        <Section
          title="Due"
          count={scheduled.length}
          action={
            canRecord &&
            picked.length > 0 && (
              <span className="flex items-center gap-2">
                <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-900">
                  Clear
                </button>
                <button onClick={() => setPassing(picked)} className="btn-primary py-1">
                  Mark {picked.length} passed
                </button>
              </span>
            )
          }
        >
          {scheduled.length === 0 ? (
            <Empty>
              Nothing scheduled.
            </Empty>
          ) : (
            <Rows>
              {dueGroups.map((g) => (
                <DueGroup
                  key={g.key}
                  jobs={g.jobs}
                  selected={canRecord ? selected : null}
                  onToggle={(ids, on) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const id of ids) {
                        if (on) next.add(id);
                        else next.delete(id);
                      }
                      return next;
                    })
                  }
                />
              ))}
            </Rows>
          )}
        </Section>
      )}

      {repairsOn && openRepairs.length > 0 && (
        <Section title="Open repairs" count={openRepairs.length}>
          <Rows>
            {openRepairs.map((r) => {
              const late = dayPassed(r.dueAt);
              return (
                <Row key={r.id} to={`/maintenance/repairs/${r.id}`}>
                  <span className="font-mono text-xs text-gray-400 w-12 shrink-0">R{r.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-gray-900 truncate">{r.fault}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {repairUnits(r)}
                      {r.repairer && ` · ${r.repairer}`} · opened {formatDate(r.created)}
                      {r.dueAt && <span className={late ? "text-fault-ink" : ""}> · back {formatDate(r.dueAt)}</span>}
                    </span>
                  </span>
                  <RepairStatusBadge status={r.status} />
                </Row>
              );
            })}
          </Rows>
        </Section>
      )}

      {maintenanceOn && serialised && unitRows.length > 0 && (
        <Section title="Units" count={unitRows.length}>
          <div className="max-h-[28rem] flex flex-col border-t border-gray-100 [&>.card]:rounded-none [&>.card]:border-0 [&>.card]:shadow-none">
            <DataTable
              columns={UNIT_COLUMNS}
              rows={sortedUnits}
              rowKey={(u) => u.id}
              onRowClick={(u, e) => (e.metaKey || e.ctrlKey ? window.open(`/assets/${u.id}`, "_blank") : navigate(`/assets/${u.id}`))}
              sorts={unitSorts}
              onSortsChange={setUnitSorts}
              widths={unitWidths}
              onWidthsChange={setUnitWidths}
            />
          </div>
        </Section>
      )}

      {maintenanceOn && (
        <Section
          title="Plans"
          action={
            can("maintenance.plans") &&
            others.length > 0 && (
              <select value="" onChange={(e) => e.target.value && addToPlan(e.target.value)} className="input w-auto max-w-[60%] min-w-0 py-1 text-xs" aria-label="Add to a plan">
                <option value="">Add to a plan…</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({describePlan(p).toLowerCase()})
                  </option>
                ))}
              </select>
            )
          }
        >
          {covering.length === 0 ? (
            <Empty>
              Not on any plan.
            </Empty>
          ) : (
            <Rows>
              {covering.map((p) => {
                const mine = scheduled.filter((j) => j.plan === p.id);
                const late = mine.filter((j) => daysUntil(j.dueOn) < 0).length;
                return (
                  <Row key={p.id} to={`/maintenance/plans/${p.id}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-gray-900 truncate">{p.name}</span>
                      <span className="block text-xs text-gray-500">{describePlan(p)}</span>
                    </span>
                    <span className="text-xs text-right shrink-0">
                      {mine.length === 0 ? (
                        <span className="text-gray-400">Nothing scheduled</span>
                      ) : late > 0 ? (
                        <span className="text-fault-ink font-medium">{late} overdue</span>
                      ) : (
                        <span className="text-gray-600">Next {dueLabel(mine[0].dueOn).toLowerCase()}</span>
                      )}
                      {serialised && mine.length > 0 && <span className="block text-gray-400">{mine.length} scheduled</span>}
                    </span>
                  </Row>
                );
              })}
            </Rows>
          )}
        </Section>
      )}

      <Section title="History" count={past.length}>
        {past.length === 0 ? (
          <Empty>{maintenanceOn && repairsOn ? "No maintenance or repairs recorded yet." : maintenanceOn ? "No maintenance recorded yet." : "No repairs closed yet."}</Empty>
        ) : (
          <>
            <Rows>
              {past.slice(0, historyShown).map((p) =>
                p.job ? (
                  <Row key={p.job.id} to={`/maintenance/jobs/${p.job.id}`}>
                    <span className="w-20 sm:w-28 shrink-0 text-xs text-gray-500 tabular-nums">{formatDay(p.job.doneOn)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-gray-900 truncate">{p.job.name}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {[p.job.expand?.serial && unitName(p.job.expand.serial), p.job.doneBy, p.job.cost > 0 && nzd(p.job.cost), p.job.notes.split("\n")[0]]
                          .filter(Boolean)
                          .join(" · ") || " "}
                      </span>
                    </span>
                    <ResultBadge job={p.job} />
                  </Row>
                ) : (
                  <Row key={p.repair.id} to={`/maintenance/repairs/${p.repair.id}`}>
                    <span className="w-20 sm:w-28 shrink-0 text-xs text-gray-500 tabular-nums">{formatDay(p.at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-gray-900 truncate">
                        <span className="font-mono text-xs text-gray-400 mr-1.5">R{p.repair.number}</span>
                        {p.repair.fault}
                      </span>
                      <span className="block text-xs text-gray-500 truncate">
                        {["Repair", repairUnits(p.repair), p.repair.repairer, p.repair.cost > 0 && nzd(p.repair.cost)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <RepairStatusBadge status={p.repair.status} />
                  </Row>
                ),
              )}
            </Rows>
            {past.length > historyShown && (
              <button onClick={() => setHistoryShown((n) => n + 50)} className="w-full px-4 py-2 text-xs text-signal-ink hover:text-signal-ink-hover border-t border-gray-100 text-left">
                Show more ({(past.length - historyShown).toLocaleString()} older)
              </button>
            )}
          </>
        )}
      </Section>

      {scheduling && (
        <NewJobModal
          item={item}
          serials={scheduling}
          onClose={() => setScheduling(null)}
          onCreated={async (made) => {
            setScheduling(null);
            await invalidateMaintenance(queryClient);
            showToast("success", made.length === 1 ? "Scheduled" : `Scheduled ${made.length} jobs`);
          }}
        />
      )}
      {passing && (
        <PassModal
          jobs={passing}
          onClose={() => setPassing(null)}
          onDone={async () => {
            setPassing(null);
            setSelected(new Set());
            await invalidateMaintenance(queryClient);
          }}
        />
      )}
    </div>
  );
}

// "H-0003, H-0007" or "× 4".
function repairUnits(r: RepairWithItem): string {
  if (r.serials.length === 0) return `× ${r.quantity}`;
  const names = (r.expand?.serials ?? []).map(unitName);
  if (names.length === 0) return `${r.serials.length} unit${r.serials.length === 1 ? "" : "s"}`;
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

const UNIT_COLUMNS: TableColumn<UnitRow>[] = [
  {
    key: "unit",
    label: "Unit",
    width: 140,
    minWidth: 100,
    sortValue: (u) => unitName(u),
    title: (u) => [u.label, u.barcode, u.serialNumber].filter(Boolean).join(" · "),
    render: (u) => <span className="font-mono text-xs text-gray-900">{unitName(u)}</span>,
  },
  { key: "status", label: "Status", width: 110, sortValue: (u) => u.status, render: (u) => <SerialStatusBadge status={u.status} /> },
  {
    key: "next",
    label: "Next due",
    width: 260,
    minWidth: 140,
    flex: true,
    sortValue: (u) => u.next?.dueOn ?? "￿",
    title: (u) => (u.next ? `${u.next.name}, ${formatDay(u.next.dueOn)}` : ""),
    render: (u) =>
      u.next ? (
        <span>
          <span className={daysUntil(u.next.dueOn) < 0 ? "text-fault-ink font-medium" : "text-gray-800"}>{dueLabel(u.next.dueOn)}</span>
          <span className="text-gray-400"> · {u.next.name}</span>
        </span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
  },
  {
    key: "last",
    label: "Last done",
    width: 240,
    minWidth: 130,
    sortValue: (u) => u.last?.doneOn ?? "",
    title: (u) => (u.last ? `${u.last.name}, ${formatDay(u.last.doneOn)}` : ""),
    render: (u) =>
      u.last ? (
        <span>
          <span className="text-gray-700 tabular-nums">{formatDay(u.last.doneOn)}</span>
          <span className={u.last.result === "fail" ? "text-fault-ink" : "text-gray-400"}> · {resultLabel(u.last)}</span>
        </span>
      ) : (
        <span className="text-gray-300">Never</span>
      ),
  },
  {
    key: "repair",
    label: "Open repair",
    width: 200,
    sortValue: (u) => u.repair?.number ?? Infinity,
    title: (u) => u.repair?.fault ?? "",
    render: (u) =>
      u.repair ? (
        <span className="text-amber-700">
          <span className="font-mono text-xs">R{u.repair.number}</span> {u.repair.fault.split("\n")[0]}
        </span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
  },
];

// One piece of work due on one day: a link to the job when it's one unit,
// else a row that opens to show each unit. Tick it to pass them all.
function DueGroup({ jobs, selected, onToggle }: { jobs: JobWithExpand[]; selected: Set<string> | null; onToggle: (ids: string[], on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const first = jobs[0];
  const ids = jobs.map((j) => j.id);
  const ticked = selected ? ids.filter((id) => selected.has(id)).length : 0;
  const box = selected && (
    <input
      type="checkbox"
      checked={ticked > 0 && ticked === ids.length}
      ref={(el) => {
        if (el) el.indeterminate = ticked > 0 && ticked < ids.length;
      }}
      onChange={() => onToggle(ids, ticked !== ids.length)}
      aria-label={`Select ${first.name}`}
    />
  );
  const units = jobs.map((j) => j.expand?.serial).filter((u): u is Serial => !!u);
  const what = [jobs.length === 1 ? unitName(first.expand?.serial) : units.length > 0 ? `${jobs.length} units` : `${jobs.length} jobs`, !first.plan && "One-off"]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <span className="w-28 sm:w-44 shrink-0">
        <ResultBadge job={first} />
        <span className="block text-xs text-gray-400 tabular-nums mt-0.5">{formatDay(first.dueOn)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-gray-900 truncate">{first.name}</span>
        <span className="block text-xs text-gray-500 truncate">{what || "\u00a0"}</span>
      </span>
    </>
  );
  if (jobs.length === 1) {
    return (
      <Row to={`/maintenance/jobs/${first.id}`} before={box}>
        {body}
      </Row>
    );
  }
  return (
    <>
      <div className="flex items-stretch hover:bg-gray-50">
        {box && <label className="flex items-center pl-4 pr-1 cursor-pointer">{box}</label>}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex-1 min-w-0 flex items-center gap-3 pr-4 py-2 text-left ${box ? "pl-2" : "pl-4"}`}>
          {body}
          <span className="text-xs text-gray-500 shrink-0 flex items-center gap-1">
            <span className="hidden sm:inline">{open ? "Hide units" : "Show units"}</span>
            <svg viewBox="0 0 20 20" className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 5l5 5-5 5" />
            </svg>
          </span>
        </button>
      </div>
      {open && (
        <div className="bg-gray-50/60 divide-y divide-gray-100 border-t border-gray-100 max-h-80 overflow-y-auto">
          {jobs.map((j) => (
            <div key={j.id} className="flex items-stretch hover:bg-gray-50 text-[13px]">
              {selected && (
                <label className="flex items-center pl-8 pr-1 cursor-pointer">
                  <input type="checkbox" checked={selected.has(j.id)} onChange={() => onToggle([j.id], !selected.has(j.id))} aria-label={`Select ${unitName(j.expand?.serial)}`} />
                </label>
              )}
              <Link to={`/maintenance/jobs/${j.id}`} className={`flex-1 min-w-0 flex items-center gap-3 pr-4 py-1.5 ${selected ? "pl-2" : "pl-8"}`}>
                <span className="font-mono text-xs text-gray-800 w-40 shrink-0 truncate">{unitName(j.expand?.serial) || "—"}</span>
                <span className="text-xs text-gray-500 truncate">{[j.expand?.serial?.serialNumber, j.notes.split("\n")[0]].filter(Boolean).join(" · ")}</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="eyebrow text-gray-500">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden text-sm">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 min-h-[2.75rem]">
        <h2 className="eyebrow text-gray-500">
          {title}
          {count !== undefined && count > 0 && <span className="ml-1.5 font-mono text-gray-400">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-gray-100 border-t border-gray-100">{children}</div>;
}

// A row that opens `to`; `before` (a tick box) sits beside the link, not in it.
function Row({ to, before, children }: { to: string; before?: ReactNode; children: ReactNode }) {
  if (!before) {
    return (
      <Link to={to} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50">
        {children}
      </Link>
    );
  }
  return (
    <div className="flex items-stretch hover:bg-gray-50">
      <label className="flex items-center pl-4 pr-1 cursor-pointer">{before}</label>
      <Link to={to} className="flex-1 min-w-0 flex items-center gap-3 pl-2 pr-4 py-2">
        {children}
      </Link>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-4 text-xs text-gray-500">{children}</p>;
}
