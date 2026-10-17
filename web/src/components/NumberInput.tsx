import { useEffect, useState } from "react";

// A plain controlled <input type="number"> that clamps on every keystroke
// (value={Math.max(min, Number(e.target.value))}) can never actually show
// as empty — the instant you delete the digit, onChange fires with "",
// Number("") is 0, the clamp snaps it straight back to the old value, and
// the field re-renders still showing it. From the user's perspective
// nothing happened, so typing "2" over an existing "1" inserts into the
// still-present "1" instead of replacing it, producing "12". This keeps its
// own free-text state while focused — clamping only happens on blur — so
// the field can go through an empty/invalid intermediate state while
// typing, the same way a native uncontrolled number input behaves.
export default function NumberInput({
  value,
  onChange,
  min,
  max,
  className,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    if (raw.trim() === "") return; // let it sit empty while the user is mid-edit
    const n = Number(raw);
    if (!Number.isNaN(n)) onChange(n);
  }

  function handleBlur() {
    let n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) n = min ?? 0;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    if (n !== value) onChange(n);
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      disabled={disabled}
      className={className}
    />
  );
}
