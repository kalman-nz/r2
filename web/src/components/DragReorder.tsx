import { useState, type CSSProperties, type DragEvent } from "react";

// Drag a list into order, with the browser's own drag and drop. While
// dragging, an orange line shows where the item will land; the list only
// changes when it's dropped.
//
//   const drag = useDragReorder({ count: rows.length, onMove: (from, to) => setRows((r) => moveItem(r, from, to)) });
//   <div {...drag.item(i)} className={`... ${drag.cls(i)}`} style={drag.style}>
//     <DragHandle {...drag.handle(i)} />
//
// to is where it goes in the list as it was (0 = first, count = last).
// gap: the space between items in px, so the line sits in the middle of it.
// handle: only the grip starts a drag (rows with text boxes in them);
// without it the whole item does. allow: whether an item may land there
// (tracking steps stay within their stage).

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, item);
  return next;
}

export function useDragReorder({
  count,
  onMove,
  axis = "y",
  gap = 8,
  handle = true,
  allow,
}: {
  count: number;
  onMove: (from: number, to: number) => void;
  axis?: "x" | "y";
  gap?: number;
  handle?: boolean;
  allow?: (from: number, to: number) => boolean;
}) {
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null);

  const end = () => {
    setDragging(null);
    setDrop(null);
    setGrabbed(null);
  };

  const item = (index: number) => ({
    draggable: handle ? grabbed === index : true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      setDragging(index);
    },
    onDragOver: (e: DragEvent) => {
      if (dragging === null) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const before = axis === "y" ? e.clientY < rect.top + rect.height / 2 : e.clientX < rect.left + rect.width / 2;
      const to = before ? index : index + 1;
      // Landing where it already is changes nothing: no line.
      const still = to === dragging || to === dragging + 1;
      if (allow && !still && !allow(dragging, to)) {
        setDrop(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDrop(still ? null : to);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging !== null && drop !== null) onMove(dragging, drop);
      end();
    },
    onDragEnd: end,
  });

  // The line before this item, or after the last one; and the dragged one faded.
  const cls = (index: number) => {
    const parts = ["relative"];
    if (dragging === index) parts.push("opacity-40");
    if (drop === index) {
      parts.push(
        axis === "y"
          ? "before:absolute before:inset-x-0 before:top-(--drop-at) before:h-0.5 before:rounded-full before:bg-signal before:pointer-events-none before:z-10"
          : "before:absolute before:inset-y-0 before:left-(--drop-at) before:w-0.5 before:rounded-full before:bg-signal before:pointer-events-none before:z-10",
      );
    }
    if (drop === count && index === count - 1) {
      parts.push(
        axis === "y"
          ? "after:absolute after:inset-x-0 after:bottom-(--drop-at) after:h-0.5 after:rounded-full after:bg-signal after:pointer-events-none after:z-10"
          : "after:absolute after:inset-y-0 after:right-(--drop-at) after:w-0.5 after:rounded-full after:bg-signal after:pointer-events-none after:z-10",
      );
    }
    return parts.join(" ");
  };

  const style = { "--drop-at": `${-(gap / 2) - 1}px` } as CSSProperties;

  const handleProps = (index: number) => ({
    onMouseDown: () => setGrabbed(index),
    onMouseUp: () => setGrabbed(null),
  });

  return { item, cls, style, handle: handleProps, dragging };
}

// The grip you drag by.
export function DragHandle({ onMouseDown, onMouseUp, className = "" }: { onMouseDown?: () => void; onMouseUp?: () => void; className?: string }) {
  return (
    <span
      aria-hidden
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      className={`w-5 h-6 shrink-0 flex items-center justify-center rounded cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 select-none ${className}`}
    >
      <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="currentColor">
        <circle cx="7" cy="5" r="1.4" />
        <circle cx="13" cy="5" r="1.4" />
        <circle cx="7" cy="10" r="1.4" />
        <circle cx="13" cy="10" r="1.4" />
        <circle cx="7" cy="15" r="1.4" />
        <circle cx="13" cy="15" r="1.4" />
      </svg>
    </span>
  );
}
