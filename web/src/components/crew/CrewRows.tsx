import type { CrewRole } from "../../lib/api";
import { firstCrewChoice } from "../../lib/crewNeedChoices";
import { CrewNeedFields } from "./Needs";

export interface CrewDraft {
  key: number;
  role: string;
  level: string;
  quantity: number;
}

let crewKey = 0;

export default function CrewRows({ roles, crew, onChange }: { roles: CrewRole[]; crew: CrewDraft[]; onChange: (crew: CrewDraft[]) => void }) {
  const set = (key: number, patch: Partial<CrewDraft>) => onChange(crew.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const next = firstCrewChoice(roles, crew);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-gray-500">Crew needed</span>
      {crew.map((c) => (
        <div key={c.key} className="flex items-center gap-1.5 flex-wrap">
          <CrewNeedFields value={c} roles={roles} onChange={(patch) => set(c.key, patch)} taken={crew.filter((other) => other.key !== c.key)} />
          <button
            type="button"
            onClick={() => onChange(crew.filter((x) => x.key !== c.key))}
            className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100"
            aria-label="Remove this crew role"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => next && onChange([...crew, { key: ++crewKey, ...next, quantity: 1 }])}
        disabled={!next}
        className="self-start text-xs font-medium text-signal-ink hover:text-signal-ink-hover disabled:opacity-40"
      >
        + Crew role
      </button>
    </div>
  );
}
