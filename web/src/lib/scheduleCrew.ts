import type { CrewNeedDraft, JobPeriod } from "./api";

export interface InlineCrewDraft {
  role: string;
  level: string;
  quantity: number;
}

export async function createPeriodWithCrew<TPeriod extends Pick<JobPeriod, "id">>({
  jobId,
  crew,
  createPeriod,
  addCrewNeeds,
}: {
  jobId: string;
  crew: InlineCrewDraft[];
  createPeriod: () => Promise<TPeriod>;
  addCrewNeeds: (jobId: string, needs: CrewNeedDraft[]) => Promise<unknown>;
}): Promise<{ period: TPeriod; crewError?: unknown }> {
  const period = await createPeriod();
  if (crew.length === 0) return { period };

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
