import type { CrewMember, CrewNeed, CrewPerson, CrewRole, Job, JobPeriod } from "./api";
import { parseDate } from "./format.ts";

export type Booking = CrewMember & { expand?: { need?: CrewNeed & { expand?: { role?: CrewRole; period?: JobPeriod } }; job?: Job } };

const ms = (value: string) => parseDate(value)?.getTime() ?? NaN;

// Treat bookings as half-open ranges so back-to-back work does not clash.
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);
}

// Exclude the need being shown; only another booking for this person clashes.
export function clashesFor(bookings: Booking[], personId: string, need: Pick<CrewNeed, "id" | "start" | "end">): Booking[] {
  return bookings.filter((b) => b.person === personId && b.need !== need.id && b.expand?.need && overlaps(b.expand.need.start, b.expand.need.end, need.start, need.end));
}

export function clashLabel(b: Booking): string {
  const job = b.expand?.job;
  const what = b.expand?.need?.expand?.period?.name ?? b.expand?.need?.expand?.role?.name ?? "";
  return [job ? `#${job.number} ${job.name}` : "another project", what].filter(Boolean).join(" · ");
}

export function levelsOf(role?: CrewRole | null): string[] {
  return Array.isArray(role?.levels) ? role.levels.filter((l): l is string => typeof l === "string" && l !== "") : [];
}

export function levelOf(person: CrewPerson, roleId: string): string {
  const levels = person.skillLevels;
  return levels && typeof levels === "object" && typeof levels[roleId] === "string" ? levels[roleId] : "";
}

export function skillName(role: CrewRole, level: string): string {
  return level ? `${role.name} ${level}` : role.name;
}

export function skillNames(person: CrewPerson, roleById: Map<string, CrewRole>): string[] {
  return person.skills
    .map((id) => roleById.get(id))
    .filter((r): r is CrewRole => !!r)
    .map((r) => skillName(r, levelOf(person, r.id)));
}

// Role levels are ordered lowest first; a slot's level is its minimum.
export function fitFor(person: CrewPerson, role: CrewRole | undefined, level: string): "fits" | "below" | "no" {
  if (!role || !person.skills.includes(role.id)) return "no";
  if (!level) return "fits";
  const levels = levelsOf(role);
  const theirs = levels.indexOf(levelOf(person, role.id));
  return theirs !== -1 && theirs >= levels.indexOf(level) ? "fits" : "below";
}
