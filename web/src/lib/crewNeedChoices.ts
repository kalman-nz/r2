import type { CrewNeed, CrewRole } from "./api";
import { levelsOf } from "./crewLogic";
import { parseDate } from "./format";

export type CrewNeedChoice = Pick<CrewNeed, "role" | "level">;

export function needsAtTime(needs: CrewNeed[], periodId: string, start: string, end: string, excludeId = ""): CrewNeedChoice[] {
  const startMs = parseDate(start)?.getTime();
  const endMs = parseDate(end)?.getTime();
  if (startMs === undefined || endMs === undefined) return [];
  return needs.filter((need) =>
    need.period === periodId && need.id !== excludeId &&
    parseDate(need.start)?.getTime() === startMs && parseDate(need.end)?.getTime() === endMs,
  );
}

export function choiceTaken(choices: CrewNeedChoice[], role: string, level: string): boolean {
  return choices.some((choice) => choice.role === role && choice.level === level);
}

export function availableLevels(role: CrewRole, choices: CrewNeedChoice[]): string[] {
  return ["", ...levelsOf(role)].filter((level) => !choiceTaken(choices, role.id, level));
}

export function firstCrewChoice(roles: CrewRole[], choices: CrewNeedChoice[]): CrewNeedChoice | undefined {
  for (const role of roles) {
    const level = availableLevels(role, choices)[0];
    if (level !== undefined) return { role: role.id, level };
  }
}
