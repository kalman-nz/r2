import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Job } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";

export interface ProjectRef {
  id: string;
  number: number;
  name: string;
}

// Picking one project by number or name. Searches on the server, so it
// stays quick with years of projects; most recent first.
export default function ProjectPicker({ value, onChange, disabled }: { value: ProjectRef | null; onChange: (project: ProjectRef | null) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const term = search.trim().replace(/^#/, "");
  const { data: matches = [] } = useQuery({
    queryKey: ["jobs", "pick", term],
    queryFn: async () =>
      (
        await pb.collection("jobs").getList<Job>(1, 8, {
          filter: orgFilter(/^\d+$/.test(term) ? pb.filter("number = {:n} || name ~ {:q}", { n: Number(term), q: term }) : pb.filter("name ~ {:q}", { q: term })),
          sort: "-startAt",
          fields: "id,number,name,startAt",
        })
      ).items,
    enabled: term.length > 0 && !value,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-gray-900 truncate">
          #{value.number} {value.name}
        </span>
        {!disabled && (
          <button onClick={() => onChange(null)} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover shrink-0">
            Change
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
        placeholder="Search project number or name…"
        className="input py-1.5"
      />
      {matches.length > 0 && (
        <div className="flex flex-col border border-gray-200 rounded-md divide-y divide-gray-100">
          {matches.map((j) => (
            <button
              key={j.id}
              onClick={() => {
                onChange({ id: j.id, number: j.number, name: j.name });
                setSearch("");
              }}
              className="text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 text-sm"
            >
              <span className="font-mono text-xs text-gray-400">#{j.number}</span>
              <span className="truncate">{j.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
