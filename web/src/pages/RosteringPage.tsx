import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { CrewNeed, CrewRole, Job, JobPeriod, ViewConfig } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { formatDateTime, formatPeriod, formatTime, localDateInput, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { asString } from "../lib/views";
import { clashesFor, clashLabel, useCrewBookings, useCrewPeople, useCrewRoles, type Booking } from "../lib/crew";
import FiltersMenu, { FilterField } from "../components/FiltersMenu";
import PageViews from "../components/PageViews";
import Segmented from "../components/Segmented";
import { NeedSlots } from "../components/crew/Needs";

// Rostering across every project: the crew each schedule item needs over
// the next days, with who's filling it, and everyone's bookings by person
// to see who's free. Slots are filled right here (planners: jobs.edit), and
// double bookings show as they're made. A project's own Crew tab does the
// same for one project.

type NeedRow = CrewNeed & { expand?: { job?: Job; period?: JobPeriod; role?: CrewRole } };
type Mode = "needs" | "people";

const DAY = 24 * 60 * 60 * 1000;
const LENGTHS = [
  { value: 7, label: "1 week" },
  { value: 14, label: "2 weeks" },
  { value: 28, label: "4 weeks" },
];
const SHOWS = [
  { value: "all", label: "Everything" },
  { value: "open", label: "Slots to fill" },
  { value: "clash", label: "Double bookings" },
];

const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
const dayKey = (value: string) => {
  const d = parseDate(value);
  return d ? localDateInput(d) : "";
};
const dayHeading = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

const DEFAULT_VIEW: ViewConfig = { mode: "needs", days: 14, show: "all", role: "" };

export default function RosteringPage() {
  const { can } = useRole();
  const canEdit = can("jobs.edit");
  const { roles, byId: roleById } = useCrewRoles();
  const { people, byId: personById } = useCrewPeople();
  const [from, setFrom] = useState(() => midnight(Date.now()));
  const [days, setDays] = useState(14);
  const [mode, setMode] = useState<Mode>("needs");
  const [show, setShow] = useState("all");
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const to = from + days * DAY;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const { data: needs = [], isLoading } = useQuery({
    queryKey: ["crew-needs", "range", fromIso, toIso],
    queryFn: () =>
      pb.collection("crew_needs").getFullList<NeedRow>({
        filter: orgFilter(pb.filter("start <= {:to} && end >= {:from} && job.status != 'cancelled'", { from: fromIso, to: toIso })),
        sort: "start,sortOrder",
        expand: "job,period,role",
      }),
  });
  const { data: bookings = [] } = useCrewBookings(fromIso, toIso);

  const crewOf = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) map.set(b.need, [...(map.get(b.need) ?? []), b]);
    return map;
  }, [bookings]);

  const term = search.trim().toLowerCase();
  const shownNeeds = needs.filter((n) => {
    const crew = crewOf.get(n.id) ?? [];
    if (role && n.role !== role) return false;
    if (show === "open" && crew.length >= n.quantity) return false;
    if (show === "clash" && !crew.some((c) => clashesFor(bookings, c.person, n).length > 0)) return false;
    if (term) {
      const job = n.expand?.job;
      const names = crew.map((c) => personById.get(c.person)?.name ?? "");
      const hay = [job ? `#${job.number} ${job.name}` : "", n.expand?.period?.name ?? "", n.expand?.role?.name ?? "", ...names];
      if (!hay.some((v) => v.toLowerCase().includes(term))) return false;
    }
    return true;
  });
  const byDay = new Map<string, NeedRow[]>();
  for (const n of shownNeeds) {
    const key = dayKey(n.start < fromIso ? fromIso : n.start);
    byDay.set(key, [...(byDay.get(key) ?? []), n]);
  }
  const slots = needs.reduce((s, n) => s + n.quantity, 0);
  const open = needs.reduce((s, n) => s + Math.max(0, n.quantity - (crewOf.get(n.id)?.length ?? 0)), 0);

  const settings: ViewConfig = { mode, days, show, role };
  function applySettings(s: ViewConfig) {
    setMode(s.mode === "people" ? "people" : "needs");
    setDays(LENGTHS.some((l) => l.value === s.days) ? (s.days as number) : 14);
    setShow(SHOWS.some((x) => x.value === s.show) ? (s.show as string) : "all");
    setRole(asString(s.role));
  }
  const activeFilters = (show !== "all" ? 1 : 0) + (role ? 1 : 0);

  const rangeLabel = `${new Date(from).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(to - 1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Rostering</h1>
          <p className="text-xs text-gray-500">
            {isLoading ? "Loading…" : slots === 0 ? `No crew needed, ${rangeLabel}` : `${slots - open} of ${slots} slots filled, ${rangeLabel}`}
            {open > 0 && <span className="text-amber-700"> · {open} to fill</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setFrom(midnight(from - days * DAY))} className="btn-secondary px-2.5" aria-label="Earlier">
            ‹
          </button>
          <button onClick={() => setFrom(midnight(Date.now()))} className="btn-secondary">
            Today
          </button>
          <button onClick={() => setFrom(midnight(from + days * DAY))} className="btn-secondary px-2.5" aria-label="Later">
            ›
          </button>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input w-auto" aria-label="How long">
            {LENGTHS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <PageViews page="rostering" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects, people, roles…" className="input flex-1 min-w-40 max-w-72" />
        <Segmented
          label="Show by"
          value={mode}
          onChange={setMode}
          options={[
            { value: "needs", label: "By day" },
            { value: "people", label: "By person" },
          ]}
        />
        <div className="ml-auto">
          <FiltersMenu
            active={activeFilters}
            onReset={() => {
              setShow("all");
              setRole("");
            }}
          >
            <FilterField label="Show">
              <select value={show} onChange={(e) => setShow(e.target.value)} className="input">
                {SHOWS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Crew role">
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
                <option value="">Any role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FilterField>
          </FiltersMenu>
        </div>
      </div>

      {mode === "needs" ? (
        <div className="flex flex-col gap-3">
          {[...byDay].map(([key, list]) => (
            <section key={key} className="card px-4 py-3">
              <h2 className="eyebrow text-gray-500 pb-1">{dayHeading(key)}</h2>
              <div className="divide-y divide-gray-100">
                {list.map((n) => {
                  const job = n.expand?.job;
                  return (
                    <NeedSlots
                      key={n.id}
                      need={n}
                      role={n.expand?.role ?? roleById.get(n.role)}
                      crew={crewOf.get(n.id) ?? []}
                      people={people}
                      peopleById={personById}
                      bookings={bookings}
                      canEdit={canEdit}
                      heading={
                        <span className="flex items-baseline gap-2 min-w-0 w-full sm:w-auto">
                          <span className="text-xs tabular-nums text-gray-500 w-28 shrink-0" title={formatPeriod(n.start, n.end)}>
                            {formatTime(n.start)} – {formatTime(n.end)}
                          </span>
                          <Link to={`/projects/${n.job}?tab=crew`} className="text-sm text-gray-900 hover:text-signal-ink truncate">
                            {job ? (
                              <>
                                <span className="font-mono text-xs text-gray-500">#{job.number}</span> {job.name}
                              </>
                            ) : (
                              "Project"
                            )}
                          </Link>
                          {n.expand?.period && <span className="text-xs text-gray-500 truncate">{n.expand.period.name}</span>}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
          {!isLoading && byDay.size === 0 && (
            <p className="card px-4 py-6 text-sm text-gray-500 text-center">
              {needs.length === 0 ? "No crew needed in these dates. Add crew needs to a project's schedule items." : "Nothing matches."}
            </p>
          )}
        </div>
      ) : (
        <ByPerson people={people.filter((p) => !p.archived && (!role || p.skills.includes(role)) && (!term || p.name.toLowerCase().includes(term)))} bookings={bookings} roleById={roleById} />
      )}
    </div>
  );
}

// Each person's bookings in the dates, soonest first, with their double
// bookings marked: who's free is everyone with nothing on.
function ByPerson({ people, bookings, roleById }: { people: ReturnType<typeof useCrewPeople>["people"]; bookings: Booking[]; roleById: Map<string, CrewRole> }) {
  const rows = people
    .map((p) => ({
      person: p,
      theirs: bookings.filter((b) => b.person === p.id && b.expand?.need).sort((a, b) => a.expand!.need!.start.localeCompare(b.expand!.need!.start)),
    }))
    .sort((a, b) => b.theirs.length - a.theirs.length || a.person.name.localeCompare(b.person.name));
  return (
    <div className="card divide-y divide-gray-100">
      {rows.map(({ person, theirs }) => (
        <div key={person.id} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] gap-x-4 gap-y-1">
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-900">{person.name}</span>
            <span className="block text-xs text-gray-500 truncate">{person.skills.map((id) => roleById.get(id)?.name).filter(Boolean).join(", ") || (person.user ? "Member" : "Freelancer")}</span>
          </div>
          <div className="flex flex-col gap-0.5 text-xs min-w-0">
            {theirs.length === 0 && <span className="text-gray-400 pt-0.5">Free</span>}
            {theirs.map((b) => {
              const need = b.expand!.need!;
              const clash = clashesFor(bookings, person.id, need).length > 0;
              return (
                <Link key={b.id} to={`/projects/${b.job}?tab=crew`} className="flex items-baseline gap-2 min-w-0 hover:text-signal-ink">
                  <span className={`tabular-nums shrink-0 ${clash ? "text-amber-700 font-medium" : "text-gray-600"}`}>{formatDateTime(need.start)}</span>
                  <span className="text-gray-800 truncate">
                    {clashLabel(b)}
                    <span className="text-gray-500"> · {need.expand?.role?.name ?? roleById.get(need.role)?.name}</span>
                  </span>
                  {clash && <span className="text-amber-700 shrink-0">double-booked</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">Nobody matches.</p>}
    </div>
  );
}
