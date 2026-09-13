import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, pick, type RentmanRecord } from "../lib/api";
import RefreshButton from "../components/RefreshButton";

export default function ProjectsList() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    // See EquipmentList.tsx — matches the server's Rentman cache TTL rather
    // than polling faster than that data can actually change.
    refetchInterval: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const projects = data?.data ?? [];
    if (!search.trim()) return projects;
    const term = search.toLowerCase();
    return projects.filter((p) => JSON.stringify(p).toLowerCase().includes(term));
  }, [data, search]);

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="input w-72"
          />
          <RefreshButton queryKeys={[["projects"]]} />
        </div>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && (
        <p className="text-red-600 text-sm">
          Couldn't load projects: {(error as Error).message}. Check RENTMAN_API_TOKEN in server/.env.
        </p>
      )}

      <div className="card divide-y divide-gray-100 overflow-hidden">
        {filtered.map((project: RentmanRecord) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-sm"
          >
            <span className="font-medium text-gray-900">{pick(project, "name", "displayname", "title")}</span>
            <span className="text-gray-500 text-xs">
              {pick(project, "planperiod_start", "startdate", "date_from")}
            </span>
          </Link>
        ))}
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm">No projects found.</p>
        )}
      </div>
    </div>
  );
}
