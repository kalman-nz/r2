import type { CrewNeedDraft, JobPeriod, PeriodKind } from "./api";

export interface InlineCrewDraft {
  role: string;
  level: string;
  quantity: number;
}

export async function createPeriodWithCrew<TPeriod extends Pick<JobPeriod, "id">>({
  jobId,
  kind,
  crew,
  createPeriod,
  addCrewNeeds,
}: {
  jobId: string;
  kind: PeriodKind;
  crew: InlineCrewDraft[];
  createPeriod: () => Promise<TPeriod>;
  addCrewNeeds: (jobId: string, needs: CrewNeedDraft[]) => Promise<unknown>;
}): Promise<{ period: TPeriod; crewError?: unknown }> {
  const period = await createPeriod();
  if (kind !== "other" || crew.length === 0) return { period };

  try {
    await addCrewNeeds(
      jobId,
      crew.map(({ role, level, quantity }) => ({
        period: period.id,
        role,
        level,
        quantity,
        customTimes: false,
        notes: "",
      })),
    );
    return { period };
  } catch (crewError) {
    return { period, crewError };
  }
}
