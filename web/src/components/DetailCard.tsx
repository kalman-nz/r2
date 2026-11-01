import { createContext, useContext, type ReactNode } from "react";

// A record page's card of details (contacts, locations, projects, crew),
// read and edited in the same place: Edit turns its rows' values into
// inputs where they sit, with Save right underneath, so nothing moves.
// The item page's cards (components/item/ItemDetails.tsx) look the same and
// keep their own copy.
export function DetailCard({
  title,
  editing,
  canEdit,
  saving,
  saveDisabled = false,
  onEdit,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  editing: boolean;
  canEdit: boolean;
  saving: boolean;
  saveDisabled?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`card flex flex-col ${editing ? "ring-2 ring-signal/30 border-signal/50" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-gray-100">
        <h2 className="eyebrow text-gray-500">{title}</h2>
        {canEdit && (
          <button onClick={onEdit} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
            Edit
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="px-4 pb-2"
      >
        <Editing.Provider value={editing}>{children}</Editing.Provider>
        {editing && (
          <div className="flex items-center gap-2 py-2.5 border-t border-gray-100">
            <button type="submit" disabled={saving || saveDisabled} className="btn-primary py-1.5">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={onCancel} className="btn-secondary py-1.5">
              Cancel
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

// Rows read whether their card is being edited, so each one can show its
// value or its input in the same spot.
const Editing = createContext(false);

// label | value, or while editing, label | input (children). A row with no
// input (an item's code) stays as it is.
export function DetailRow({
  label,
  value,
  mono = false,
  empty = "—",
  children,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  empty?: string;
  children?: ReactNode;
}) {
  const editing = useContext(Editing) && children !== undefined;
  const blank = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 text-sm items-start border-b border-gray-100 last:border-b-0 min-h-11">
      <dt className="text-gray-500 pt-1">{label}</dt>
      <dd className="min-w-0 flex flex-col gap-0.5">
        {editing ? (
          children
        ) : (
          <span className={`pt-1 ${blank ? "text-gray-400" : `text-gray-900 ${mono ? "font-mono" : ""}`}`}>{blank ? empty : value}</span>
        )}
      </dd>
    </div>
  );
}

// The few things people open a record to check, across the top of its
// General tab.
export function FactTiles({ children }: { children: ReactNode[] }) {
  const shown = children.filter(Boolean);
  const cols = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"][Math.min(shown.length, 4)];
  return <div className={`grid grid-cols-2 gap-4 ${cols}`}>{shown}</div>;
}

export function Fact({ label, value, tone = "text-gray-900", title }: { label: string; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div className="card px-4 py-3 flex flex-col gap-0.5 min-w-0" title={title}>
      <span className="eyebrow text-gray-500">{label}</span>
      <span className={`text-lg font-semibold truncate ${tone}`}>{value}</span>
    </div>
  );
}
