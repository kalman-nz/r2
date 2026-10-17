import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Contact, Job, JobStatus, Venue } from "../lib/api";
import { formatDateTime, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { JobStatusBadge } from "../components/StatusBadge";
import { JOB_STATUSES } from "../lib/statuses";
import { orgFilter } from "../lib/currentOrg";

type JobWithExpand = Job & { expand?: { client?: Contact; venue?: Venue } };

// "Current" is what a warehouse cares about day to day: anything not yet
// finished. Past/finished jobs are one filter away.
type Filter = "current" | "all" | JobStatus;

export default function JobsList() {
  const navigate = useNavigate();
  const { can } = useRole();
  const [filter, setFilter] = useState<Filter>("current");
  const [search, setSearch] = useState("");

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["jobs", filter],
    queryFn: () =>
      pb.collection("jobs").getFullList<JobWithExpand>({
        sort: filter === "current" ? "prepAt" : "-prepAt",
        expand: "client,venue",
        filter: orgFilter(
          filter === "current"
            ? "status != 'returned' && status != 'cancelled'"
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

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Jobs</h1>
          <p className="text-xs text-gray-500">{filtered.length.toLocaleString()} shown</p>
        </div>
        {can("jobs.create") && (
          <Link to="/jobs/new" className="btn-primary">
            New job
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, name, client, venue…"
          className="input w-72"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="input w-auto">
          <option value="current">Current (not returned or cancelled)</option>
          <option value="all">All jobs</option>
          {JOB_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load jobs: {(error as Error).message}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2 font-medium w-16">#</th>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium hidden md:table-cell">Venue</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Prep</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap hidden sm:table-cell">Return</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((job) => {
              const overdue =
                job.status === "out" && (parseDate(job.returnAt)?.getTime() ?? Infinity) < now;
              return (
                <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2 text-gray-500 tabular-nums">{job.number}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-gray-900 truncate">{job.name}</span>
                      {job.expand?.client && <span className="text-xs text-gray-500 truncate">{job.expand.client.name}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden md:table-cell">{job.expand?.venue?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateTime(job.prepAt)}</td>
                  <td
                    className={`px-3 py-2 whitespace-nowrap hidden sm:table-cell ${overdue ? "text-[#fc3465] font-medium" : "text-gray-600"}`}
                    title={overdue ? "Overdue back" : undefined}
                  >
                    {formatDateTime(job.returnAt)}
                  </td>
                  <td className="px-3 py-2">
                    <JobStatusBadge status={job.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">
            {jobs.length === 0 ? "No jobs here yet." : "No jobs match your search."}
          </p>
        )}
      </div>
    </div>
  );
}
