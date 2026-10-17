import { useEffect, useState } from "react";

// Inputs for editing a value in a table row: they keep their own text while
// focused and only report a change on blur or Enter, so a job line is saved
// once per edit instead of once per keystroke. Escape puts the old value back.

export function InlineNumber({
  value,
  onCommit,
  min,
  max,
  step,
  className = "",
  disabled,
  title,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  function commit() {
    let n = Number(text);
    if (text.trim() === "" || Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    if (n !== value) onCommit(n);
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? "any"}
      disabled={disabled}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`input py-0.5 px-1.5 text-right tabular-nums ${className}`}
    />
  );
}

export function InlineText({
  value,
  onCommit,
  placeholder,
  className = "",
  disabled,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  function commit() {
    if (text.trim() !== value) onCommit(text.trim());
  }

  return (
    <input
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`input py-0.5 px-1.5 ${className}`}
    />
  );
}
