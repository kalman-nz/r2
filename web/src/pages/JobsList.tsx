import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb, useAuthRecord } from "../lib/pocketbase";
import { api, type Contact, type CrewMember, type CrewPerson, type Job, type JobStatus, type Venue, type ViewConfig } from "../lib/api";
import { formatDateTimeYear, num, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { JobStatusBadge, OverdueBadge } from "../components/StatusBadge";
import { overdueReason } from "../lib/overdue";
import ColumnsMenu from "../components/ColumnsMenu";
import FiltersMenu, { FilterField, GroupFields, SortList } from "../components/FiltersMenu";
import DataTable, { type TableColumn } from "../components/DataTable";
import { readGroups, readSorts, sortRows, sortSettings, type GroupOption, type Sort } from "../lib/table";
import PageViews from "../components/PageViews";
import { JOB_STAGES, PROJECT_VIEWS } from "../lib/statuses";
import { orgFilter } from "../lib/currentOrg";
import { useOrg } from "../lib/org";
import { asString, asStrings } from "../lib/views";
import { useJobStatuses } from "../lib/workflow";
import { errorText } from "../lib/errors";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { updateEach } from "../components/item/BulkEditModal";
import SelectionBar from "../components/SelectionBar";

type JobWithExpand = Job & { expand?: { client?: Contact; venue?: Venue } };
type CrewWithPerson = CrewMember & { expand?: { person?: CrewPerson } };

// A project plus what the table shows that isn't on the record itself.
interface Row extends JobWithExpand {
  clientName: string;
  venueName: string;
  statusName: string;
  // Where its status sits in the organisation's list, for sorting.
  statusOrder: number;
  crewNames: string[];
  // Why it's overdue ("" when it isn't): lib/overdue.ts.
  overdue: string;
}

interface Column extends TableColumn<Row> {
  toggleable: boolean;
  shown: boolean;
}

// Dates on one line, short enough to read in a narrow column: "Fri 30 Oct
// 4:30 pm" this year, "1 Aug 1965" otherwise (the day of the week matters
// less then). The full date's in the hover text.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function DateCell({ value, alert }: { value: string; alert?: boolean }) {
  const d = parseDate(value);
  if (!d) return <span className="text-gray-300">—</span>;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const day = thisYear ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP]M)$/i, (_, m: string) => ` ${m.toLowerCase()}`);
  return (
    <span className={`tabular-nums ${alert ? "text-fault-ink font-medium" : "text-gray-700"}`}>
      {day}
      <span className={`ml-1.5 ${alert ? "" : "text-gray-400"}`}>{time}</span>
    </span>
  );
}

const time = (value: string) => parseDate(value)?.getTime() ?? Number.MAX_SAFE_INTEGER;
const text = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);

const COLUMNS: Column[] = [
  {
    key: "number",
    label: "#",
    toggleable: false,
    shown: true,
    width: 72,
    minWidth: 64,
    sortValue: (j) => j.number,
    render: (j) => <span className="font-mono text-xs text-gray-500">{j.number}</span>,
  },
  {
    key: "name",
    label: "Project",
    toggleable: false,
    shown: true,
    width: 280,
    minWidth: 160,
    flex: true,
    sortValue: (j) => j.name.toLowerCase(),
    title: (j) => j.name,
    render: (j) => <span className="font-medium text-gray-900">{j.name}</span>,
  },
  {
    key: "client",
    label: "Client",
    toggleable: true,
    shown: true,
    width: 180,
    minWidth: 80,
    sortValue: (j) => j.clientName.toLowerCase() || "￿",
    title: (j) => j.clientName,
    render: (j) => text(j.clientName),
  },
  {
    key: "location",
    label: "Location",
    toggleable: true,
    shown: true,
    width: 170,
    minWidth: 80,
    sortValue: (j) => j.venueName.toLowerCase() || "￿",
    title: (j) => j.venueName,
    render: (j) => text(j.venueName),
  },
  {
    key: "status",
    label: "Status",
    toggleable: true,
    shown: true,
    width: 190,
    minWidth: 96,
    sortValue: (j) => j.statusOrder,
    title: (j) => (j.overdue ? `${j.statusName}: overdue. ${j.overdue}` : j.statusName),
    render: (j) => (
      <span className="inline-flex items-center gap-3">
        <OverdueBadge reason={j.overdue} />
        <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
      </span>
    ),
  },
  {
    key: "start",
    label: "Start",
    toggleable: true,
    shown: true,
    width: 170,
    minWidth: 110,
    sortValue: (j) => time(j.startAt),
    title: (j) => formatDateTimeYear(j.startAt),
    render: (j) => <DateCell value={j.startAt} />,
  },
  {
    key: "end",
    label: "End",
    toggleable: true,
    shown: true,
    width: 170,
    minWidth: 110,
    sortValue: (j) => time(j.endAt),
    title: (j) => (j.overdue ? `${j.overdue} (due back ${formatDateTimeYear(j.returnAt)})` : formatDateTimeYear(j.endAt)),
    render: (j) => <DateCell value={j.endAt} alert={!!j.overdue} />,
  },
  {
    key: "prep",
    label: "Kit out",
    toggleable: true,
    shown: false,
    width: 170,
    minWidth: 110,
    sortValue: (j) => time(j.prepAt),
    title: (j) => formatDateTimeYear(j.prepAt),
    render: (j) => <DateCell value={j.prepAt} />,
  },
  {
    key: "return",
    label: "Kit back",
    toggleable: true,
    shown: false,
    width: 170,
    minWidth: 110,
    sortValue: (j) => time(j.returnAt),
    title: (j) => formatDateTimeYear(j.returnAt),
    render: (j) => <DateCell value={j.returnAt} alert={!!j.overdue} />,
  },
  {
    key: "crew",
    label: "Crew",
    toggleable: true,
    shown: false,
    width: 170,
    minWidth: 90,
    sortValue: (j) => j.crewNames.join(", ").toLowerCase() || "￿",
    title: (j) => j.crewNames.join(", "),
    render: (j) => text(j.crewNames.join(", ")),
  },
  {
    key: "reference",
    label: "Reference",
    toggleable: true,
    shown: false,
    width: 120,
    minWidth: 90,
    sortValue: (j) => j.reference.toLowerCase() || "￿",
    title: (j) => j.reference,
    render: (j) => text(j.reference),
  },
  {
    key: "days",
    label: "Charged days",
    align: "right",
    toggleable: true,
    shown: false,
    width: 120,
    sortValue: (j) => j.chargeDays,
    render: (j) => <span className="text-gray-600 tabular-nums">{j.chargeDays ? num(j.chargeDays) : "—"}</span>,
  },
  {
    key: "created",
    label: "Created",
    toggleable: true,
    shown: false,
    width: 170,
    minWidth: 110,
    sortValue: (j) => time(j.created),
    title: (j) => formatDateTimeYear(j.created),
    render: (j) => <DateCell value={j.created} />,
  },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);

// Which projects: the views in the sidebar (and Home's links), a stage, or
// one of the organisation's own statuses ("status:<id>"). In the URL, so
// links and Back work: ?view=, or ?status=.
const VIEWS = new Set<string>(["active", "mine", "overdue", "all", ...JOB_STAGES.map((s) => s.value)]);
const DONE: JobStatus[] = ["returned", "cancelled"];

// When they happen, against now.
const WHEN = [
  { value: "any", label: "Any time" },
  { value: "today", label: "On today" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
  { value: "upcoming", label: "Not started yet" },
  { value: "past", label: "Finished" },
] as const;
type When = (typeof WHEN)[number]["value"];
const WHENS = WHEN.map((w) => w.value as string);
const DAY = 24 * 60 * 60 * 1000;

function happens(j: Job, when: When, now: number): boolean {
  if (when === "any") return true;
  const start = parseDate(j.startAt)?.getTime();
  const end = parseDate(j.endAt)?.getTime() ?? start;
  if (start === undefined || end === undefined) return false;
  const overlaps = (from: number, to: number) => start <= to && end >= from;
  if (when === "today") {
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    return overlaps(midnight, midnight + DAY - 1);
  }
  if (when === "week") return overlaps(now, now + 7 * DAY);
  if (when === "month") return overlaps(now, now + 30 * DAY);
  if (when === "upcoming") return start > now;
  return end < now;
}

function inView(j: Row, view: string, mine: Set<string>): boolean {
  if (view === "active") return !DONE.includes(j.status);
  if (view === "mine") return mine.has(j.id) && j.status !== "cancelled";
  if (view === "overdue") return !!j.overdue;
  return view === "all" || j.status === view;
}

// Finished ones read newest first; everything else soonest first.
const newestFirst = (view: string) => view === "all" || view === "returned" || view === "cancelled";

// Ways to group projects (a view can group, then subgroup).
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NO_DATE = { id: "", label: "No dates", order: Number.MAX_SAFE_INTEGER };
const byText = (id: string, label: string, empty: string) => (id ? { id, label: label || empty, order: (label || empty).toLowerCase() } : { id: "", label: empty, order: "\uffff" });

const GROUPS: GroupOption<Row>[] = [
  { key: "status", label: "Status", value: (j) => ({ id: j.jobStatus || j.status, label: j.statusName, order: j.statusOrder }) },
  { key: "client", label: "Client", value: (j) => byText(j.client, j.clientName, "No client") },
  { key: "location", label: "Location", value: (j) => byText(j.venue, j.venueName, "No location") },
  {
    key: "month",
    label: "Start month",
    value: (j) => {
      const d = parseDate(j.startAt);
      if (!d) return NO_DATE;
      return { id: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, order: d.getFullYear() * 12 + d.getMonth() };
    },
  },
  {
    key: "week",
    label: "Start week",
    value: (j) => {
      const d = parseDate(j.startAt);
      if (!d) return NO_DATE;
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      return { id: monday.toDateString(), label: `Week of ${WEEKDAYS[1]} ${monday.getDate()} ${MONTHS[monday.getMonth()]} ${monday.getFullYear()}`, order: monday.getTime() };
    },
  },
  { key: "overdue", label: "Overdue", value: (j) => (j.overdue ? { id: "y", label: "Overdue", order: 0 } : { id: "n", label: "Not overdue", order: 1 }) },
];
const GROUP_KEYS = GROUPS.map((g) => g.key);
const SORTABLE = COLUMNS.filter((c) => c.sortValue);
const SORT_KEYS = SORTABLE.map((c) => c.key);

// The page as it comes, and what a saved view keeps (components/PageViews.tsx).
const DEFAULT_VIEW: ViewConfig = {
  view: "active",
  status: "",
  when: "any",
  client: "",
  venue: "",
  crew: "",
  columns: COLUMNS.filter((c) => c.toggleable && c.shown).map((c) => c.key),
  widths: {},
  ...sortSettings([{ key: "start", dir: "asc" }]),
  groupBy: [],
};

export default function JobsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { org } = useOrg();
  const me = useAuthRecord();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  // Opened with its own filter (from Home, say): that wins over the saved view.
  const [linked] = useState(() => params.has("view") || params.has("status"));
  const askedView = params.get("view") ?? "active";
  const view = VIEWS.has(askedView) ? askedView : "active";
  const statusId = params.get("status") ?? "";
  const [search, setSearch] = useState("");
  const [when, setWhen] = useState<When>("any");
  const [client, setClient] = useState("");
  const [venue, setVenue] = useState("");
  const [crewUser, setCrewUser] = useState("");
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>(() => [{ key: "start", dir: newestFirst(view) ? "desc" : "asc" }]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { statuses, byId } = useJobStatuses();

  function show(next: string) {
    setParams(next.startsWith("status:") ? { status: next.slice(7) } : next === "active" ? {} : { view: next }, { replace: true });
    setSelected(new Set());
    // Dates sort the way that view reads best, unless they're sorted by something else.
    if (sorts.length === 1 && sorts[0].key === "start" && !next.startsWith("status:")) setSorts([{ key: "start", dir: newestFirst(next) ? "desc" : "asc" }]);
  }

  // Every project, once: the sidebar counts them all, and switching views
  // is instant.
  const {
    data: jobs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["jobs", "list"],
    queryFn: () => pb.collection("jobs").getFullList<JobWithExpand>({ sort: "startAt", expand: "client,venue", filter: orgFilter() }),
  });
  const { data: crew = [] } = useQuery({
    queryKey: ["job-crew", "all"],
    queryFn: () => pb.collection("job_crew").getFullList<CrewWithPerson>({ filter: orgFilter(), sort: "sortOrder,created", expand: "person" }),
  });
  // Kit still out per project, for "Overdue" (returned with kit not back).
  const { data: outstanding = {} } = useQuery({ queryKey: ["jobs", "outstanding"], queryFn: api.outstanding });
  const { data: members = [] } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api.listMembers(org!.id),
    enabled: !!org,
  });

  const rows = useMemo<Row[]>(() => {
    const names = new Map(members.map((m) => [m.userId, m.name || m.email || "Someone"]));
    const crewOf = new Map<string, string[]>();
    // Each person once, however many of its crew slots they fill.
    const seen = new Set<string>();
    for (const c of crew) {
      if (seen.has(`${c.job}:${c.person}`)) continue;
      seen.add(`${c.job}:${c.person}`);
      crewOf.set(c.job, [...(crewOf.get(c.job) ?? []), c.expand?.person?.name ?? names.get(c.user) ?? "Someone"]);
    }
    const order = new Map(statuses.map((s, i) => [s.id, i]));
    const stageOrder = (stage: JobStatus) => 1000 + JOB_STAGES.findIndex((s) => s.value === stage);
    const now = Date.now();
    return jobs.map((j) => ({
      ...j,
      clientName: j.expand?.client?.name ?? "",
      venueName: j.expand?.venue?.name ?? "",
      statusName: byId.get(j.jobStatus)?.name ?? JOB_STAGES.find((s) => s.value === j.status)?.label ?? j.status,
      statusOrder: order.get(j.jobStatus) ?? stageOrder(j.status),
      crewNames: crewOf.get(j.id) ?? [],
      overdue: overdueReason(j, outstanding[j.id]?.units ?? 0, now),
    }));
  }, [jobs, crew, members, statuses, byId, outstanding]);

  const mine = useMemo(() => new Set(crew.filter((c) => c.user === me?.id).map((c) => c.job)), [crew, me?.id]);
  // Projects each person's on, for the crew filter: by their crew list
  // record, and (for views saved before freelancers) by their login.
  const onCrew = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const c of crew) {
      for (const key of [c.person, c.user]) if (key) out.set(key, (out.get(key) ?? new Set()).add(c.job));
    }
    return out;
  }, [crew]);
  // Everyone on a crew somewhere, for the filter's list.
  const crewChoices = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of crew) if (c.person) names.set(c.person, c.expand?.person?.name ?? "Someone");
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [crew]);

  // The clients and locations the projects have, for the filters.
  const choices = useMemo(() => {
    const clients = new Map<string, string>();
    const venues = new Map<string, string>();
    for (const j of rows) {
      if (j.client) clients.set(j.client, j.clientName || "(deleted)");
      if (j.venue) venues.set(j.venue, j.venueName || "(deleted)");
    }
    const sorted = (m: Map<string, string>) => [...m].sort((a, b) => a[1].localeCompare(b[1]));
    return { clients: sorted(clients), venues: sorted(venues) };
  }, [rows]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    const add = (key: string) => out.set(key, (out.get(key) ?? 0) + 1);
    for (const j of rows) {
      add("all");
      if (!DONE.includes(j.status)) add("active");
      if (mine.has(j.id) && j.status !== "cancelled") add("mine");
      if (j.overdue) add("overdue");
      add(`status:${j.jobStatus}`);
    }
    return out;
  }, [rows, mine]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const term = search.trim().toLowerCase().replace(/^#/, "");
    const result = rows.filter((j) => {
      if (statusId ? j.jobStatus !== statusId : !inView(j, view, mine)) return false;
      if (!happens(j, when, now)) return false;
      if (client && j.client !== client) return false;
      if (venue && j.venue !== venue) return false;
      if (crewUser && !onCrew.get(crewUser)?.has(j.id)) return false;
      if (
        term &&
        ![String(j.number), j.name, j.reference, j.clientName, j.venueName, j.statusName, ...j.crewNames].some((v) => v.toLowerCase().includes(term))
      ) {
        return false;
      }
      return true;
    });
    return sortRows(result, COLUMNS, sorts);
  }, [rows, statusId, view, mine, when, client, venue, crewUser, onCrew, search, sorts]);

  // What a saved view keeps.
  const settings: ViewConfig = {
    view: statusId ? "" : view,
    status: statusId,
    when,
    client,
    venue,
    crew: crewUser,
    columns: shown,
    widths,
    ...sortSettings(sorts),
    groupBy,
  };
  function applySettings(s: ViewConfig) {
    const status = asString(s.status);
    const saved = asString(s.view, "active");
    setParams(status ? { status } : saved === "active" || !VIEWS.has(saved) ? {} : { view: saved }, { replace: true });
    const w = asString(s.when, "any");
    setWhen((WHENS.includes(w) ? w : "any") as When);
    setClient(asString(s.client));
    setVenue(asString(s.venue));
    setCrewUser(asString(s.crew));
    setShown(asStrings(s.columns, COLUMN_KEYS));
    const sized: Record<string, number> = {};
    if (s.widths && typeof s.widths === "object") {
      for (const [k, v] of Object.entries(s.widths)) if (typeof v === "number" && v > 0) sized[k] = v;
    }
    setWidths(sized);
    setSorts(readSorts(s, SORT_KEYS, { key: "start", dir: newestFirst(status ? "" : saved) ? "desc" : "asc" }));
    setGroupBy(readGroups(s, GROUP_KEYS));
    setSelected(new Set());
  }

  const columns = COLUMNS.filter((c) => !c.toggleable || shown.includes(c.key));
  const selectedRows = filtered.filter((j) => selected.has(j.id));
  const title = statusId
    ? (byId.get(statusId)?.name ?? "Projects")
    : view === "overdue"
      ? "Overdue"
      : (PROJECT_VIEWS.find((v) => v.value === view)?.label ?? JOB_STAGES.find((s) => s.value === view)?.label ?? "Projects");
  const current = statusId ? `status:${statusId}` : view;
  const activeFilters = (current !== "active" ? 1 : 0) + (when !== "any" ? 1 : 0) + (client ? 1 : 0) + (venue ? 1 : 0) + (crewUser ? 1 : 0);
  const filtersOn = activeFilters > 0;
  function clearFilters() {
    if (current !== "active") show("active");
    setWhen("any");
    setClient("");
    setVenue("");
    setCrewUser("");
  }

  async function setStatus(id: string) {
    const status = byId.get(id);
    if (!status) return;
    const targets = selectedRows.filter((j) => j.jobStatus !== id);
    const what = `${targets.length} project${targets.length === 1 ? "" : "s"}`;
    if (targets.length === 0) return;
    const ok = await confirm({
      title: `Set ${what} to ${status.name}`,
      message:
        status.stage === "returned" || status.stage === "cancelled"
          ? `Set ${what} to ${status.name}? Their equipment is released for other bookings.`
          : `Set ${what} to ${status.name}?`,
      confirmLabel: `Set to ${status.name}`,
    });
    if (!ok) return;
    setBusy(true);
    const failed = await updateEach("jobs", targets, () => ({ jobStatus: id }));
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    if (failed.length === 0) {
      showToast("success", `Set ${what} to ${status.name}`);
      setSelected(new Set());
    } else {
      showToast("error", `${failed.length} of ${targets.length} couldn't be changed: ${errorText(failed[0].error)}`);
    }
  }

  // The server keeps projects that have been quoted or scanned (they're
  // history): those are left selected, to cancel instead.
  async function deleteSelected() {
    const targets = selectedRows;
    const what = `${targets.length} project${targets.length === 1 ? "" : "s"}`;
    const ok = await confirm({
      title: `Delete ${what}`,
      message: `Delete ${what}, with their equipment, schedule and crew? This can't be undone. Any that have been quoted or scanned are skipped: cancel those instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const kept = new Set<string>();
    for (const j of targets) {
      try {
        await pb.collection("jobs").delete(j.id);
      } catch {
        kept.add(j.id);
      }
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    setSelected(kept);
    if (kept.size === 0) showToast("success", `Deleted ${what}`);
    else
      showToast(
        "error",
        `Deleted ${targets.length - kept.size}. ${kept.size} couldn't be deleted (quoted or scanned) and are still selected, so you can cancel them.`,
      );
  }

  const counted = (key: string) => (counts.get(key) ?? 0).toLocaleString();

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-xs text-gray-500" aria-label="Projects">
            <button onClick={() => show("active")} className="hover:text-gray-900">
              Projects
            </button>
            {current !== "active" && (
              <>
                <span className="text-gray-300">›</span>
                <span>{title}</span>
              </>
            )}
          </nav>
          <h1 className="text-lg font-semibold text-gray-900 truncate">{current === "active" ? "Active projects" : title}</h1>
          <p className="text-xs text-gray-500">
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} project${filtered.length === 1 ? "" : "s"}${search.trim() || filtersOn ? " found" : ""}`}
          </p>
        </div>
        {can("jobs.create") && (
          <Link to="/projects/new" className="btn-primary">
            New project
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page="projects" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} applyOnLoad={!linked} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects, clients, locations…"
          className="input flex-1 min-w-40 max-w-72"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <FiltersMenu active={activeFilters} onReset={clearFilters}>
            <FilterField label="Show">
              <select value={current} onChange={(e) => show(e.target.value)} className="input">
                <option value="active">Active ({counted("active")})</option>
                <option value="mine">Mine ({counted("mine")})</option>
                <option value="overdue">Overdue ({counted("overdue")})</option>
                <option value="all">All projects ({counted("all")})</option>
                {statuses.length > 0 && (
                  <optgroup label="Status">
                    {statuses.map((s) => (
                      <option key={s.id} value={`status:${s.id}`}>
                        {s.name} ({counted(`status:${s.id}`)})
                      </option>
                    ))}
                  </optgroup>
                )}
                {!statusId && !["active", "mine", "overdue", "all"].includes(view) && <option value={view}>{title}</option>}
              </select>
            </FilterField>
            <FilterField label="When">
              <select value={when} onChange={(e) => setWhen(e.target.value as When)} className="input">
                {WHEN.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Client">
              <select value={client} onChange={(e) => setClient(e.target.value)} className="input">
                <option value="">Any client</option>
                {choices.clients.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Location">
              <select value={venue} onChange={(e) => setVenue(e.target.value)} className="input">
                <option value="">Any location</option>
                {choices.venues.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Crew">
              <select value={crewUser} onChange={(e) => setCrewUser(e.target.value)} className="input">
                <option value="">Anyone</option>
                {crewChoices.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                {crewUser && !crewChoices.some(([id]) => id === crewUser) && <option value={crewUser}>Someone</option>}
              </select>
            </FilterField>
            <SortList columns={SORTABLE} sorts={sorts} onChange={setSorts} />
            <GroupFields options={GROUPS} groupBy={groupBy} onChange={setGroupBy} />
          </FiltersMenu>
          <ColumnsMenu columns={COLUMNS.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm shrink-0">Couldn't load projects: {(error as Error).message}</p>}

      {selectedRows.length > 0 && (
        <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
          {can("jobs.edit") && (
            <select value="" onChange={(e) => setStatus(e.target.value)} disabled={busy} className="input w-auto py-1.5" aria-label="Set status">
              <option value="" disabled>
                Set status…
              </option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {can("jobs.delete") && (
            <button onClick={deleteSelected} disabled={busy} className="btn-secondary hover:text-fault-ink">
              Delete
            </button>
          )}
          </SelectionBar>
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(j) => j.id}
        onRowClick={(j, e) => (e.metaKey || e.ctrlKey ? window.open(`/projects/${j.id}`, "_blank") : navigate(`/projects/${j.id}`))}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groupBy.map((k) => GROUPS.find((g) => g.key === k)!).filter(Boolean)}
        widths={widths}
        onWidthsChange={setWidths}
        selected={can("jobs.edit") || can("jobs.delete") ? selected : undefined}
        onSelectedChange={setSelected}
        empty={
          !isLoading &&
          filtered.length === 0 && (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">
              {jobs.length === 0 ? "No projects yet." : search.trim() || filtersOn ? "No projects match." : "No projects here."}
            </p>
          )
        }
      />
    </div>
  );
}
