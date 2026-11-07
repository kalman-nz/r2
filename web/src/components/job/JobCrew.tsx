import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { JobSummary } from "../../lib/api";
import { formatPeriod } from "../../lib/format";
import { clashesFor, useCrewBookings, useCrewPeople, useCrewRoles, useJobCrew, useJobCrewNeeds } from "../../lib/crew";
import { NeedForm, NeedSlots } from "../crew/Needs";

// A project's Crew tab, its rostering window: each schedule item with the
// crew it needs (3× Technical labour) and who's filling each. Planners (jobs.edit) set
// the needs and roster people; double bookings across projects show as
// they're made. The Rostering page does the same across every project.
export default function JobCrew({ summary, canEdit }: { summary: JobSummary; canEdit: boolean }) {
  const { job } = summary;
  const { roles, byId: roleById } = useCrewRoles();
  const { people, byId: personById } = useCrewPeople();
  const { data: needs = [] } = useJobCrewNeeds(job.id);
  const { data: crew = [] } = useJobCrew(job.id);
  // The need being changed, or the schedule item a need's being added to.
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const subName = (id: string) => summary.subprojects?.find((sp) => sp.id === id)?.name ?? "";
  const periods = useMemo(
    () => summary.periods.filter((period) => period.kind === "other").sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    [summary.periods],
  );
  const eligibleNeeds = useMemo(() => needs.filter((need) => periods.some((period) => period.id === need.period)), [needs, periods]);

  // Everyone's slots over this project's crew times, for double bookings.
  const span = eligibleNeeds.reduce<{ from: string; to: string }>(
    (s, n) => ({ from: !s.from || n.start < s.from ? n.start : s.from, to: !s.to || n.end > s.to ? n.end : s.to }),
    { from: "", to: "" },
  );
  const { data: bookings = [] } = useCrewBookings(span.from, span.to, eligibleNeeds.length > 0);

  const slots = eligibleNeeds.reduce((n, x) => n + x.quantity, 0);
  const filled = eligibleNeeds.reduce((n, x) => n + Math.min(x.quantity, crew.filter((c) => c.need === x.id).length), 0);
  const doubleBooked = crew.filter((c) => {
    const need = eligibleNeeds.find((n) => n.id === c.need);
    return need && clashesFor(bookings, c.person, need).length > 0;
  }).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600">
          {slots === 0 ? (
            "No crew needed yet."
          ) : (
            <>
              {filled} of {slots} slot{slots === 1 ? "" : "s"} filled
              {doubleBooked > 0 && <span className="text-amber-700"> · {doubleBooked} double-booked</span>}
            </>
          )}
        </p>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/rostering" className="text-signal-ink hover:text-signal-ink-hover font-medium">
            Rostering
          </Link>
          <Link to="/crew" className="text-signal-ink hover:text-signal-ink-hover font-medium">
            Crew list
          </Link>
        </div>
      </div>

      {periods.map((p) => {
        const here = eligibleNeeds.filter((n) => n.period === p.id);
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
                  <NeedForm key={n.id} jobId={job.id} period={p} need={n} roles={roles} needs={eligibleNeeds} onDone={() => setEditing(null)} />
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
              {adding === p.id && <NeedForm jobId={job.id} period={p} roles={roles} needs={eligibleNeeds} onDone={() => setAdding(null)} />}
              {here.length === 0 && adding !== p.id && <p className="text-xs text-gray-400 py-2">No crew needed.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
