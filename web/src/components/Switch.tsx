// An on/off switch with its label, for a yes/no setting in a form or dialog.
// danger: red when on, for a switch that makes an action destructive.
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  danger = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  // For a switch whose label is shown elsewhere.
  ariaLabel?: string;
}) {
  return (
    <label className={`inline-flex items-center gap-2.5 text-sm text-gray-800 select-none ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? (danger ? "bg-fault-ink" : "bg-carbon") : "bg-gray-300"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      {label}
    </label>
  );
}
