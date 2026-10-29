import type { ReactNode } from "react";
import { useDropdown } from "../lib/dropdown";
import Segmented from "./Segmented";
import { MAX_GROUPS, MAX_SORTS, type Sort } from "../lib/table";

// A list's detailed filters, sorting and grouping, behind one button next to Columns,
// so the toolbar keeps just the view, search and the filter people change
// most. Saved views keep everything in here (components/PageViews.tsx).
// active: how many filters are narrowing the list, shown on the button.
export default function FiltersMenu({ active, onReset, children }: { active: number; onReset?: () => void; children: ReactNode }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`btn-secondary flex items-center gap-1.5 ${active > 0 ? "ring-1 ring-signal/40" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-500" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M3 5h14M6 10h8M8.5 15h3" />
        </svg>
        Filters
        {active > 0 && <span className="font-semibold text-signal-ink tabular-nums">{active}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] max-h-[75vh] overflow-y-auto card shadow-lg z-40">
          <div className="p-3 flex flex-col gap-3">{children}</div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-100">
            {onReset ? (
              <button onClick={onReset} disabled={active === 0} className="text-xs text-signal-ink hover:text-signal-ink-hover disabled:text-gray-300">
                Clear filters
              </button>
            ) : (
              <span />
            )}
            <button onClick={() => setOpen(false)} className="btn-secondary py-1">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// One labelled setting in the menu.
export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

// A yes/no filter.
export function FilterCheck({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

// What the list's sorted by, in order: by the first, then the next for
// ties. Up to three.
export function SortList({ columns, sorts, onChange }: { columns: { key: string; label: string }[]; sorts: Sort[]; onChange: (sorts: Sort[]) => void }) {
  const name = (c: { label: string }) => (c.label === "#" ? "Number" : c.label);
  const set = (i: number, sort: Sort) => onChange(sorts.map((s, j) => (j === i ? sort : s)).filter((s, j, all) => all.findIndex((x) => x.key === s.key) === j));
  const unused = columns.filter((c) => !sorts.some((s) => s.key === c.key));
  return (
    <div className="flex flex-col gap-1.5 pt-3 border-t border-gray-100">
      <span className="text-xs font-medium text-gray-500">Sort</span>
      {sorts.map((sort, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-12 shrink-0 text-xs text-gray-500">{i === 0 ? "By" : "Then by"}</span>
          <select value={sort.key} onChange={(e) => set(i, { ...sort, key: e.target.value })} className="input flex-1 min-w-0 py-1.5" aria-label={i === 0 ? "Sort by" : "Then sort by"}>
            {columns.map((c) => (
              <option key={c.key} value={c.key}>
                {name(c)}
              </option>
            ))}
          </select>
          <Segmented
            label="Direction"
            compact
            value={sort.dir}
            onChange={(dir) => set(i, { ...sort, dir })}
            options={[
              { value: "asc", label: "↑" },
              { value: "desc", label: "↓" },
            ]}
          />
          <button
            type="button"
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            disabled={sorts.length === 1}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100 disabled:invisible"
            aria-label="Remove this sort"
          >
            ×
          </button>
        </div>
      ))}
      {sorts.length < MAX_SORTS && unused.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...sorts, { key: unused[0].key, dir: "asc" }])}
          className="self-start text-xs text-signal-ink hover:text-signal-ink-hover"
        >
          + Add another sort
        </button>
      )}
    </div>
  );
}

// Grouping the list: a group, then subgroups within each (up to MAX_GROUPS deep).
export function GroupFields({ options, groupBy, onChange }: { options: { key: string; label: string }[]; groupBy: string[]; onChange: (groupBy: string[]) => void }) {
  // Picking a level keeps the ones below it unless they now repeat; clearing it clears them too.
  function pick(level: number, key: string) {
    if (!key) return onChange(groupBy.slice(0, level));
    const before = groupBy.slice(0, level);
    const after = groupBy.slice(level + 1).filter((k) => k !== key);
    onChange([...before, key, ...after]);
  }
  return (
    <div className="flex flex-col gap-1.5 pt-3 border-t border-gray-100">
      <span className="text-xs font-medium text-gray-500">Group</span>
      {Array.from({ length: MAX_GROUPS }, (_, level) => {
        const value = groupBy[level] ?? "";
        const parentSet = level === 0 || !!groupBy[level - 1];
        const taken = groupBy.slice(0, level);
        return (
          <div key={level} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 text-xs text-gray-500">{level === 0 ? "By" : "Then by"}</span>
            <select
              value={value}
              disabled={!parentSet}
              onChange={(e) => pick(level, e.target.value)}
              className="input flex-1 min-w-0 py-1.5 disabled:opacity-50"
              aria-label={level === 0 ? "Group by" : `Subgroup ${level} by`}
            >
              <option value="">{level === 0 ? "No grouping" : parentSet ? "No subgroups" : "Pick the one above first"}</option>
              {options
                .filter((o) => !taken.includes(o.key))
                .map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
