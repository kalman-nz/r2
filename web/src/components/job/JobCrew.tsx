import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { JobSummary } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatPeriod } from "../../lib/format";
import { useAuthRecord } from "../../lib/pocketbase";
import { clashesFor, useCrewBookings, useCrewPeople, useCrewRoles, useJobCrew, useJobCrewNeeds, useRosterActions } from "../../lib/crew";
import { NeedForm, NeedSlots } from "../crew/Needs";
import PersonPicker from "../crew/PersonPicker";
import { useToast } from "../ToastProvider";

// A project's Crew tab, its rostering window: each schedule item with the
// crew it needs (3× Technical labour) and who's filling each, then anyone
// on the whole project (a project manager, say). Planners (jobs.edit) set
// the needs and roster people; double bookings across projects show as
// they're made. The Rostering page does the same across every project.
export default function JobCrew({ summary, canEdit }: { summary: JobSummary; canEdit: boolean }) {
  const { job } = summary;
  const me = useAuthRecord();
  const { showToast } = useToast();
  const { roles, byId: roleById } = useCrewRoles();
  const { people, byId: personById } = useCrewPeople();
  const { data: needs = [] } = useJobCrewNeeds(job.id);
  const { data: crew = [] } = useJobCrew(job.id);
  const { assign, unassign } = useRosterActions();
  // The need being changed, or the schedule item a need's being added to.
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [wholeRole, setWholeRole] = useState("");

  const subName = (id: string) => summary.subprojects?.find((sp) => sp.id === id)?.name ?? "";
  const periods = useMemo(() => [...summary.periods].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)), [summary.periods]);

  // Everyone's slots over this project's crew times, for double bookings.
  const span = needs.reduce<{ from: string; to: string }>(
    (s, n) => ({ from: !s.from || n.start < s.from ? n.start : s.from, to: !s.to || n.end > s.to ? n.end : s.to }),
    { from: "", to: "" },
  );
  const { data: bookings = [] } = useCrewBookings(span.from, span.to, needs.length > 0);

  const slots = needs.reduce((n, x) => n + x.quantity, 0);
  const filled = needs.reduce((n, x) => n + Math.min(x.quantity, crew.filter((c) => c.need === x.id).length), 0);
  const doubleBooked = crew.filter((c) => {
    const need = needs.find((n) => n.id === c.need);
    return need && clashesFor(bookings, c.person, need).length > 0;
  }).length;
  const whole = crew.filter((c) => !c.need);

  async function run(work: () => Promise<void>) {
    try {
      await work();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Crew</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {slots === 0
              ? "Say what each schedule item needs, like 1× Audio operator and 3× Technical labour for the pack in, then pick who's doing it."
              : `${filled} of ${slots} slot${slots === 1 ? "" : "s"} filled${doubleBooked > 0 ? ` · ${doubleBooked} double-booked` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/rostering" className="text-signal-ink hover:text-signal-ink-hover font-medium">
            Rostering
          </Link>
          <Link to="/crew" className="text-signal-ink hover:text-signal-ink-hover font-medium">
            Crew list
          </Link>
        </div>
      </section>

      {periods.map((p) => {
        const here = needs.filter((n) => n.period === p.id);
        return (
          <section key={p.id} className="card px-4 py-3 flex flex-col">
            <div className="flex items-baseline justify-between gap-3 flex-wrap pb-1">
              <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-900">
                  {p.subproject && <span className="text-gray-500 font-normal">{subName(p.subproject)} · </span>}
                  {p.name}
                </h3>
                <span className="text-xs text-gray-500">{formatPeriod(p.start, p.end)}</span>
              </div>
              {canEdit && adding !== p.id && (
                <button
                  onClick={() => {
                    setEditing(null);
                    setAdding(p.id);
                  }}
                  className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover"
                >
                  + Crew need
                </button>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {here.map((n) =>
                editing === n.id ? (
                  <NeedForm key={n.id} jobId={job.id} period={p} need={n} roles={roles} onDone={() => setEditing(null)} />
                ) : (
                  <NeedSlots
                    key={n.id}
                    need={n}
                    role={roleById.get(n.role)}
                    period={p}
                    crew={crew.filter((c) => c.need === n.id)}
                    people={people}
                    peopleById={personById}
                    bookings={bookings}
                    canEdit={canEdit}
                    onEdit={() => {
                      setAdding(null);
                      setEditing(n.id);
                    }}
                  />
                ),
              )}
              {adding === p.id && <NeedForm jobId={job.id} period={p} roles={roles} onDone={() => setAdding(null)} />}
              {here.length === 0 && adding !== p.id && <p className="text-xs text-gray-400 py-2">No crew needed.</p>}
            </div>
          </section>
        );
      })}

      <section className="card px-4 py-3 flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Whole project</h3>
          <p className="text-xs text-gray-500">People on all of it rather than a schedule item, like the project manager.</p>
        </div>
        {whole.length === 0 && <p className="text-xs text-gray-400">Nobody.</p>}
        {whole.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 text-sm">
            <span className="text-gray-900">
              {personById.get(c.person)?.name ?? "Someone"}
              {c.user && c.user === me?.id && <span className="text-xs text-gray-400"> (you)</span>}
            </span>
            {c.function && <span className="text-xs text-gray-500">{c.function}</span>}
            {canEdit && (
              <button
                onClick={() => run(() => unassign(c.id))}
                className="w-5 h-5 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label="Take them off the project"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <input
              value={wholeRole}
              onChange={(e) => setWholeRole(e.target.value)}
              placeholder="Doing what? e.g. Project manager"
              maxLength={60}
              className="input py-1.5 w-60"
            />
            <PersonPicker
              people={people}
              exclude={new Set(whole.map((c) => c.person))}
              onPick={(person) =>
                run(async () => {
                  await assign(job.id, person.id, "", wholeRole);
                  setWholeRole("");
                })
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}
