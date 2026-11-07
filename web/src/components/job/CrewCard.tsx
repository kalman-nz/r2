import { Link } from "react-router-dom";
import type { CrewMember, JobSummary } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { useAuthRecord } from "../../lib/pocketbase";
import { useCrewPeople, useCrewRoles, useJobCrew, useJobCrewNeeds } from "../../lib/crew";
import ArrowLink from "../ArrowLink";

// Who's on a project, beside it: each person once, with what they're doing.
// People are rostered on the Crew tab through crew needs and schedule items.
export default function CrewCard({ summary, canEdit }: { summary: JobSummary; canEdit: boolean }) {
  const jobId = summary.job.id;
  const me = useAuthRecord();
  const { feature } = useOrg();
  const rostering = feature("crew");
  const { byId: personById } = useCrewPeople();
  const { byId: roleById } = useCrewRoles();
  const { data: needs = [] } = useJobCrewNeeds(jobId);
  const { data: crew = [] } = useJobCrew(jobId);

  const periodName = (id: string) => summary.periods.find((p) => p.id === id)?.name ?? "";
  // What someone's doing: their crew need's role and schedule item.
  const doing = (c: CrewMember) => {
    const need = needs.find((n) => n.id === c.need);
    if (!need) return "";
    return [roleById.get(need.role)?.name, periodName(need.period)].filter(Boolean).join(", ");
  };
  const byPerson = new Map<string, CrewMember[]>();
  for (const c of crew) {
    if (needs.some((n) => n.id === c.need)) byPerson.set(c.person, [...(byPerson.get(c.person) ?? []), c]);
  }
  const slots = needs.reduce((n, x) => n + x.quantity, 0);
  const open = needs.reduce((n, x) => n + Math.max(0, x.quantity - crew.filter((c) => c.need === x.id).length), 0);

  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="eyebrow text-gray-500">Crew</h2>
        {rostering && (
          <ArrowLink to={`/projects/${jobId}?tab=crew`}>{canEdit ? "Roster crew" : "See crew"}</ArrowLink>
        )}
      </div>
      {rostering && slots > 0 && <p className={`text-xs ${open > 0 ? "text-amber-700" : "text-gray-500"}`}>{open > 0 ? `${open} of ${slots} slots to fill` : `All ${slots} slots filled`}</p>}
      {byPerson.size === 0 && <p className="text-gray-500">Nobody yet.</p>}
      {[...byPerson].map(([personId, theirs]) => (
        <div key={personId} className="group flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-gray-900 truncate">
              <Link to={`/crew/${personId}`} className="hover:underline">
                {personById.get(personId)?.name ?? "Someone"}
              </Link>
              {theirs[0].user && theirs[0].user === me?.id && <span className="text-xs text-gray-400"> (you)</span>}
            </span>
            {theirs.map(doing).filter(Boolean).length > 0 && (
              <span className="block text-xs text-gray-500 truncate">{theirs.map(doing).filter(Boolean).join(" · ")}</span>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}
