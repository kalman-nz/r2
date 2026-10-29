import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { CrewMember, CrewNeed, CrewPerson, CrewRole, Job, JobPeriod } from "./api";
import { orgFilter, withOrg } from "./currentOrg";
import { parseDate } from "./format";

// Crew rostering (pb_migrations/0041_crew_rostering.js): the organisation's
// crew roles, everyone who can be rostered, what each schedule item needs
// (crew needs) and who fills them (job_crew).

const NO_ROLES: CrewRole[] = [];
const NO_PEOPLE: CrewPerson[] = [];

export function useCrewRoles() {
  const { data: roles = NO_ROLES, isLoading } = useQuery({
    queryKey: ["crew-roles"],
    queryFn: () => pb.collection("crew_roles").getFullList<CrewRole>({ filter: orgFilter(), sort: "sortOrder,created" }),
    staleTime: 60_000,
  });
  return useMemo(() => ({ roles, isLoading, byId: new Map(roles.map((r) => [r.id, r])) }), [roles, isLoading]);
}

// Everyone on the crew list, archived included (the people a project had
// stay on it).
export function useCrewPeople() {
  const { data: people = NO_PEOPLE, isLoading } = useQuery({
    queryKey: ["crew-people"],
    queryFn: () => pb.collection("crew_people").getFullList<CrewPerson>({ filter: orgFilter(), sort: "name" }),
    staleTime: 30_000,
  });
  return useMemo(() => ({ people, isLoading, byId: new Map(people.map((p) => [p.id, p])) }), [people, isLoading]);
}

export function useJobCrewNeeds(jobId: string, enabled = true) {
  return useQuery({
    queryKey: ["crew-needs", jobId],
    queryFn: () => pb.collection("crew_needs").getFullList<CrewNeed>({ filter: pb.filter("job = {:job}", { job: jobId }), sort: "start,sortOrder,created" }),
    enabled,
  });
}

export function useJobCrew(jobId: string) {
  return useQuery({
    queryKey: ["job-crew", jobId],
    queryFn: () => pb.collection("job_crew").getFullList<CrewMember>({ filter: pb.filter("job = {:job}", { job: jobId }), sort: "sortOrder,created" }),
  });
}

// Someone's slot somewhere, with when and where, for spotting double
// bookings.
export type Booking = CrewMember & { expand?: { need?: CrewNeed & { expand?: { role?: CrewRole; period?: JobPeriod } }; job?: Job } };

// Every slot filled between from and to (ISO), across all projects.
export function useCrewBookings(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["job-crew", "bookings", from, to],
    queryFn: () =>
      pb.collection("job_crew").getFullList<Booking>({
        filter: orgFilter(pb.filter("need != '' && need.start <= {:to} && need.end >= {:from}", { from, to })),
        expand: "need,need.role,need.period,job",
      }),
    enabled: enabled && !!from && !!to,
  });
}

const ms = (value: string) => parseDate(value)?.getTime() ?? NaN;

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);
}

// Where else someone is while a need's on: "#1042 Pack in" for each
// overlapping slot that isn't this need.
export function clashesFor(bookings: Booking[], personId: string, need: Pick<CrewNeed, "id" | "start" | "end">): Booking[] {
  return bookings.filter((b) => b.person === personId && b.need !== need.id && b.expand?.need && overlaps(b.expand.need.start, b.expand.need.end, need.start, need.end));
}

export function clashLabel(b: Booking): string {
  const job = b.expand?.job;
  const what = b.expand?.need?.expand?.period?.name ?? b.expand?.need?.expand?.role?.name ?? "";
  return [job ? `#${job.number} ${job.name}` : "another project", what].filter(Boolean).join(" · ");
}

// Adding people to slots (or the whole project) and taking them off.
export function useRosterActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["job-crew"] });
  return {
    assign: async (jobId: string, personId: string, needId = "", role = "") => {
      await pb.collection("job_crew").create(withOrg({ job: jobId, person: personId, need: needId, function: role.trim() }));
      await refresh();
    },
    unassign: async (crewId: string) => {
      await pb.collection("job_crew").delete(crewId);
      await refresh();
    },
    refresh,
  };
}
