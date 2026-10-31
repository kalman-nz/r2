import type { ReactNode } from "react";

// Label + control + optional hint, the way every form in the app lays out.
// error says what's wrong with the value, in place of the hint.
export default function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 min-w-0 ${className}`}>
      <span className="text-sm text-gray-500">{label}</span>
      {children}
      {error ? <Problem>{error}</Problem> : hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

// What's wrong with a field's value, in a few words, under or beside it.
export function Problem({ children }: { children: ReactNode }) {
  return children ? <span className="text-xs text-fault-ink">{children}</span> : null;
}
