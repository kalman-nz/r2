import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { FolderActionsApi } from "./FolderActions";
import type { FolderIndex } from "../../lib/folders";
import { trail } from "../../lib/folders";

export function FolderIcon({ open = false, className = "w-4 h-4" }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" className={`${className} shrink-0`}>
      {open ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19V7zM3 19l2.6-7.6A2 2 0 0 1 7.5 10H22l-2.7 7.7A2 2 0 0 1 17.4 19H3z" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      )}
    </svg>
  );
}

// Folders as a tree, from "Inventory" at the top. Used for browsing (the
// inventory sidebar) and for choosing a folder (FolderPicker). The current
// folder's parents start open. counts: folder id → items inside it at any
// depth. disabled: folders that can't be chosen (moving a folder into
// itself). With actions, each row gets + (new folder inside) and a ⋯ menu
// (rename, move, delete) on hover.
export default function FolderTree({
  index,
  current,
  onOpen,
  counts,
  disabled,
  rootLabel = "Inventory",
  actions,
}: {
  index: FolderIndex;
  current: string;
  onOpen: (id: string) => void;
  counts?: Map<string, number>;
  disabled?: Set<string>;
  rootLabel?: string;
  actions?: FolderActionsApi;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(trail(index, current).map((c) => c.id)));
  useEffect(() => {
    setOpen((prev) => new Set([...prev, ...trail(index, current).map((c) => c.id)]));
  }, [index, current]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function row(id: string, label: ReactNode, depth: number, hasChildren: boolean) {
    const isOpen = open.has(id);
    const isCurrent = id === current;
    const off = disabled?.has(id) ?? false;
    return (
      <div
        className={`group flex items-center gap-1 h-8 pr-1 rounded-md text-sm ${isCurrent ? "bg-gray-900/[0.06] text-gray-900 font-medium" : "text-gray-700 hover:bg-gray-100"} ${off ? "opacity-40" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggle(id)}
          className={`w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 ${hasChildren ? "" : "invisible"}`}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <svg viewBox="0 0 20 20" className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 5l5 5-5 5" />
          </svg>
        </button>
        <button type="button" onClick={() => !off && onOpen(id)} disabled={off} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
          <FolderIcon open={isCurrent} className={`w-4 h-4 ${isCurrent ? "text-signal" : "text-gray-400"}`} />
          <span className="truncate">{label}</span>
        </button>
        {counts && (
          <span className={`font-mono text-[11px] text-gray-400 pr-1 ${actions ? "group-hover:hidden" : ""} ${actions && isCurrent ? "hidden" : ""}`}>
            {counts.get(id) ?? 0}
          </span>
        )}
        {actions && (
          <span className={`items-center ${isCurrent ? "flex" : "hidden group-hover:flex"}`}>
            {actions.canCreate && (
              <button
                type="button"
                onClick={() => actions.newFolder(id)}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 hover:bg-gray-200"
                title={`New folder in ${typeof label === "string" ? label : "this folder"}`}
                aria-label="New folder inside"
              >
                <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10 4v12M4 10h12" />
                </svg>
              </button>
            )}
            {id && (actions.canEdit || actions.canDelete) && <RowMenu id={id} actions={actions} />}
          </span>
        )}
      </div>
    );
  }

  function branch(parent: string, depth: number): ReactNode {
    return (index.children.get(parent) ?? []).map((folder) => {
      const kids = (index.children.get(folder.id) ?? []).length > 0;
      return (
        <div key={folder.id}>
          {row(folder.id, folder.name, depth, kids)}
          {kids && open.has(folder.id) && branch(folder.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="flex flex-col">
      {row("", rootLabel, 0, false)}
      {branch("", 1)}
    </div>
  );
}

// Rename / move / delete for one folder in the tree. The menu is drawn on
// the page itself (a portal, fixed to the button's position), so the
// sidebar's scrolling can't cut it off; it opens upwards when there's no
// room below, and closes if the page scrolls under it.
function RowMenu({ id, actions }: { id: string; actions: FolderActionsApi }) {
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open || !button.current) return setAt(null);
    const r = button.current.getBoundingClientRect();
    const width = 144;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const roomBelow = window.innerHeight - r.bottom;
    setAt(roomBelow > 140 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  }

  const item = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setAt(null);
        onClick();
      }}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${danger ? "text-fault-ink" : "text-gray-700"}`}
    >
      {label}
    </button>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-900 hover:bg-gray-200"
        aria-label="Folder options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="currentColor">
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      </button>
      {at &&
        createPortal(
          <div ref={menu} role="menu" style={{ position: "fixed", left: at.left, top: at.top, bottom: at.bottom, width: 144 }} className="card shadow-lg py-1 z-50">
            {actions.canEdit && item("Rename", () => actions.rename(id))}
            {actions.canEdit && item("Move…", () => actions.move(id))}
            {actions.canDelete && item("Delete", () => actions.remove(id), true)}
          </div>,
          document.body,
        )}
    </>
  );
}
