import { useEffect, useRef, useState } from "react";
import { numberProblem } from "../lib/numbers";

// A number field that never changes what was typed. It keeps its own text
// while you type (a plain controlled input that clamps on every keystroke
// can't even show as empty, so typing "2" over "1" gives "12"), and hands
// the parent every number as it's typed, right or wrong. One outside
// min/max, or with decimals when `integer`, is marked invalid with the
// problem as its title, and the form refuses it with numberProblem (or
// shows `problem`, its own wording). Cleared and left, it goes back to min
// (or 0).
//
// clamp: for the label designer's live controls, which have nothing to
// save: there a number out of range snaps back into it when you leave.
export default function NumberInput({
  value,
  onChange,
  min,
  max,
  integer,
  clamp,
  problem,
  onProblem,
  className,
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  clamp?: boolean;
  // What's wrong, in the form's words; null for nothing. Left out, it's
  // numberProblem for min, max and integer.
  problem?: string | null;
  // Told whenever what's shown as wrong changes, and null once it's gone.
  onProblem?: (problem: string | null) => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const typed = text.trim() === "" ? null : Number(text);
  const shown = typed === null || clamp ? null : problem !== undefined ? problem : numberProblem(typed, { min, max, integer });

  const report = useRef(onProblem);
  report.current = onProblem;
  useEffect(() => {
    report.current?.(shown);
  }, [shown]);
  useEffect(() => () => report.current?.(null), []);

  function handleChange(raw: string) {
    setText(raw);
    if (raw.trim() === "") return; // let it sit empty while the user is mid-edit
    const n = Number(raw);
    if (!Number.isNaN(n)) onChange(n);
  }

  function handleBlur() {
    let n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) {
      n = min ?? 0;
    } else if (clamp) {
      if (integer) n = Math.round(n);
      if (min !== undefined) n = Math.max(min, n);
      if (max !== undefined) n = Math.min(max, n);
    } else {
      return; // what was typed stays, right or wrong
    }
    setText(String(n));
    if (n !== value) onChange(n);
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={integer ? 1 : "any"}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={shown ? true : undefined}
      title={shown ?? undefined}
      className={className}
    />
  );
}
