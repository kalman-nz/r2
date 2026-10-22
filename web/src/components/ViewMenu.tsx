import { useDropdown } from "../lib/dropdown";
import { groupViews, type ViewLike } from "../lib/views";

export type MenuAction = { label: string; onClick: () => void };

// Picking a dashboard or saved view, with what you can do about them (new,
// copy, save, manage) at the foot of the same dropdown, so the page itself
// only shows what you're looking at.
export default function ViewMenu<T extends ViewLike>({
  label,
  views,
  currentId,
  placeholder,
  prefix,
  none,
  edited = false,
  note,
  onPick,
  actions,
  align = "left",
}: {
  // For screen readers: "Dashboard", "Saved views".
  label: string;
  views: T[];
  currentId: string;
  // On the button when nothing's picked.
  placeholder: string;
  // Before a picked one's name on the button: "View: Hire desk".
  prefix?: string;
  // A first choice for none at all (picked as null): "Default".
  none?: string;
  // The filters have changed since the view was picked.
  edited?: boolean;
  // A few words at a choice's end: "by Sam", "Default".
  note?: (view: T) => string;
  onPick: (view: T | null) => void;
  actions: (MenuAction | false | null | undefined | "")[];
  align?: "left" | "right";
}) {
  const { open, setOpen, ref } = useDropdown();
  const current = views.find((v) => v.id === currentId);
  const shown = actions.filter((a): a is MenuAction => !!a);
  const choose = (view: T | null) => {
    setOpen(false);
    onPick(view);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-secondary flex items-center gap-1.5 max-w-full"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">
          {current && prefix && <span className="text-gray-500 font-normal">{prefix}: </span>}
          {current?.name ?? placeholder}
        </span>
        {edited && current && <span className="text-xs font-normal text-gray-400 shrink-0">edited</span>}
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-400 shrink-0" aria-hidden>
          <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto card shadow-lg py-1 z-40`}
        >
          {none && (
            <Choice selected={!current} onClick={() => choose(null)}>
              {none}
            </Choice>
          )}
          {groupViews(views).map((g) => (
            <div key={g.label}>
              <div className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-500">{g.label}</div>
              {g.rows.map((v) => (
                <Choice key={v.id} selected={v.id === currentId} note={note?.(v)} onClick={() => choose(v)}>
                  {v.name}
                </Choice>
              ))}
            </div>
          ))}
          {!none && views.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">None saved yet.</p>}
          {shown.length > 0 && <div className="border-t border-gray-100 my-1" />}
          {shown.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Choice({ selected, note, onClick, children }: { selected: boolean; note?: string; onClick: () => void; children: string }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50"
    >
      <span className={`truncate ${selected ? "font-semibold text-gray-900" : "text-gray-700"}`}>
        {selected && <span className="text-signal-ink mr-1.5">✓</span>}
        {children}
      </span>
      {note && <span className="text-xs text-gray-400 shrink-0">{note}</span>}
    </button>
  );
}
