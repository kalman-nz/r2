import { useState } from "react";
import type { CrewPerson } from "../../lib/api";
import { useDropdown } from "../../lib/dropdown";

// Picking someone for a crew slot: search, the people who do the role first
// ("Can do Audio operator"), then everyone else. busy says where else
// someone is at the time, so double bookings show before they're made
// (they're allowed: a warning, not a rule).
export default function PersonPicker({
  people,
  roleId,
  roleName,
  exclude,
  busy,
  onPick,
  label = "+ Add person",
  disabled,
}: {
  people: CrewPerson[];
  roleId?: string;
  roleName?: string;
  // Already on it.
  exclude: Set<string>;
  busy?: (personId: string) => string;
  onPick: (person: CrewPerson) => void;
  label?: string;
  disabled?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const choices = people.filter((p) => !p.archived && !exclude.has(p.id) && (!term || p.name.toLowerCase().includes(term)));
  const qualified = roleId ? choices.filter((p) => p.skills.includes(roleId)) : [];
  const others = roleId ? choices.filter((p) => !p.skills.includes(roleId)) : choices;

  function pick(p: CrewPerson) {
    onPick(p);
    setOpen(false);
    setSearch("");
  }

  const row = (p: CrewPerson) => {
    const clash = busy?.(p.id) ?? "";
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => pick(p)}
        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex flex-col"
        title={clash ? `Already booked then: ${clash}` : undefined}
      >
        <span className="text-sm text-gray-900 flex items-center gap-1.5">
          {p.name}
          {!p.user && <span className="text-xs text-gray-400">freelancer</span>}
        </span>
        {clash && <span className="text-xs text-amber-700 truncate">Busy: {clash}</span>}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover disabled:text-gray-300"
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] card shadow-lg z-40 flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus placeholder="Search the crew…" className="input py-1.5 w-full" />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {qualified.length > 0 && (
              <>
                <p className="px-3 pt-1 pb-0.5 eyebrow text-gray-400">Can do {roleName}</p>
                {qualified.map(row)}
              </>
            )}
            {others.length > 0 && (
              <>
                {roleId && <p className="px-3 pt-2 pb-0.5 eyebrow text-gray-400">{qualified.length > 0 ? "Everyone else" : `Nobody has ${roleName} as a skill yet`}</p>}
                {others.map(row)}
              </>
            )}
            {choices.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">{term ? "Nobody matches." : "Everyone's on it already."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
