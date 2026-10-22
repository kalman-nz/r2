import { useState, type ReactNode } from "react";
import { byLabel, groupViews, sharedLabel, type ViewLike } from "../lib/views";
import Modal from "./Modal";

export type RowAction = { label: string; onClick: () => void; danger?: boolean };

// Behind a ViewMenu's "Manage…": everything you can see, and what you can
// do to each one. Owners share theirs from the "Only you" / "Everyone"
// button; the page says what else (edit, copy, delete…).
export default function ManageViews<T extends ViewLike>({
  title,
  views,
  currentId,
  orgName,
  note,
  onPick,
  onShare,
  onRename,
  actions,
  children,
  onClose,
}: {
  title: string;
  views: T[];
  currentId: string;
  orgName?: string;
  // A few more words under a name.
  note?: (view: T) => string;
  onPick: (view: T) => void;
  onShare: (view: T) => void;
  // Renaming in place, for ones with no editor of their own.
  onRename?: (view: T, name: string) => void;
  actions: (view: T) => (RowAction | false | null | undefined | "")[];
  // After the list: "New dashboard", say.
  children?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      {views.length === 0 && <p className="text-sm text-gray-500">None saved yet.</p>}
      {groupViews(views).map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{g.label}</h3>
          {g.rows.map((v) => (
            <ManageRow
              key={v.id}
              view={v}
              active={v.id === currentId}
              sub={[byLabel(v, orgName), note?.(v)].filter(Boolean).join(" · ")}
              onPick={onPick}
              onShare={onShare}
              onRename={onRename}
              actions={actions(v).filter((a): a is RowAction => !!a)}
            />
          ))}
        </div>
      ))}
      {children}
    </Modal>
  );
}

function ManageRow<T extends ViewLike>({
  view,
  active,
  sub,
  onPick,
  onShare,
  onRename,
  actions,
}: {
  view: T;
  active: boolean;
  sub: string;
  onPick: (view: T) => void;
  onShare: (view: T) => void;
  onRename?: (view: T, name: string) => void;
  actions: RowAction[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);

  function commit() {
    setRenaming(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== view.name) onRename?.(view, trimmed);
    else setName(view.name);
  }

  return (
    <div className={`flex items-center gap-3 px-2 py-1.5 rounded-md ${active ? "bg-signal-soft" : "hover:bg-gray-50"}`}>
      {renaming ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              // Just this, not the whole window.
              e.stopPropagation();
              setName(view.name);
              setRenaming(false);
            }
          }}
          maxLength={60}
          className="input py-0.5 text-sm flex-1 min-w-0"
        />
      ) : (
        <button onClick={() => onPick(view)} className="flex-1 min-w-0 text-left" title={`Open ${view.name}`}>
          <span className={`block text-sm truncate ${active ? "text-signal-ink font-medium" : "text-gray-800"}`}>{view.name}</span>
          {sub && <span className="block text-xs text-gray-500 truncate">{sub}</span>}
        </button>
      )}
      <span className="flex items-center gap-2.5 shrink-0 text-xs">
        {view.isOwner && (
          <button onClick={() => onShare(view)} className="text-gray-500 hover:text-gray-900" title="Who can see it">
            {sharedLabel(view)}
          </button>
        )}
        {onRename && view.canEdit && !renaming && (
          <button onClick={() => setRenaming(true)} className="text-gray-500 hover:text-gray-900">
            Rename
          </button>
        )}
        {actions.map((a) => (
          <button key={a.label} onClick={a.onClick} className={`text-gray-500 ${a.danger ? "hover:text-fault-ink" : "hover:text-gray-900"}`}>
            {a.label}
          </button>
        ))}
      </span>
    </div>
  );
}
