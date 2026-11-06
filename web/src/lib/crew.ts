import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { CrewMember, CrewNeed, CrewPerson, CrewRole } from "./api";
import { orgFilter, withOrg } from "./currentOrg";
import { clashesFor, clashLabel, fitFor, levelOf, levelsOf, overlaps, skillName, skillNames } from "./crewLogic";
import type { Booking } from "./crewLogic";

export { clashesFor, clashLabel, fitFor, levelOf, levelsOf, overlaps, skillName, skillNames };
export type { Booking };

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
