import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Contact, Job, Venue } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { formatDateTime, formatDuration, formatTime, localDateInput, parseDate } from "../lib/format";
import {
  assetLabel,
  daysUntil,
  dueLabel,
  inDays,
  invalidateMaintenance,
  today,
  useMaintenanceJobs,
  useRepairs,
} from "../lib/maintenance";
import { useOrg } from "../lib/org";
import { useRole } from "../lib/roles";
import { OPEN_REPAIRS_FILTER } from "../lib/statuses";
import { JobStatusBadge, RepairStatusBadge } from "../components/StatusBadge";
import NewRepairModal from "../components/repair/NewRepairModal";

type ProjectRow = Job & { expand?: { client?: Contact; venue?: Venue } };

// How many rows the side panels show before "View all".
const PANEL_ROWS = 6;

// The local calendar day of a stored datetime ("2026-10-22"), "" if none.
function dayOf(value: string): string {
  const d = parseDate(value);
  return d ? localDateInput(d) : "";
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// "Starts today", "Starts in 3 days", "Started 2 days ago"
function startsLabel(day: string): string {
  const n = daysUntil(day);
  if (n === 0) return "Starts today";
  if (n === 1) return "Starts tomorrow";
  if (n > 1) return `Starts in ${n} days`;
  return n === -1 ? "Started yesterday" : `Started ${-n} days ago`;
}

// Rows bucketed by calendar day, in the order given: past days fold into
// one "late" group at the top, then Today, Tomorrow, and each day after.
function byDay(rows: ProjectRow[], at: (j: ProjectRow) => string, lateTitle: string) {
  const now = today();
  const groups: { key: string; title: string; late: boolean; rows: ProjectRow[] }[] = [];
  for (const job of rows) {
    const day = dayOf(at(job));
    const late = day < now;
    const key = late ? "late" : day;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const n = daysUntil(day);
      const title = late
        ? lateTitle
        : n === 0
          ? "Today"
          : n === 1
            ? "Tomorrow"
            : (parseDate(at(job))?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) ?? day);
      group = { key, title, late, rows: [] };
      groups.push(group);
    }
    group.rows.push(job);
  }
  return groups;
}

// The day's work at a glance: what's going out and coming back this week,
// what needs confirming, and what's due or broken in the warehouse.
export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { org } = useOrg();
  const { record, can } = useRole();
  const [reporting, setReporting] = useState(false);
  const canScanOut = can("scan.out");
  const canScanIn = can("scan.in");

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["jobs", "dashboard"],
    queryFn: () =>
      pb.collection("jobs").getFullList<ProjectRow>({
        sort: "prepAt",
        expand: "client,venue",
        filter: orgFilter("status != 'returned' && status != 'cancelled'"),
      }),
  });
  const { data: maintenance = [], isLoading: maintenanceLoading } = useMaintenanceJobs(`status = 'scheduled' && dueOn <= "${inDays(7)}"`);
  const { data: repairs = [], isLoading: repairsLoading } = useRepairs(OPEN_REPAIRS_FILTER);

  const now = Date.now();
  const todayDay = today();
  const weekEnd = inDays(7);
  const time = (v: string) => parseDate(v)?.getTime() ?? Infinity;

  // Confirmed and not yet out. Enquiries and provisionals wait in "Needs
  // confirming" instead.
  const goingOut = jobs.filter((j) => j.status === "confirmed" && dayOf(j.prepAt) !== "" && dayOf(j.prepAt) <= weekEnd);
  const goingOutToday = goingOut.filter((j) => dayOf(j.prepAt) <= todayDay);
  const lateOut = goingOut.filter((j) => dayOf(j.prepAt) < todayDay);

  const out = jobs.filter((j) => j.status === "out");
  const comingBack = out.filter((j) => dayOf(j.returnAt) !== "" && dayOf(j.returnAt) <= weekEnd).sort((a, b) => time(a.returnAt) - time(b.returnAt));
  const overdueBack = out.filter((j) => time(j.returnAt) < now);
  const backToday = out.filter((j) => dayOf(j.returnAt) === todayDay && time(j.returnAt) >= now);

  const toConfirm = jobs.filter((j) => (j.status === "enquiry" || j.status === "provisional") && dayOf(j.prepAt) !== "" && dayOf(j.prepAt) <= inDays(14));

  const maintenanceOverdue = maintenance.filter((m) => m.dueOn < todayDay);
  const repairsOverdue = repairs.filter((r) => time(r.dueAt) < now);

  const firstName = String(record?.name ?? "").trim().split(/\s+/)[0];
  const loading = isLoading ? "—" : undefined;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {greeting()}
            {firstName && `, ${firstName}`}
          </h1>
          <p className="text-xs text-gray-500">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {org && ` · ${org.name}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {can("units.flag") && (
            <button onClick={() => setReporting(true)} className="btn-secondary">
              Report repair
            </button>
          )}
          {(canScanOut || canScanIn) && (
            <Link to="/scan" className="btn-secondary">
              Check in & out
            </Link>
          )}
          {can("jobs.create") && (
            <Link to="/projects/new" className="btn-primary">
              New project
            </Link>
          )}
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">Couldn't load projects: {(error as Error).message}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat
          label="Going out today"
          value={loading ?? goingOutToday.length}
          hint={lateOut.length > 0 ? `${lateOut.length} late` : `${goingOut.length} this week`}
          alert={lateOut.length > 0}
        />
        <Stat label="Due back today" value={loading ?? backToday.length} hint={`${comingBack.length} this week`} />
        <Stat label="Overdue back" value={loading ?? overdueBack.length} hint={overdueBack.length > 0 ? "Chase these up" : "All on time"} alert={overdueBack.length > 0} />
        <Stat label="Out on hire" value={loading ?? out.length} hint="Projects out now" to="/projects?view=out" />
        <Stat
          label="Maintenance overdue"
          value={maintenanceLoading ? "—" : maintenanceOverdue.length}
          hint={`${maintenance.length - maintenanceOverdue.length} due this week`}
          alert={maintenanceOverdue.length > 0}
          to="/maintenance"
        />
        <Stat
          label="Open repairs"
          value={repairsLoading ? "—" : repairs.length}
          hint={repairsOverdue.length > 0 ? `${repairsOverdue.length} past expected back` : "Out of service"}
          alert={repairsOverdue.length > 0}
          to="/maintenance?tab=repairs"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5 items-start">
        <div className="lg:col-span-3 flex flex-col gap-4">
          <Panel
            title="Going out"
            sub="Confirmed, next 7 days"
            count={goingOut.length}
            action={{ to: "/projects?view=confirmed", label: "All confirmed" }}
            empty={isLoading ? "Loading…" : "Nothing confirmed to go out this week."}
          >
            {byDay(goingOut, (j) => j.prepAt, "Late, should be out").map((g) => (
              <DayGroup key={g.key} title={g.title} late={g.late} count={g.rows.length}>
                {g.rows.map((j) => (
                  <ProjectLine
                    key={j.id}
                    job={j}
                    when={g.late ? formatDateTime(j.prepAt) : formatTime(j.prepAt)}
                    late={time(j.prepAt) < now}
                    scan={canScanOut ? "Scan out" : undefined}
                    onOpen={() => navigate(`/projects/${j.id}`)}
                  />
                ))}
              </DayGroup>
            ))}
          </Panel>

          <Panel
            title="Coming back"
            sub="Out on hire, due back in the next 7 days"
            count={comingBack.length}
            action={{ to: "/projects?view=out", label: "All out on hire" }}
            empty={isLoading ? "Loading…" : "Nothing due back this week."}
          >
            {byDay(comingBack, (j) => j.returnAt, "Overdue").map((g) => (
              <DayGroup key={g.key} title={g.title} late={g.late} count={g.rows.length}>
                {g.rows.map((j) => {
                  const late = time(j.returnAt) < now;
                  return (
                    <ProjectLine
                      key={j.id}
                      job={j}
                      when={late ? `${formatDuration(now - time(j.returnAt))} late` : formatTime(j.returnAt)}
                      late={late}
                      scan={canScanIn ? "Scan in" : undefined}
                      onOpen={() => navigate(`/projects/${j.id}`)}
                    />
                  );
                })}
              </DayGroup>
            ))}
          </Panel>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <Panel
            title="Needs confirming"
            sub="Enquiries and provisionals starting within 14 days"
            count={toConfirm.length}
            empty={isLoading ? "Loading…" : "Nothing waiting on a decision."}
          >
            {toConfirm.slice(0, PANEL_ROWS).map((j) => {
              const day = dayOf(j.prepAt);
              return (
                <Row key={j.id} onOpen={() => navigate(`/projects/${j.id}`)}>
                  <div className="min-w-0 flex-1">
                    <ProjectName job={j} />
                    <div className={`text-xs ${day < todayDay ? "text-fault-ink font-medium" : "text-gray-500"}`}>
                      {startsLabel(day)} · {formatDateTime(j.prepAt)}
                    </div>
                  </div>
                  <JobStatusBadge status={j.status} />
                </Row>
              );
            })}
            <More shown={PANEL_ROWS} total={toConfirm.length} to="/projects" />
          </Panel>

          <Panel
            title="Maintenance due"
            sub="Overdue and next 7 days"
            count={maintenance.length}
            action={{ to: "/maintenance", label: "View all" }}
            empty={maintenanceLoading ? "Loading…" : "No maintenance due this week."}
          >
            {maintenance.slice(0, PANEL_ROWS).map((m) => (
              <Row key={m.id} onOpen={() => navigate(`/maintenance/jobs/${m.id}`)}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 truncate">{m.name}</div>
                  <div className="text-xs text-gray-500 truncate">{assetLabel(m)}</div>
                </div>
                <span className={`text-xs whitespace-nowrap ${m.dueOn < todayDay ? "text-fault-ink font-medium" : "text-gray-600"}`}>{dueLabel(m.dueOn)}</span>
              </Row>
            ))}
            <More shown={PANEL_ROWS} total={maintenance.length} to="/maintenance" />
          </Panel>

          <Panel
            title="Open repairs"
            sub="Out of service"
            count={repairs.length}
            action={{ to: "/maintenance?tab=repairs", label: "View all" }}
            empty={repairsLoading ? "Loading…" : "Nothing in for repair."}
          >
            {repairs.slice(0, PANEL_ROWS).map((r) => {
              const overdue = time(r.dueAt) < now;
              return (
                <Row key={r.id} onOpen={() => navigate(`/maintenance/repairs/${r.id}`)}>
                  <span className="font-mono text-xs text-gray-500 w-10 shrink-0">R{r.number}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">{r.expand?.item?.name ?? "(deleted item)"}</div>
                    <div className={`text-xs truncate ${overdue ? "text-fault-ink font-medium" : "text-gray-500"}`}>
                      {overdue ? `Expected back ${formatDateTime(r.dueAt)}` : r.fault || "No fault described"}
                    </div>
                  </div>
                  <RepairStatusBadge status={r.status} />
                </Row>
              );
            })}
            <More shown={PANEL_ROWS} total={repairs.length} to="/maintenance?tab=repairs" />
          </Panel>
        </div>
      </div>

      {reporting && (
        <NewRepairModal
          onClose={() => setReporting(false)}
          onCreated={async (repair) => {
            setReporting(false);
            await invalidateMaintenance(queryClient);
            navigate(`/maintenance/repairs/${repair.id}`);
          }}
        />
      )}
    </div>
  );
}

// A count tile. alert marks something to act on; to makes it a link.
function Stat({ label, value, hint, alert = false, to }: { label: string; value: number | string; hint: string; alert?: boolean; to?: string }) {
  const body = (
    <>
      <span className="eyebrow text-gray-500 truncate">{label}</span>
      <span className={`font-display text-2xl tabular-nums leading-tight ${alert ? "text-fault-ink" : "text-gray-900"}`}>{value}</span>
      <span className={`text-xs truncate ${alert ? "text-fault-ink" : "text-gray-500"}`}>{hint}</span>
    </>
  );
  const className = `card px-3.5 py-3 flex flex-col gap-0.5 min-w-0 ${alert ? "shadow-[inset_3px_0_0_var(--color-fault)]" : ""}`;
  return to ? (
    <Link to={to} className={`${className} hover:border-gray-300 hover:bg-gray-50 transition-colors`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Panel({
  title,
  sub,
  count,
  action,
  empty,
  children,
}: {
  title: string;
  sub: string;
  count: number;
  action?: { to: string; label: string };
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2 border-b border-gray-200">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {title} <span className="font-mono text-xs text-gray-400 ml-1">{count}</span>
          </h2>
          <p className="text-xs text-gray-500 truncate">{sub}</p>
        </div>
        {action && (
          <Link to={action.to} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover whitespace-nowrap">
            {action.label}
          </Link>
        )}
      </div>
      {count === 0 ? <p className="px-4 py-6 text-sm text-gray-500 text-center">{empty}</p> : <div className="divide-y divide-gray-100">{children}</div>}
    </section>
  );
}

function DayGroup({ title, late, count, children }: { title: string; late: boolean; count: number; children: ReactNode }) {
  return (
    <div>
      <div className={`px-4 pt-2.5 pb-1 eyebrow ${late ? "text-fault-ink" : "text-gray-500"}`}>
        {title} <span className="text-gray-400 ml-1">{count}</span>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

function Row({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <div onClick={onOpen} className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-gray-50 cursor-pointer">
      {children}
    </div>
  );
}

function ProjectName({ job }: { job: ProjectRow }) {
  return (
    <div className="font-medium text-gray-900 truncate">
      <span className="font-mono text-xs text-gray-500 mr-1.5">{job.number}</span>
      {job.name}
    </div>
  );
}

function ProjectLine({ job, when, late, scan, onOpen }: { job: ProjectRow; when: string; late: boolean; scan?: string; onOpen: () => void }) {
  const where = [job.expand?.client?.name, job.expand?.venue?.name].filter(Boolean).join(" · ");
  return (
    <Row onOpen={onOpen}>
      <span className={`w-24 shrink-0 text-xs tabular-nums ${late ? "text-fault-ink font-medium" : "text-gray-600"}`}>{when}</span>
      <div className="min-w-0 flex-1">
        <ProjectName job={job} />
        {where && <div className="text-xs text-gray-500 truncate">{where}</div>}
      </div>
      {scan && (
        <Link to={`/projects/${job.id}/scan`} onClick={(e) => e.stopPropagation()} className="btn-secondary !px-2.5 !py-1 !text-xs whitespace-nowrap">
          {scan}
        </Link>
      )}
    </Row>
  );
}

function More({ shown, total, to }: { shown: number; total: number; to: string }) {
  if (total <= shown) return null;
  return (
    <Link to={to} className="block px-4 py-2 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50">
      and {total - shown} more…
    </Link>
  );
}
