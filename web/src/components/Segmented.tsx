// A small two-or-three-way switch for a choice that's always one of a few
// short options (physical item or kit, quantity or unit by unit): quicker
// to read and to change than a dropdown.
export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex w-fit self-start rounded-md border border-gray-300 bg-gray-50 p-0.5 ${disabled ? "opacity-60" : ""}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1 text-sm rounded transition-colors disabled:cursor-not-allowed ${
              on ? "bg-white text-gray-900 font-medium shadow-sm ring-1 ring-gray-200" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
