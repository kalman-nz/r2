import type { StatusColour } from "../lib/api";
import { STATUS_COLOURS } from "../lib/statuses";

// The organisation's statuses in their order as one segmented row, the
// current one raised: a project's, looking like a repair's. A thin line marks
// where they go from one kind to another (holding kit to done, say).
export default function StatusPicker<S extends { id: string; name: string; colour: StatusColour | "" }>({
  statuses,
  value,
  onChange,
  disabled = false,
  divides,
  title,
}: {
  statuses: S[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  // Whether a line goes between these two neighbours.
  divides?: (prev: S, next: S) => boolean;
  // Hover text for each.
  title?: (status: S) => string;
}) {
  return (
    <div className="inline-flex items-center flex-wrap rounded-md border border-gray-300 bg-gray-50 p-0.5" role="radiogroup" aria-label="Status">
      {statuses.map((s, i) => {
        const on = s.id === value;
        return (
          <span key={s.id} className="flex items-center">
            {i > 0 && divides?.(statuses[i - 1], s) && <span className="hidden sm:block w-px h-5 bg-gray-300 mx-1" aria-hidden />}
            <button
              type="button"
              role="radio"
              aria-checked={on}
              title={title?.(s)}
              disabled={disabled}
              onClick={() => onChange(s.id)}
              className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded transition-colors disabled:opacity-60 ${
                on ? "bg-white text-gray-900 font-medium shadow-sm ring-1 ring-gray-200" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${STATUS_COLOURS[s.colour || "gray"].dot}`} aria-hidden />
              {s.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
