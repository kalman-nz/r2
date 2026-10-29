import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { compare, headingSort, type GroupOption, type Sort } from "../lib/table";

// The list table that Inventory and Projects share: one line per row, a
// sticky header, click a header to sort, drag its edge to resize (double-
// click the edge to put it back), optional tick boxes for bulk actions,
// and optional groups (and subgroups) that fold away.
//
// Columns fit the space there is, so there's no sideways scrolling: each
// has the width it'd like (its own, or what it was dragged to), the flex
// column takes whatever's left over, and when there isn't room they all
// give up some width, down to their minimums. Only when even the minimums
// don't fit (a phone, or lots of columns) does the table scroll sideways.

export interface TableColumn<R> {
  key: string;
  label: string;
  align?: "right";
  // The width it'd like, and the narrowest it goes before the table scrolls.
  width: number;
  minWidth?: number;
  // Takes the space the others don't need (one per table, usually the name).
  flex?: boolean;
  sortValue?: (row: R) => string | number;
  render: (row: R) => ReactNode;
  // Hover text for a cell that might be cut off.
  title?: (row: R) => string;
}

const CHECKBOX_WIDTH = 36;
const DEFAULT_MIN = 64;

// Never so narrow its heading's cut off (about 6.5px a letter, plus padding
// and room for the sort arrow).
function minOf<R>(c: TableColumn<R>): number {
  return Math.max(c.minWidth ?? DEFAULT_MIN, Math.ceil(c.label.length * 6.5 + 30));
}

// Each column's width when `available` pixels are there to fill.
function fitWidths<R>(columns: TableColumn<R>[], preferred: Record<string, number>, available: number): number[] {
  const min = columns.map(minOf);
  const want = columns.map((c, i) => Math.max(preferred[c.key] ?? c.width, min[i]));
  if (!available || columns.length === 0) return want;
  const total = want.reduce((a, b) => a + b, 0);
  const flex = Math.max(
    0,
    columns.findIndex((c) => c.flex),
  );
  let out: number[];
  if (total <= available) {
    out = [...want];
    out[flex] += available - total;
  } else {
    const slack = want.reduce((sum, w, i) => sum + (w - min[i]), 0);
    const need = total - available;
    if (slack <= need) return min;
    out = want.map((w, i) => Math.floor(w - ((w - min[i]) * need) / slack));
    // Rounding down leaves a few pixels: the flex column has them.
    out[flex] += available - out.reduce((a, b) => a + b, 0);
  }
  return out;
}

export default function DataTable<R>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sorts,
  onSortsChange,
  groups = [],
  widths,
  onWidthsChange,
  selected,
  onSelectedChange,
  body,
  empty,
}: {
  // The columns showing, in order.
  columns: TableColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  onRowClick?: (row: R, e: React.MouseEvent) => void;
  // Sorted by these, in order (lib/table.ts); rows come already sorted.
  sorts: Sort[];
  onSortsChange: (sorts: Sort[]) => void;
  // Grouped by these: a group, then subgroups within it.
  groups?: GroupOption<R>[];
  // Widths people have dragged columns to, by key.
  widths: Record<string, number>;
  onWidthsChange: (widths: Record<string, number>) => void;
  // With these, rows get tick boxes.
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  // Lays the rows out itself (Inventory's folder tree), with the usual row
  // (its first cell's left padding in px, for indenting) and the full
  // column span. Groups don't apply then.
  body?: (renderRow: (row: R, indent?: number) => ReactNode, span: number) => ReactNode;
  // Shown under the header when there are no rows.
  empty?: ReactNode;
}) {
  const selectable = !!selected && !!onSelectedChange;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth - (selectable ? CHECKBOX_WIDTH : 0));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectable]);

  const fitted = fitWidths(columns, widths, available);
  const tableWidth = (selectable ? CHECKBOX_WIDTH : 0) + fitted.reduce((a, b) => a + b, 0);

  // Dragging starts from the width on screen, so the edge follows the mouse.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  function startResize(e: React.MouseEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const column = columns[index];
    const startX = e.clientX;
    const startWidth = fitted[index];
    const min = minOf(column);
    const move = (ev: MouseEvent) => {
      const width = Math.max(min, Math.round(startWidth + ev.clientX - startX));
      onWidthsChange({ ...widthsRef.current, [column.key]: width });
    };
    const end = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
    document.body.style.cursor = "col-resize";
  }

  function resetWidth(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const next = { ...widths };
    delete next[key];
    onWidthsChange(next);
  }

  // Groups that have been folded away, by their path ("group" or
  // "group/subgroup").
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (path: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const ids = rows.map(rowKey);
  const ticked = selectable ? ids.filter((id) => selected!.has(id)).length : 0;
  function toggleAll() {
    onSelectedChange!(ticked === ids.length ? new Set() : new Set(ids));
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange!(next);
  }
  // A group's tick box: all of its rows, or none.
  function toggleGroup(groupIds: string[], on: boolean) {
    const next = new Set(selected);
    for (const id of groupIds) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onSelectedChange!(next);
  }

  const span = columns.length + (selectable ? 1 : 0);

  function renderRow(row: R, indent?: number) {
    const id = rowKey(row);
    const isTicked = selectable && selected!.has(id);
    // An indented row carries its tick box in with it, beside the first cell.
    const inset = selectable && indent !== undefined;
    const tickBox = (
      <input type="checkbox" aria-label="Select" checked={isTicked} onChange={() => toggle(id)} onClick={(e) => e.stopPropagation()} />
    );
    return (
      <tr
        key={id}
        onClick={onRowClick ? (e) => onRowClick(row, e) : undefined}
        className={`${onRowClick ? "cursor-pointer" : ""} ${isTicked ? "bg-signal/[0.06] hover:bg-signal/10" : "hover:bg-gray-50"}`}
      >
        {selectable && (
          <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
            {!inset && tickBox}
          </td>
        )}
        {columns.map((c, i) => (
          <td
            key={c.key}
            title={c.title?.(row)}
            style={i === 0 && indent !== undefined ? { paddingLeft: indent } : undefined}
            className={`px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis border-r border-gray-100 last:border-r-0 ${c.align === "right" ? "text-right" : ""}`}
          >
            {i === 0 && inset ? (
              <span className="flex items-center gap-2 min-w-0">
                {tickBox}
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">{c.render(row)}</span>
              </span>
            ) : (
              c.render(row)
            )}
          </td>
        ))}
      </tr>
    );
  }

  // Rows grouped by groups[level] and below, each group with a heading row.
  function renderGroups(list: R[], level: number, parent: string): ReactNode {
    if (level >= groups.length) return list.map((r) => renderRow(r));
    const option = groups[level];
    const byId = new Map<string, { label: string; order: string | number; rows: R[] }>();
    for (const row of list) {
      const g = option.value(row);
      const entry = byId.get(g.id) ?? { label: g.label, order: g.order, rows: [] };
      entry.rows.push(row);
      byId.set(g.id, entry);
    }
    const ordered = [...byId].sort((a, b) => compare(a[1].order, b[1].order));
    return ordered.map(([gid, g]) => {
      const path = parent ? `${parent}/${gid}` : gid;
      const isFolded = folded.has(path);
      const groupIds = g.rows.map(rowKey);
      const tickedHere = selectable ? groupIds.filter((id) => selected!.has(id)).length : 0;
      return (
        <Fragment key={path}>
          <tr className={level === 0 ? "bg-gray-50" : "bg-gray-50/50"}>
            {selectable && (
              <td className="px-3 py-1.5">
                <input
                  type="checkbox"
                  aria-label={`Select ${g.label}`}
                  checked={tickedHere > 0 && tickedHere === groupIds.length}
                  ref={(el) => {
                    if (el) el.indeterminate = tickedHere > 0 && tickedHere < groupIds.length;
                  }}
                  onChange={() => toggleGroup(groupIds, tickedHere !== groupIds.length)}
                />
              </td>
            )}
            <td colSpan={span - (selectable ? 1 : 0)} className="py-1.5 pr-3" style={{ paddingLeft: 12 + level * 20 }}>
              <button type="button" onClick={() => fold(path)} className="flex items-center gap-1.5 min-w-0 max-w-full text-left" aria-expanded={!isFolded}>
                <svg
                  viewBox="0 0 20 20"
                  className={`w-3 h-3 shrink-0 text-gray-400 transition-transform ${isFolded ? "" : "rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 5l5 5-5 5" />
                </svg>
                <span className="eyebrow text-gray-400 shrink-0">{option.label}</span>
                <span className={`truncate ${level === 0 ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>{g.label}</span>
                <span className="font-mono text-[11px] text-gray-400 shrink-0">{g.rows.length.toLocaleString()}</span>
              </button>
            </td>
          </tr>
          {!isFolded && renderGroups(g.rows, level + 1, path)}
        </Fragment>
      );
    });
  }

  return (
    <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="overflow-auto flex-1 min-h-0">
        <table className="text-[13px] border-collapse" style={{ width: tableWidth, tableLayout: "fixed" }}>
          <colgroup>
            {selectable && <col style={{ width: CHECKBOX_WIDTH }} />}
            {columns.map((c, i) => (
              <col key={c.key} style={{ width: fitted[i] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-gray-200 text-left text-gray-500">
              {selectable && (
                <th className="px-3 py-2">
                  {ids.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={ticked > 0 && ticked === ids.length}
                      ref={(el) => {
                        if (el) el.indeterminate = ticked > 0 && ticked < ids.length;
                      }}
                      onChange={toggleAll}
                    />
                  )}
                </th>
              )}
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  onClick={() => c.sortValue && onSortsChange(headingSort(sorts, c.key))}
                  title={c.label}
                  aria-sort={sorts[0]?.key === c.key ? (sorts[0].dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`relative px-3 py-2 font-medium select-none whitespace-nowrap overflow-hidden text-ellipsis border-r border-gray-100 last:border-r-0 ${
                    c.sortValue ? "cursor-pointer hover:text-gray-800" : ""
                  } ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                  <SortMark sorts={sorts} columnKey={c.key} />
                  <div
                    onMouseDown={(e) => startResize(e, i)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => resetWidth(e, c.key)}
                    title="Drag to resize, double-click to reset"
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-signal/30 active:bg-signal/50"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {body ? body(renderRow, span) : renderGroups(rows, 0, "")}
          </tbody>
        </table>
        {empty}
      </div>
    </div>
  );
}

// A sorted column's arrow, numbered when there's more than one sort.
function SortMark({ sorts, columnKey }: { sorts: Sort[]; columnKey: string }) {
  const index = sorts.findIndex((s) => s.key === columnKey);
  if (index === -1) return null;
  return (
    <span className={`text-[10px] ml-1 ${index === 0 ? "" : "text-gray-400"}`}>
      {sorts[index].dir === "asc" ? "▲" : "▼"}
      {sorts.length > 1 && <sup className="ml-px">{index + 1}</sup>}
    </span>
  );
}
