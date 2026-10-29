import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CUSTOM_SIZE, sizeForTemplate, usePrinting, type LabelSize } from "../lib/printing";
import { useCan } from "../lib/roles";
import NumberInput from "./NumberInput";

const CUSTOM = "__custom";

// Label size: one of the business's label sizes (Settings → Printer setup)
// or a custom width × length. Tape only takes a length; die-cut labels are
// fixed. Turning swaps width and length, for a label read the other way.
export default function LabelSizeControls({
  widthMm,
  heightMm,
  sizeId,
  onChange,
  children,
}: {
  widthMm: number;
  heightMm: number;
  sizeId?: string;
  onChange: (widthMm: number, heightMm: number, sizeId: string) => void;
  children?: ReactNode;
}) {
  const can = useCan();
  const { data: config } = usePrinting();
  const sizes = config?.sizes ?? [];
  const current = sizeForTemplate({ widthMm, heightMm, sizeId }, sizes);
  const offered = sizes.filter((s) => !s.hidden || s.id === current?.id);
  const brotherTape = offered.filter((s) => s.brother && s.continuous);
  const brotherLabels = offered.filter((s) => s.brother && !s.continuous);
  const other = offered.filter((s) => !s.brother);
  const sideways = current ? !(Math.abs(widthMm - current.widthMm) < 0.6 && (current.continuous || Math.abs(heightMm - current.lengthMm) < 0.6)) : false;
  const loaded = current?.brother ? (config?.printers ?? []).filter((p) => p.enabled && sizes.find((s) => s.id === p.sizeId)?.brother === current.brother) : [];

  function pick(id: string) {
    if (id === CUSTOM) {
      onChange(widthMm, heightMm, CUSTOM_SIZE);
      return;
    }
    const size = sizes.find((s) => s.id === id);
    if (!size) return;
    // Each size starts at its own length, the way round the label was.
    const [w, h] = sideways ? [size.lengthMm, size.widthMm] : [size.widthMm, size.lengthMm];
    onChange(w, h, size.id);
  }

  const option = (s: LabelSize) => (
    <option key={s.id} value={s.id}>
      {s.name}
      {!s.continuous && !s.brother ? ` (${s.widthMm} × ${s.lengthMm} mm)` : ""}
    </option>
  );

  return (
    <div className="flex flex-col gap-2 card px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="text-gray-500">Label</span>
          <select value={current?.id ?? CUSTOM} onChange={(e) => pick(e.target.value)} className="input py-1 w-56">
            {brotherTape.length > 0 && <optgroup label="Brother tape">{brotherTape.map(option)}</optgroup>}
            {brotherLabels.length > 0 && <optgroup label="Brother labels">{brotherLabels.map(option)}</optgroup>}
            {other.length > 0 && <optgroup label="Other (PDF)">{other.map(option)}</optgroup>}
            <option value={CUSTOM}>Custom size…</option>
          </select>
        </label>

        {current?.continuous ? (
          <label className="flex items-center gap-2">
            <span className="text-gray-500">Length</span>
            <NumberInput
              min={5}
              max={1000}
              value={sideways ? widthMm : heightMm}
              onChange={(len) => (sideways ? onChange(len, heightMm, current.id) : onChange(widthMm, len, current.id))}
              className="input py-1 w-20"
            />
            <span className="text-gray-500">mm</span>
          </label>
        ) : !current ? (
          <>
            <label className="flex items-center gap-2">
              <span className="text-gray-500">W</span>
              <NumberInput min={5} max={300} value={widthMm} onChange={(w) => onChange(w, heightMm, CUSTOM_SIZE)} className="input py-1 w-20" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-gray-500">H</span>
              <NumberInput min={5} max={300} value={heightMm} onChange={(h) => onChange(widthMm, h, CUSTOM_SIZE)} className="input py-1 w-20" />
              <span className="text-gray-500">mm</span>
            </label>
          </>
        ) : (
          <span className="text-gray-500 font-mono text-xs">
            {widthMm} × {heightMm} mm
          </span>
        )}

        {widthMm !== heightMm && (
          <button
            type="button"
            onClick={() => onChange(heightMm, widthMm, current?.id ?? CUSTOM_SIZE)}
            title="Turn the label 90° — swap its width and length"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <rect x="2" y="5" width="8" height="9" rx="1" />
              <path d="M7 2.5h4.5a2 2 0 0 1 2 2V9" />
              <path d="m11.5 7 2 2 2-2" />
            </svg>
            Turn
          </button>
        )}

        {children}
      </div>

      {current && current.brother && loaded.length === 0 && (
        <p className="text-xs text-amber-700">
          No printer has {current.name} loaded right now, so this would print from a PDF.
          {can("settings.edit") && (
            <>
              {" "}
              <Link to="/settings/printer" className="underline">
                Printer setup
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
