import { useState, type ReactNode } from "react";
import type { TrackedAt, TrackingStep } from "../../lib/api";
import { STATUS_COLOURS } from "../../lib/statuses";
import { progressOf, type Layout, type Progress } from "../../lib/tracking";
import Segmented from "../Segmented";

export function LayoutSwitch({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  return (
    <Segmented
      label="Layout"
      value={layout}
      onChange={onChange}
      options={[
        { value: "board", label: "Board" },
        { value: "list", label: "List" },
      ]}
    />
  );
}

// Equipment tracking as a board: a column for "Not started" and one per
// step, in order. Each card (a project, or a bit of equipment on one) sits
// under the step it's on: the one it's working towards once any of its
// units have got there ("71/78 Prepped" is under Prepped), else the
// furthest all of them have reached. Cards move as kit's scanned, and,
// where the page allows it (onDrop), by dragging: a project dropped on a
// step takes the status that step sets. placeAt puts a card at least that
// far along (a project whose status is a step's, scanned or not).
export default function TrackingBoard<T>({
  steps,
  items,
  itemKey,
  at,
  total,
  card,
  empty = "Nothing here",
  placeAt,
  canDrop,
  onDrop,
}: {
  steps: TrackingStep[];
  items: T[];
  itemKey: (item: T) => string;
  at: (item: T) => TrackedAt;
  total: (item: T) => number;
  card: (item: T, progress: Progress) => ReactNode;
  empty?: string;
  // A step id the card belongs at least as far along as ("" or undefined: none).
  placeAt?: (item: T) => string | undefined;
  // Whether a card can be dropped on a step, and what dropping it does.
  canDrop?: (item: T, stepId: string) => boolean;
  onDrop?: (item: T, stepId: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const columns: {
    id: string;
    name: string;
    dot: string;
    cards: { item: T; progress: Progress }[];
  }[] = [
    { id: "", name: "Not started", dot: "bg-gray-300", cards: [] },
    ...steps.map((s) => ({
      id: s.id,
      name: s.name,
      dot: STATUS_COLOURS[s.colour || "gray"].dot,
      cards: [] as { item: T; progress: Progress }[],
    })),
  ];
  const byKey = new Map<string, T>();
  for (const item of items) {
    byKey.set(itemKey(item), item);
    const progress = progressOf(steps, at(item), total(item));
    const on = progress.next && progress.nextCount > 0 ? progress.next : progress.current;
    const kitColumn = Math.max(0, columns.findIndex((c) => c.id === (on?.id ?? "")));
    const placed = placeAt?.(item);
    const statusColumn = placed ? columns.findIndex((c) => c.id === placed) : -1;
    columns[Math.max(kitColumn, statusColumn)].cards.push({ item, progress });
  }
  const draggedItem = dragging ? byKey.get(dragging) : undefined;
  const droppable = (columnId: string) => !!draggedItem && !!columnId && !!canDrop?.(draggedItem, columnId);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
      {columns.map((c) => (
        <section
          key={c.id || "none"}
          onDragOver={(e) => {
            if (!droppable(c.id)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (over !== c.id) setOver(c.id);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === c.id) setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (draggedItem && droppable(c.id)) onDrop?.(draggedItem, c.id);
            setDragging(null);
            setOver(null);
          }}
          className={`w-72 shrink-0 snap-start flex flex-col rounded-lg border max-h-[calc(100vh-14rem)] transition-colors ${
            over === c.id ? "bg-signal/10 border-signal/50" : dragging && droppable(c.id) ? "bg-gray-100/70 border-signal/30" : dragging ? "bg-gray-100/40 border-gray-200 opacity-60" : "bg-gray-100/70 border-gray-200"
          }`}
        >
          <header className="flex items-center justify-between gap-2 px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
              {c.name}
            </h2>
            <span className="text-xs font-mono text-gray-500">{c.cards.length}</span>
          </header>
          <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto">
            {c.cards.length === 0 && <p className="px-1 py-3 text-xs text-gray-400 text-center">{empty}</p>}
            {c.cards.map(({ item, progress }) => {
              const key = itemKey(item);
              return (
                <div
                  key={key}
                  draggable={!!onDrop}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", key);
                    setDragging(key);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={`${onDrop ? "cursor-grab active:cursor-grabbing" : ""} ${dragging === key ? "opacity-40" : ""}`}
                >
                  {card(item, progress)}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// "5/8 Loaded": how far a card has got towards its next step.
export function NextStep({ progress }: { progress: Progress }) {
  const { next, nextCount, total } = progress;
  if (!next || nextCount === 0) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-600 tabular-nums">
      <span className="h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden">
        <span className={`block h-full ${STATUS_COLOURS[next.colour || "gray"].dot}`} style={{ width: `${(nextCount / total) * 100}%` }} />
      </span>
      {nextCount}/{total} {next.name}
    </span>
  );
}
