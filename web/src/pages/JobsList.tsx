import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Contact, Job, Venue } from "../lib/api";
import { formatDateTimeYear, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { JobStatusBadge } from "../components/StatusBadge";
import SavedViews from "../components/SavedViews";
import { JOB_STAGES, JOB_STATUSES, type ProjectView } from "../lib/statuses";
import { orgFilter } from "../lib/currentOrg";
import { useJobStatuses } from "../lib/workflow";

type JobWithExpand = Job & { expand?: { client?: Contact; venue?: Venue } };

// The view lives in the URL (?view=, by stage), so the sidebar can link to
// it; ?status= narrows to one of the organisation's own statuses.
type Filter = ProjectView;

const FILTERS = new Set<string>(["active", "mine", "all", ...JOB_STATUSES.map((s) => s.value)]);

export default function JobsList() {
  const navigate = useNavigate();
  const { can } = useRole();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "active";
  const filter = (FILTERS.has(view) ? view : "active") as Filter;
  const statusId = params.get("status") ?? "";
  const setFilter = (value: string) =>
    setParams(value.startsWith("status:") ? { status: value.slice(7) } : value === "active" ? {} : { view: value }, { replace: true });
  const [search, setSearch] = useState("");
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

  const now = Date.now();
  // What a saved view keeps (components/SavedViews.tsx).
  const config = { view: statusId ? "" : filter, status: statusId, search: search.trim() };
  function apply(saved: Record<string, string>) {
    setSearch(saved.search ?? "");
    // A status that's since been removed falls back to its stage's view.
    if (saved.status && statuses.some((s) => s.id === saved.status)) setFilter(`status:${saved.status}`);
    else setFilter(FILTERS.has(saved.view ?? "") ? saved.view : "active");
  }

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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, name, client, location…"
          className="input w-72"
        />
        <select value={statusId ? `status:${statusId}` : filter} onChange={(e) => setFilter(e.target.value)} className="input w-auto">
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
          <SavedViews page="projects" config={config} onApply={apply} />
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
              <th className="px-3 py-2 font-medium hidden md:table-cell">Location</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Start</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap hidden sm:table-cell">End</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((job) => {
              const overdue =
                job.status === "out" && (parseDate(job.returnAt)?.getTime() ?? Infinity) < now;
              return (
                <tr key={job.id} onClick={() => navigate(`/projects/${job.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">{job.number}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-gray-900 truncate">{job.name}</span>
                      {job.expand?.client && <span className="text-xs text-gray-500 truncate">{job.expand.client.name}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden md:table-cell">{job.expand?.venue?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateTimeYear(job.startAt)}</td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap hidden sm:table-cell ${overdue ? "text-fault-ink font-medium" : "text-gray-600"}`}
                    title={overdue ? "Overdue back" : undefined}
                  >
                    {formatDateTimeYear(job.endAt)}
                  </td>
                  <td className="px-3 py-2">
                    <JobStatusBadge status={job.status} jobStatus={job.jobStatus} />
                  </td>
                </tr>
              );
            })}
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
