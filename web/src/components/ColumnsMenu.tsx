import { useDropdown } from "../lib/dropdown";

// Which of a list's columns show: a dropdown of checkboxes, in the list's
// own order. A page's saved views keep the choice (components/PageViews.tsx).
export default function ColumnsMenu({
  columns,
  visible,
  onChange,
}: {
  columns: { key: string; label: string }[];
  visible: string[];
  onChange: (visible: string[]) => void;
}) {
  const { open, setOpen, ref } = useDropdown();
  const toggle = (key: string) => {
    const next = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
    onChange(columns.map((c) => c.key).filter((k) => next.includes(k)));
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary flex items-center gap-1.5" aria-haspopup="true" aria-expanded={open}>
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-500" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <rect x="3" y="4" width="14" height="12" rx="1.5" />
          <path d="M7.75 4v12M12.25 4v12" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto card shadow-lg py-1 z-40">
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
