import { useState } from "react";
import type { CrewPerson, CrewRole } from "../../lib/api";
import { useDropdown } from "../../lib/dropdown";
import { fitFor, levelOf } from "../../lib/crew";

// Picking someone for a crew slot: search, then the suggestions first
// (people who do the role, at its level or above, and are free then), then
// the rest who do the role (booked elsewhere, or a lower level), then
// everyone else. busy says where else someone is at the time, so double
// bookings show before they're made (they're allowed: a warning, not a
// rule).
export default function PersonPicker({
  people,
  role,
  level = "",
  exclude,
  busy,
  onPick,
  label = "+ Add person",
  disabled,
}: {
  people: CrewPerson[];
  role?: CrewRole;
  // The lowest level the slot takes ("" for any).
  level?: string;
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
  const clashOf = (p: CrewPerson) => busy?.(p.id) ?? "";
  const suggested = role ? choices.filter((p) => fitFor(p, role, level) === "fits" && !clashOf(p)) : [];
  const alsoDo = role ? choices.filter((p) => fitFor(p, role, level) !== "no" && !suggested.includes(p)) : [];
  const others = role ? choices.filter((p) => fitFor(p, role, level) === "no") : choices;

  function pick(p: CrewPerson) {
    onPick(p);
    setOpen(false);
    setSearch("");
  }

  const row = (p: CrewPerson) => {
    const clash = clashOf(p);
    const theirs = role ? levelOf(p, role.id) : "";
    const below = role && level ? fitFor(p, role, level) === "below" : false;
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
          {theirs && <span className={`text-xs ${below ? "text-amber-700" : "text-gray-500"}`}>{theirs}</span>}
          {below && !theirs && <span className="text-xs text-amber-700">no level</span>}
          {!p.user && <span className="text-xs text-gray-400">freelancer</span>}
        </span>
        {clash && <span className="text-xs text-amber-700 truncate">Busy: {clash}</span>}
      </button>
    );
  };

  const heading = (text: string, first = false) => <p className={`px-3 ${first ? "pt-1" : "pt-2"} pb-0.5 eyebrow text-gray-400`}>{text}</p>;

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
            {suggested.length > 0 && (
              <>
                {heading("Suggested", true)}
                {suggested.map(row)}
              </>
            )}
            {alsoDo.length > 0 && (
              <>
                {heading(suggested.length > 0 ? `Also can do ${role?.name}` : `Can do ${role?.name}`, suggested.length === 0)}
                {alsoDo.map(row)}
              </>
            )}
            {others.length > 0 && (
              <>
                {role && heading(suggested.length + alsoDo.length > 0 ? "Everyone else" : `Nobody has ${role.name} as a skill yet`, suggested.length + alsoDo.length === 0)}
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
