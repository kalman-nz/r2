import { useEffect, useRef, useState } from "react";
import type { StatusColour } from "../lib/api";
import { STATUS_COLOURS } from "../lib/statuses";

// A colour swatch that opens a row of the status colours (Settings →
// Project statuses and Tracking steps; Repair statuses has its own copy).
export default function ColourPicker({ value, onChange, label }: { value: StatusColour; onChange: (c: StatusColour) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-md border border-gray-200 hover:border-gray-400 flex items-center justify-center"
        aria-label={`Colour of ${label}: ${STATUS_COLOURS[value].label}`}
        title={STATUS_COLOURS[value].label}
      >
        <span className={`w-3.5 h-3.5 rounded-full ${STATUS_COLOURS[value].dot}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 flex gap-1 rounded-md border border-gray-200 bg-white p-1.5 shadow-md">
          {(Object.keys(STATUS_COLOURS) as StatusColour[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={`w-6 h-6 rounded flex items-center justify-center hover:bg-gray-100 ${c === value ? "ring-1 ring-gray-400" : ""}`}
              aria-label={STATUS_COLOURS[c].label}
              title={STATUS_COLOURS[c].label}
            >
              <span className={`w-3.5 h-3.5 rounded-full ${STATUS_COLOURS[c].dot}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
