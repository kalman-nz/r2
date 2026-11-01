import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CUSTOM_SIZE, sizeForTemplate, usePrinting, type LabelSize } from "../lib/printing";
import { useCan } from "../lib/roles";
import NumberInput from "./NumberInput";
import { numberProblem, type NumberLimits } from "../lib/numbers";

const CUSTOM = "__custom";
const LENGTH: NumberLimits = { min: 5, max: 1000 };
const SIDE: NumberLimits = { min: 5, max: 300 };
type Box = "length" | "width" | "height";

// Label size: one of the business's label sizes (Settings → Printer setup)
// or a custom width × length. Tape only takes a length; die-cut labels are
// fixed. Turning swaps width and length, for a label read the other way.
//
// A size typed out of range is said so and never reaches the label (it
// keeps its last good size); onProblem tells the page, so printing and
// saving wait until it's fixed.
export default function LabelSizeControls({
  widthMm,
  heightMm,
  sizeId,
  onChange,
  onProblem,
  children,
}: {
  widthMm: number;
  heightMm: number;
  sizeId?: string;
  onChange: (widthMm: number, heightMm: number, sizeId: string) => void;
  onProblem?: (problem: string | null) => void;
  children?: ReactNode;
}) {
  // Which boxes show a size that's out of range (each box reports its own).
  const [bad, setBad] = useState<Record<Box, boolean>>({ length: false, width: false, height: false });
  const watch = (box: Box) => (p: string | null) => setBad((prev) => (prev[box] === !!p ? prev : { ...prev, [box]: !!p }));
  const problem = bad.length
    ? `Length has to be ${LENGTH.min} to ${LENGTH.max} mm`
    : bad.width || bad.height
      ? `${bad.width ? "Width" : "Height"} has to be ${SIDE.min} to ${SIDE.max} mm`
      : null;
  const report = useRef(onProblem);
  report.current = onProblem;
  useEffect(() => {
    report.current?.(problem);
  }, [problem]);
  useEffect(() => () => report.current?.(null), []);
  const fine = (n: number, limits: NumberLimits) => !numberProblem(n, limits);

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
              min={LENGTH.min}
              max={LENGTH.max}
              value={sideways ? widthMm : heightMm}
              onChange={(len) => fine(len, LENGTH) && (sideways ? onChange(len, heightMm, current.id) : onChange(widthMm, len, current.id))}
              onProblem={watch("length")}
              className="input py-1 w-20"
            />
            <span className="text-gray-500">mm</span>
          </label>
        ) : !current ? (
          <>
            <label className="flex items-center gap-2">
              <span className="text-gray-500">W</span>
              <NumberInput
                min={SIDE.min}
                max={SIDE.max}
                value={widthMm}
                onChange={(w) => fine(w, SIDE) && onChange(w, heightMm, CUSTOM_SIZE)}
                onProblem={watch("width")}
                className="input py-1 w-20"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-gray-500">H</span>
              <NumberInput
                min={SIDE.min}
                max={SIDE.max}
                value={heightMm}
                onChange={(h) => fine(h, SIDE) && onChange(widthMm, h, CUSTOM_SIZE)}
                onProblem={watch("height")}
                className="input py-1 w-20"
              />
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

      {problem && <p className="text-xs text-fault-ink">{problem}</p>}

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
