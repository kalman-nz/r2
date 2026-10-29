import { useState } from "react";
import { Link } from "react-router-dom";
import type { CrewMember, JobSummary } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useOrg } from "../../lib/org";
import { useAuthRecord } from "../../lib/pocketbase";
import { useCrewPeople, useCrewRoles, useJobCrew, useJobCrewNeeds, useRosterActions } from "../../lib/crew";
import PersonPicker from "../crew/PersonPicker";
import { useToast } from "../ToastProvider";

// Who's on a project, beside it: each person once, with what they're doing.
// With Crew rostering on, they're rostered on the Crew tab (by schedule
// item and crew role); without it, planners add people to the whole
// project here. They see it under "My projects" on their dashboards.
export default function CrewCard({ summary, canEdit }: { summary: JobSummary; canEdit: boolean }) {
  const jobId = summary.job.id;
  const me = useAuthRecord();
  const { feature } = useOrg();
  const rostering = feature("crew");
  const { showToast } = useToast();
  const { people, byId: personById } = useCrewPeople();
  const { byId: roleById } = useCrewRoles();
  const { data: needs = [] } = useJobCrewNeeds(jobId, rostering);
  const { data: crew = [] } = useJobCrew(jobId);
  const { assign, unassign } = useRosterActions();
  const [role, setRole] = useState("");

  const periodName = (id: string) => summary.periods.find((p) => p.id === id)?.name ?? "";
  // What someone's doing: their role on each slot, or what they were added as.
  const doing = (c: CrewMember) => {
    const need = needs.find((n) => n.id === c.need);
    if (!need) return c.function;
    return [roleById.get(need.role)?.name, periodName(need.period)].filter(Boolean).join(", ");
  };
  const byPerson = new Map<string, CrewMember[]>();
  for (const c of crew) byPerson.set(c.person, [...(byPerson.get(c.person) ?? []), c]);
  const slots = needs.reduce((n, x) => n + x.quantity, 0);
  const open = needs.reduce((n, x) => n + Math.max(0, x.quantity - crew.filter((c) => c.need === x.id).length), 0);

  async function run(work: () => Promise<void>) {
    try {
      await work();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-500">Crew</h2>
        {rostering && (
          <Link to={`/projects/${jobId}?tab=crew`} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
            {canEdit ? "Roster crew" : "See crew"}
          </Link>
        )}
      </div>
      {rostering && slots > 0 && <p className={`text-xs ${open > 0 ? "text-amber-700" : "text-gray-500"}`}>{open > 0 ? `${open} of ${slots} slots to fill` : `All ${slots} slots filled`}</p>}
      {byPerson.size === 0 && <p className="text-xs text-gray-500">Nobody's on it yet.</p>}
      {[...byPerson].map(([personId, theirs]) => (
        <div key={personId} className="group flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-gray-900 truncate">
              {personById.get(personId)?.name ?? "Someone"}
              {theirs[0].user && theirs[0].user === me?.id && <span className="text-xs text-gray-400"> (you)</span>}
            </span>
            {theirs.map(doing).filter(Boolean).length > 0 && (
              <span className="block text-xs text-gray-500 truncate">{theirs.map(doing).filter(Boolean).join(" · ")}</span>
            )}
          </span>
          {canEdit && !rostering && (
            <button
              onClick={() => run(async () => Promise.all(theirs.map((c) => unassign(c.id))).then(() => undefined))}
              className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Take them off the crew"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {canEdit && !rostering && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Doing what? e.g. Sound op" maxLength={60} className="input py-1.5 flex-1 min-w-0" />
          <PersonPicker
            people={people}
            exclude={new Set(crew.filter((c) => !c.need).map((c) => c.person))}
            onPick={(p) =>
              run(async () => {
                await assign(jobId, p.id, "", role);
                setRole("");
              })
            }
          />
        </div>
      )}
    </section>
  );
}
