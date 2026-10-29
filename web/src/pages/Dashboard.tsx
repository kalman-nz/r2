import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type CrewMember, type CrewNeed, type CrewRole, type Dashboard, type JobPeriod, type Quote } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { formatDate, formatDateTime, formatDuration, formatTime, nzd, parseDate } from "../lib/format";
import { assetLabel, dueLabel, inDays, invalidateMaintenance, today, useMaintenanceJobs, useRepairs } from "../lib/maintenance";
import { byDay, dayOf, greeting, PANEL_BY_ID, panelAllowed, STANDARD_PANELS, startsLabel, type PanelId, type ProjectRow } from "../lib/home";
import { useOrg } from "../lib/org";
import { useRole } from "../lib/roles";
import { OPEN_REPAIRS_FILTER } from "../lib/statuses";
import { errorText } from "../lib/errors";
import { byLabel } from "../lib/views";
import { progressOf, useTrackingSteps } from "../lib/tracking";
import { JobStatusBadge, RepairStatusBadge, TrackingStatus } from "../components/StatusBadge";
import NewRepairModal from "../components/repair/NewRepairModal";
import DashboardEditor from "../components/home/DashboardEditor";
import ManageViews from "../components/ManageViews";
import ShareModal from "../components/ShareModal";
import ViewMenu from "../components/ViewMenu";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import { DayGroup, More, Panel, ProjectLine, ProjectName, Row, Stat } from "../components/home/parts";

// How many rows the side panels show before "View all".
const PANEL_ROWS = 6;

type CrewWithJob = CrewMember & { expand?: { job?: ProjectRow; need?: CrewNeed & { expand?: { role?: CrewRole; period?: JobPeriod } } } };
type QuoteWithJob = Quote & { expand?: { job?: ProjectRow } };
type Editing = { dashboard?: Dashboard; start?: { name: string; panels: PanelId[] } };

// Home: the dashboard you've picked (or the organisation's default), made
// of panels (lib/home.ts). Anyone can design their own, copy someone
// else's, and share theirs with people; sharing with everyone takes
// views.publish (routes_views.pb.js).
export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { org, feature } = useOrg();
  const { record, can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sharing, setSharing] = useState<Dashboard | null>(null);
  const [managing, setManaging] = useState(false);
  const canScanOut = can("scan.out");
  const { steps } = useTrackingSteps();
  const canScanIn = can("scan.in");

  const { data: boards } = useQuery({ queryKey: ["dashboards"], queryFn: api.dashboards });
  const current = boards?.dashboards.find((d) => d.id === (boards.home || boards.defaultId)) ?? null;
  // What this person can see of it, in its order.
  const panels = useMemo(
    () =>
      ((current ? current.panels.map((p) => p.id) : boards ? STANDARD_PANELS : []) as PanelId[]).filter((id) => {
        const panel = PANEL_BY_ID.get(id);
        return !!panel && panelAllowed(panel, can, feature);
      }),
    [current, boards, can, feature],
  );
  const has = (id: PanelId) => panels.includes(id);
  const projectsOn = feature("projects");
  const needsJobs = projectsOn && panels.some((id) => ["glance", "prep", "going-out", "coming-back", "out-now", "confirm"].includes(id));
  const maintenanceOn = feature("maintenance") && (has("maintenance") || has("glance"));
  const repairsOn = feature("repairs") && (has("repairs") || has("glance"));

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["jobs", "dashboard"],
    queryFn: () =>
      pb.collection("jobs").getFullList<ProjectRow>({
        sort: "prepAt",
        expand: "client,venue",
        filter: orgFilter("status != 'returned' && status != 'cancelled'"),
      }),
    enabled: needsJobs,
  });
  const { data: outstanding = {} } = useQuery({ queryKey: ["jobs", "outstanding"], queryFn: api.outstanding, enabled: projectsOn && has("glance") });
  // Without projects, the glance is the inventory's: units out of service.
  const { data: unitsOut } = useQuery({
    queryKey: ["serials", "out-of-service"],
    queryFn: async () => {
      const count = async (status: string) => (await pb.collection("serials").getList(1, 1, { filter: orgFilter(`status = '${status}'`), fields: "id" })).totalItems;
      const [repair, lost] = await Promise.all([count("repair"), count("lost")]);
      return { repair, lost };
    },
    enabled: !projectsOn && has("glance"),
  });
  const { data: maintenance = [], isLoading: maintenanceLoading } = useMaintenanceJobs(`status = 'scheduled' && dueOn <= "${inDays(7)}"`, "dueOn", maintenanceOn);
  const { data: repairs = [], isLoading: repairsLoading } = useRepairs(OPEN_REPAIRS_FILTER, repairsOn);
  const { data: crew = [], isLoading: crewLoading } = useQuery({
    queryKey: ["job-crew", "mine", record?.id],
    queryFn: () =>
      pb.collection("job_crew").getFullList<CrewWithJob>({
        filter: orgFilter(pb.filter("user = {:me} && job.status != 'returned' && job.status != 'cancelled'", { me: record!.id })),
        expand: "job,job.client,job.venue,need,need.role,need.period",
      }),
    enabled: has("mine") && !!record,
  });
  const { data: quotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ["quotes", "waiting"],
    queryFn: () => pb.collection("quotes").getFullList<QuoteWithJob>({ filter: orgFilter("status = 'issued'"), sort: "issuedAt", expand: "job" }),
    enabled: has("quotes"),
  });

  const now = Date.now();
  const todayDay = today();
  const weekEnd = inDays(7);
  const time = (v: string) => parseDate(v)?.getTime() ?? Infinity;

  // Confirmed and not yet out. Enquiries and provisionals wait in "Needs
  // confirming" instead.
  const goingOut = jobs.filter((j) => j.status === "confirmed" && dayOf(j.prepAt) !== "" && dayOf(j.prepAt) <= weekEnd);
  const goingOutToday = goingOut.filter((j) => dayOf(j.prepAt) <= todayDay);
  const lateOut = goingOut.filter((j) => dayOf(j.prepAt) < todayDay);
  const out = jobs.filter((j) => j.status === "out").sort((a, b) => time(a.returnAt) - time(b.returnAt));
  const comingBack = out.filter((j) => dayOf(j.returnAt) !== "" && dayOf(j.returnAt) <= weekEnd);
  const overdueBack = out.filter((j) => time(j.returnAt) < now);
  // Set to returned, but with kit that hasn't been tracked back in.
  const returnedNotBack = Object.values(outstanding).filter((o) => o.status === "returned").length;
  const overdue = overdueBack.length + returnedNotBack;
  const backToday = out.filter((j) => dayOf(j.returnAt) === todayDay && time(j.returnAt) >= now);
  const toConfirm = jobs.filter((j) => (j.status === "enquiry" || j.status === "provisional") && dayOf(j.prepAt) !== "" && dayOf(j.prepAt) <= inDays(14));
  const toPrep = jobs.filter((j) => j.status === "confirmed" && dayOf(j.prepAt) !== "" && dayOf(j.prepAt) <= inDays(14));
  // Each project once, at your next crew slot on it (else its start), with
  // what you're doing.
  const mine = (() => {
    type Next = { start: string; name: string };
    const byJob = new Map<string, { job: ProjectRow; next?: Next; roles: string[] }>();
    for (const c of crew) {
      const job = c.expand?.job;
      if (!job) continue;
      const entry = byJob.get(job.id) ?? { job, roles: [] };
      const need = c.expand?.need;
      if (need && time(need.end) >= now && (!entry.next || time(need.start) < time(entry.next.start))) {
        entry.next = { start: need.start, name: need.expand?.period?.name ?? "" };
      }
      const role = need?.expand?.role?.name || c.function;
      if (role && !entry.roles.includes(role)) entry.roles.push(role);
      byJob.set(job.id, entry);
    }
    const at = (m: { job: ProjectRow; next?: Next }) => (m.next ? m.next.start : m.job.startAt);
    return [...byJob.values()].map((m) => ({ ...m, at: at(m) })).sort((a, b) => time(a.at) - time(b.at));
  })();
  const maintenanceOverdue = maintenance.filter((m) => m.dueOn < todayDay);
  const repairsOverdue = repairs.filter((r) => time(r.dueAt) < now);

  // Packing progress for what's next to prep (with scanning on).
  const prepIds = toPrep.slice(0, 20).map((j) => j.id);
  const { data: packing = {} } = useQuery({
    queryKey: ["home-packing", prepIds.join(",")],
    queryFn: () => api.packing(prepIds),
    enabled: has("prep") && feature("scanning") && prepIds.length > 0,
  });

  const firstName = String(record?.name ?? "").trim().split(/\s+/)[0];
  const loading = isLoading ? "—" : undefined;
  const refreshBoards = () => queryClient.invalidateQueries({ queryKey: ["dashboards"] });

  async function choose(id: string) {
    try {
      await api.setHome(id);
      await refreshBoards();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function remove(d: Dashboard) {
    const ok = await confirm({ title: "Delete dashboard", message: `Delete ${d.name}? Anyone it's shared with loses it too.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.deleteDashboard(d.id);
      await refreshBoards();
      showToast("success", `Deleted ${d.name}`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function makeDefault(d: Dashboard) {
    try {
      await api.updateDashboard(d.id, { isDefault: true });
      await refreshBoards();
      showToast("success", `${d.name} is everyone's Home now, until they pick their own`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  function render(id: PanelId): ReactNode {
    switch (id) {
      case "glance":
        if (!projectsOn) {
          return (
            <div key={id} className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              {feature("maintenance") && (
                <>
                  <Stat
                    label="Maintenance overdue"
                    value={maintenanceLoading ? "—" : maintenanceOverdue.length}
                    hint={maintenanceOverdue.length > 0 ? "Past due" : "All up to date"}
                    alert={maintenanceOverdue.length > 0}
                    to="/maintenance"
                  />
                  <Stat label="Due this week" value={maintenanceLoading ? "—" : maintenance.length - maintenanceOverdue.length} hint="Maintenance coming up" to="/maintenance" />
                </>
              )}
              {feature("repairs") && (
                <Stat
                  label="Open repairs"
                  value={repairsLoading ? "—" : repairs.length}
                  hint={repairsOverdue.length > 0 ? `${repairsOverdue.length} past expected back` : "Out of service"}
                  alert={repairsOverdue.length > 0}
                  to="/maintenance?tab=repairs"
                />
              )}
              <Stat label="Units in repair" value={unitsOut ? unitsOut.repair : "—"} hint="Out of service" to="/inventory" />
              <Stat label="Units lost" value={unitsOut ? unitsOut.lost : "—"} hint={unitsOut && unitsOut.lost > 0 ? "Missing" : "None missing"} alert={!!unitsOut && unitsOut.lost > 0} to="/inventory" />
            </div>
          );
        }
        return (
          <div key={id} className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            <Stat
              label="Going out today"
              value={loading ?? goingOutToday.length}
              hint={lateOut.length > 0 ? `${lateOut.length} late` : `${goingOut.length} this week`}
              alert={lateOut.length > 0}
            />
            <Stat label="Due back today" value={loading ?? backToday.length} hint={`${comingBack.length} this week`} />
            <Stat
              label="Overdue back"
              value={loading ?? overdue}
              hint={returnedNotBack > 0 ? `${returnedNotBack} returned with kit missing` : overdue > 0 ? "Chase these up" : "All on time"}
              alert={overdue > 0}
              to="/projects?view=overdue"
            />
            <Stat label="Out on hire" value={loading ?? out.length} hint="Projects out now" to="/projects?view=out" />
            {feature("maintenance") && (
              <Stat
                label="Maintenance overdue"
                value={maintenanceLoading ? "—" : maintenanceOverdue.length}
                hint={`${maintenance.length - maintenanceOverdue.length} due this week`}
                alert={maintenanceOverdue.length > 0}
                to="/maintenance"
              />
            )}
            {feature("repairs") && (
              <Stat
                label="Open repairs"
                value={repairsLoading ? "—" : repairs.length}
                hint={repairsOverdue.length > 0 ? `${repairsOverdue.length} past expected back` : "Out of service"}
                alert={repairsOverdue.length > 0}
                to="/maintenance?tab=repairs"
              />
            )}
          </div>
        );
      case "mine":
        return (
          <Panel
            key={id}
            title="My projects"
            sub="The ones you're on the crew for, soonest first"
            count={mine.length}
            action={{ to: "/projects?view=mine", label: "All mine" }}
            empty={crewLoading ? "Loading…" : "You're not on any upcoming projects."}
          >
            {mine.slice(0, 12).map(({ job: j, next, roles, at }) => {
              const when = dayOf(at) === todayDay ? formatTime(at) : formatDateTime(at);
              return (
                <ProjectLine
                  key={j.id}
                  job={j}
                  when={next?.name ? `${next.name}, ${when}` : when}
                  late={false}
                  extra={
                    <span className="flex items-center gap-2 shrink-0">
                      {roles.length > 0 && <span className="text-xs text-gray-500 whitespace-nowrap">{roles.join(", ")}</span>}
                      <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
                    </span>
                  }
                  onOpen={() => navigate(`/projects/${j.id}`)}
                />
              );
            })}
          </Panel>
        );
      case "prep":
        return (
          <Panel
            key={id}
            title="To prep next"
            sub="Confirmed, going out in the next 14 days"
            count={toPrep.length}
            action={{ to: "/projects?view=confirmed", label: "All confirmed" }}
            empty={isLoading ? "Loading…" : "Nothing to prep in the next two weeks."}
          >
            {byDay(toPrep, (j) => j.prepAt, "Late, should be out").map((g) => (
              <DayGroup key={g.key} title={g.title} late={g.late} count={g.rows.length}>
                {g.rows.map((j) => (
                  <ProjectLine
                    key={j.id}
                    job={j}
                    when={g.late ? formatDateTime(j.prepAt) : formatTime(j.prepAt)}
                    late={time(j.prepAt) < now}
                    extra={
                      <span className="flex items-center gap-3 shrink-0">
                        <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
                        {/* Only once something's been scanned: a project nobody scans isn't tracked. */}
                        {packing[j.id] && Object.values(packing[j.id].at).some((n) => n > 0) && <TrackingStatus progress={progressOf(steps, packing[j.id].at, packing[j.id].needed)} compact />}
                      </span>
                    }
                    scan={canScanOut ? { label: "Track" } : undefined}
                    onOpen={() => navigate(`/projects/${j.id}`)}
                  />
                ))}
              </DayGroup>
            ))}
          </Panel>
        );
      case "going-out":
        return (
          <Panel
            key={id}
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
                    scan={canScanOut ? { label: "Track" } : undefined}
                    onOpen={() => navigate(`/projects/${j.id}`)}
                  />
                ))}
              </DayGroup>
            ))}
          </Panel>
        );
      case "coming-back":
        return (
          <Panel
            key={id}
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
                      scan={canScanIn ? { label: "Return", stage: "back" } : undefined}
                      onOpen={() => navigate(`/projects/${j.id}`)}
                    />
                  );
                })}
              </DayGroup>
            ))}
          </Panel>
        );
      case "out-now":
        return (
          <Panel key={id} title="Out now" sub="Out on hire, by when it's due back" count={out.length} action={{ to: "/projects?view=out", label: "View all" }} empty={isLoading ? "Loading…" : "Nothing's out."}>
            {out.slice(0, PANEL_ROWS).map((j) => {
              const late = time(j.returnAt) < now;
              return (
                <Row key={j.id} onOpen={() => navigate(`/projects/${j.id}`)}>
                  <div className="min-w-0 flex-1">
                    <ProjectName job={j} />
                    <div className={`text-xs ${late ? "text-fault-ink font-medium" : "text-gray-500"}`}>
                      {late ? `${formatDuration(now - time(j.returnAt))} late` : `Back ${formatDateTime(j.returnAt)}`}
                    </div>
                  </div>
                  <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
                </Row>
              );
            })}
            <More shown={PANEL_ROWS} total={out.length} to="/projects?view=out" />
          </Panel>
        );
      case "confirm":
        return (
          <Panel key={id} title="Needs confirming" sub="Enquiries and provisionals starting within 14 days" count={toConfirm.length} empty={isLoading ? "Loading…" : "Nothing waiting on a decision."}>
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
                  <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
                </Row>
              );
            })}
            <More shown={PANEL_ROWS} total={toConfirm.length} to="/projects" />
          </Panel>
        );
      case "maintenance":
        return (
          <Panel
            key={id}
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
        );
      case "repairs":
        return (
          <Panel key={id} title="Open repairs" sub="Out of service" count={repairs.length} action={{ to: "/maintenance?tab=repairs", label: "View all" }} empty={repairsLoading ? "Loading…" : "Nothing in for repair."}>
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
        );
      case "quotes": {
        const total = quotes.reduce((sum, q) => sum + (q.total || 0), 0);
        return (
          <Panel
            key={id}
            title="Quotes waiting"
            sub={quotes.length > 0 ? `${nzd(total)} incl GST, waiting on clients` : "Issued, not yet accepted"}
            count={quotes.length}
            empty={quotesLoading ? "Loading…" : "No quotes waiting."}
          >
            {quotes.slice(0, PANEL_ROWS).map((q) => (
              <Row key={q.id} onOpen={() => navigate(`/print/quotes/${q.id}`)}>
                <div className="min-w-0 flex-1">
                  {q.expand?.job ? <ProjectName job={q.expand.job} /> : <div className="text-gray-500">(deleted project)</div>}
                  <div className="text-xs text-gray-500">Issued {formatDate(q.issuedAt)}</div>
                </div>
                <span className="text-xs tabular-nums text-gray-700 whitespace-nowrap">{nzd(q.total)}</span>
              </Row>
            ))}
            <More shown={PANEL_ROWS} total={quotes.length} to="/projects" />
          </Panel>
        );
      }
    }
  }

  const full = panels.filter((id) => PANEL_BY_ID.get(id)?.size === "full");
  const wide = panels.filter((id) => PANEL_BY_ID.get(id)?.size === "wide");
  const side = panels.filter((id) => PANEL_BY_ID.get(id)?.size === "side");
  const list = boards?.dashboards ?? [];
  const startNew = () => setEditing({ start: { name: "", panels: [] } });
  // Your own copy to change: of one you can't, say.
  const copyOf = (d: Dashboard | null) =>
    setEditing({ start: { name: d ? `${d.name} (mine)` : "My dashboard", panels: (d?.panels.map((p) => p.id) ?? STANDARD_PANELS) as PanelId[] } });

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
          {can("units.flag") && feature("repairs") && (
            <button onClick={() => setReporting(true)} className="btn-secondary">
              Create repair
            </button>
          )}
          {(canScanOut || canScanIn) && (
            <Link to="/scan" className="btn-secondary">
              Track equipment
            </Link>
          )}
          {can("jobs.create") && (
            <Link to="/projects/new" className="btn-primary">
              New project
            </Link>
          )}
        </div>
      </div>

      {/* Which dashboard. Editing, copying, sharing and the rest are in its menu. */}
      <div className="flex items-center gap-1.5 flex-wrap text-sm">
        <ViewMenu
          label="Dashboard"
          views={list}
          currentId={current?.id ?? ""}
          placeholder="Standard"
          note={(d) => (d.isDefault ? "Default" : byLabel(d))}
          onPick={(d) => d && choose(d.id)}
          actions={[
            current?.canEdit && { label: "Edit dashboard…", onClick: () => setEditing({ dashboard: current }) },
            { label: "New dashboard", onClick: startNew },
            { label: "Copy this dashboard", onClick: () => copyOf(current) },
            current?.isOwner && { label: "Share…", onClick: () => setSharing(current) },
            { label: "Manage dashboards…", onClick: () => setManaging(true) },
          ]}
        />
      </div>

      {error && <p className="text-red-600 text-sm">Couldn't load projects: {(error as Error).message}</p>}

      {full.map(render)}
      {wide.length + side.length > 0 && (
        <div className={`grid gap-4 items-start ${wide.length > 0 && side.length > 0 ? "lg:grid-cols-5" : ""}`}>
          {wide.length > 0 && <div className={`flex flex-col gap-4 ${side.length > 0 ? "lg:col-span-3" : ""}`}>{wide.map(render)}</div>}
          {side.length > 0 && (
            <div className={`flex flex-col gap-4 ${wide.length > 0 ? "lg:col-span-2" : "lg:grid lg:grid-cols-2 lg:items-start"}`}>{side.map(render)}</div>
          )}
        </div>
      )}
      {boards && panels.length === 0 && (
        <div className="card px-4 py-8 text-center text-sm text-gray-500">
          Nothing on this dashboard you can see. {current?.canEdit ? "Edit it to add panels." : "Copy it, or pick another, to make it yours."}
        </div>
      )}

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
      {editing && (
        <DashboardEditor
          dashboard={editing.dashboard}
          start={editing.start}
          onClose={() => setEditing(null)}
          onSaved={async (saved) => {
            const created = !editing.dashboard;
            setEditing(null);
            // A new one's what you made it for: it's your Home now.
            if (created) {
              setManaging(false);
              await api.setHome(saved.id);
            }
            await refreshBoards();
            showToast("success", created ? `${saved.name} is your Home now` : "Saved");
          }}
        />
      )}
      {sharing && (
        <ShareModal
          name={sharing.name}
          value={sharing}
          onSave={async (shared) => {
            await api.updateDashboard(sharing.id, shared);
            await refreshBoards();
          }}
          onClose={() => setSharing(null)}
        />
      )}
      {/* Out of the way while editing or sharing one, back after. */}
      {managing && !editing && !sharing && (
        <ManageViews
          title="Dashboards"
          views={list}
          currentId={current?.id ?? ""}
          note={(d) => (d.isDefault ? "everyone's Home until they pick their own" : "")}
          onPick={(d) => {
            setManaging(false);
            choose(d.id);
          }}
          onShare={setSharing}
          actions={(d) => [
            d.canEdit && { label: "Edit", onClick: () => setEditing({ dashboard: d }) },
            { label: "Copy", onClick: () => copyOf(d) },
            can("views.publish") && d.public && !d.isDefault && { label: "Make default", onClick: () => makeDefault(d) },
            d.canEdit && !d.isDefault && { label: "Delete", onClick: () => remove(d), danger: true },
          ]}
          onClose={() => setManaging(false)}
        >
          <button onClick={startNew} className="btn-secondary self-start">
            New dashboard
          </button>
        </ManageViews>
      )}
    </div>
  );
}
