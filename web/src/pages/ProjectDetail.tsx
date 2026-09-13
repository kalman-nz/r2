import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, pick, type RentmanRecord } from "../lib/api";
import RecordFields from "../components/RecordFields";

export default function ProjectDetail() {
  const { id = "" } = useParams();
  const { data: project, isLoading, error } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
  });
  const { data: equipment } = useQuery({
    queryKey: ["project-equipment", id],
    queryFn: () => api.getProjectEquipment(id),
  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Link to="/projects" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Projects
      </Link>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load this project: {(error as Error).message}</p>}

      {project && (
        <>
          <h1 className="text-xl font-semibold text-gray-900">{pick(project, "name", "displayname", "title")}</h1>

          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">Project details</h2>
            <RecordFields record={project} />
          </section>

          {project.subprojects?.length > 0 && (
            <section className="card p-4">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">Subprojects</h2>
              <ul className="flex flex-col gap-1 text-sm text-gray-700">
                {project.subprojects.map((s: RentmanRecord) => (
                  <li key={s.id}>{pick(s, "name", "displayname", "title")}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">Planned equipment</h2>
            {!equipment ? (
              <p className="text-gray-500 text-sm">Loading…</p>
            ) : equipment.lines.length === 0 ? (
              <p className="text-gray-500 text-sm">No equipment lines returned for this project.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {equipment.lines.map((line) => {
                  const serialIds = String(line.serial_number_ids ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  return (
                    <li key={line.id} className="flex flex-col gap-1">
                      <div className="flex justify-between text-gray-700">
                        <span>{pick(line, "name", "equipment_name", "displayname")}</span>
                        <span className="text-gray-500">×{pick(line, "quantity", "qty")}</span>
                      </div>
                      {serialIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {serialIds.map((sid) => (
                            <Link
                              key={sid}
                              to={`/assets/${sid}`}
                              className="text-xs font-mono text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5"
                            >
                              #{sid}
                            </Link>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
