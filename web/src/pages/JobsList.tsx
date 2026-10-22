import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Contact, Job, Venue, ViewConfig } from "../lib/api";
import { formatDateTimeYear, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { JobStatusBadge } from "../components/StatusBadge";
import ColumnsMenu from "../components/ColumnsMenu";
import PageViews from "../components/PageViews";
import { JOB_STAGES, JOB_STATUSES, type ProjectView } from "../lib/statuses";
import { orgFilter } from "../lib/currentOrg";
import { asString, asStrings } from "../lib/views";
import { useJobStatuses } from "../lib/workflow";

type JobWithExpand = Job & { expand?: { client?: Contact; venue?: Venue } };

// The view lives in the URL (?view=, by stage), so the sidebar can link to
// it; ?status= narrows to one of the organisation's own statuses.
type Filter = ProjectView;

const FILTERS = new Set<string>(["active", "mine", "all", ...JOB_STATUSES.map((s) => s.value)]);

// The columns after the project's number and name, in order. Saved views
// keep which show (components/PageViews.tsx).
interface Column {
  key: string;
  label: string;
  className?: string;
  shown: boolean;
  render: (job: JobWithExpand, now: number) => ReactNode;
}

const COLUMNS: Column[] = [
  { key: "client", label: "Client", className: "hidden md:table-cell", shown: false, render: (j) => <span className="text-gray-600">{j.expand?.client?.name ?? "—"}</span> },
  { key: "location", label: "Location", className: "hidden md:table-cell", shown: true, render: (j) => <span className="text-gray-600">{j.expand?.venue?.name ?? "—"}</span> },
  { key: "reference", label: "Reference", className: "hidden lg:table-cell", shown: false, render: (j) => <span className="text-gray-600">{j.reference || "—"}</span> },
  { key: "start", label: "Start", shown: true, render: (j) => <span className="text-gray-600 whitespace-nowrap">{formatDateTimeYear(j.startAt)}</span> },
  {
    key: "end",
    label: "End",
    className: "hidden sm:table-cell",
    shown: true,
    render: (j, now) => {
      const overdue = j.status === "out" && (parseDate(j.returnAt)?.getTime() ?? Infinity) < now;
      return (
        <span className={`whitespace-nowrap ${overdue ? "text-fault-ink font-medium" : "text-gray-600"}`} title={overdue ? "Overdue back" : undefined}>
          {formatDateTimeYear(j.endAt)}
        </span>
      );
    },
  },
  { key: "prep", label: "Kit out", className: "hidden lg:table-cell", shown: false, render: (j) => <span className="text-gray-600 whitespace-nowrap">{formatDateTimeYear(j.prepAt)}</span> },
  { key: "return", label: "Kit back", className: "hidden lg:table-cell", shown: false, render: (j) => <span className="text-gray-600 whitespace-nowrap">{formatDateTimeYear(j.returnAt)}</span> },
  { key: "status", label: "Status", shown: true, render: (j) => <JobStatusBadge status={j.status} jobStatus={j.jobStatus} /> },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);

// The page as it comes.
const DEFAULT_VIEW: ViewConfig = { view: "active", status: "", columns: COLUMNS.filter((c) => c.shown).map((c) => c.key) };

export default function JobsList() {
  const navigate = useNavigate();
  const { can } = useRole();
  const [params, setParams] = useSearchParams();
  // Opened with its own filter (the sidebar's "Mine", say): that wins over
  // the saved view.
  const [linked] = useState(() => params.has("view") || params.has("status"));
  const view = params.get("view") ?? "active";
  const filter = (FILTERS.has(view) ? view : "active") as Filter;
  const statusId = params.get("status") ?? "";
  const setFilter = (value: string) =>
    setParams(value.startsWith("status:") ? { status: value.slice(7) } : value === "active" ? {} : { view: value }, { replace: true });
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const { statuses } = useJobStatuses();

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["jobs", filter, statusId],
    queryFn: () =>
      pb.collection("jobs").getFullList<JobWithExpand>({
        sort: filter === "active" && !statusId ? "startAt" : "-startAt",
        expand: "client,venue",
        filter: orgFilter(
          statusId
            ? pb.filter("jobStatus = {:id}", { id: statusId })
            : filter === "active"
              ? "status != 'returned' && status != 'cancelled'"
              : filter === "mine"
                ? pb.filter("job_crew_via_job.user ?= {:me} && status != 'cancelled'", { me: pb.authStore.record?.id ?? "" })
                : filter === "all"
                  ? undefined
                  : pb.filter("status = {:status}", { status: filter }),
        ),
      }),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, "");
    if (!term) return jobs;
    return jobs.filter((j) =>
      [String(j.number), j.name, j.reference, j.expand?.client?.name, j.expand?.venue?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [jobs, search]);

  // What a saved view keeps: the filter and the columns.
  const settings: ViewConfig = { view: statusId ? "" : filter, status: statusId, columns: shown };
  function applySettings(s: ViewConfig) {
    const status = asString(s.status);
    const saved = asString(s.view, "active");
    setFilter(status ? `status:${status}` : FILTERS.has(saved) ? saved : "active");
    setShown(asStrings(s.columns, COLUMN_KEYS));
  }

  const now = Date.now();
  const columns = COLUMNS.filter((c) => shown.includes(c.key));

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Projects</h1>
          <p className="text-xs text-gray-500">{filtered.length.toLocaleString()} shown</p>
        </div>
        {can("jobs.create") && (
          <Link to="/projects/new" className="btn-primary">
            New project
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <PageViews page="projects" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} applyOnLoad={!linked} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, name, client, location…"
          className="input w-72"
        />
        <select value={statusId ? `status:${statusId}` : filter} onChange={(e) => setFilter(e.target.value)} className="input w-auto" aria-label="Show">
          <option value="active">Active (not done or cancelled)</option>
          <option value="mine">Mine (on the crew)</option>
          <option value="all">All projects</option>
          {statuses.length > 0 && (
            <optgroup label="Status">
              {statuses.map((s) => (
                <option key={s.id} value={`status:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Stage">
            {JOB_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="ml-auto">
          <ColumnsMenu columns={COLUMNS} visible={shown} onChange={setShown} />
        </div>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load projects: {(error as Error).message}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2 font-medium w-16">#</th>
              <th className="px-3 py-2 font-medium">Project</th>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${c.className ?? ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((job) => (
              <tr key={job.id} onClick={() => navigate(`/projects/${job.id}`)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-2 text-gray-500 font-mono text-xs">{job.number}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-gray-900 truncate">{job.name}</span>
                    {job.expand?.client && !shown.includes("client") && <span className="text-xs text-gray-500 truncate">{job.expand.client.name}</span>}
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${c.className ?? ""}`}>
                    {c.render(job, now)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">
            {jobs.length === 0 ? "No projects here yet." : "No projects match your search."}
          </p>
        )}
      </div>
    </div>
  );
}
