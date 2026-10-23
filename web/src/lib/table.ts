import type { TableColumn } from "../components/DataTable";
import type { ViewConfig } from "./api";
import { asString } from "./views";

// Sorting and grouping for the list tables (components/DataTable.tsx), and
// how saved views keep them.

export type SortDir = "asc" | "desc";
export interface Sort {
  key: string;
  dir: SortDir;
}

// Up to three sorts: by the first, then the next for ties, and so on.
export const MAX_SORTS = 3;

// Rows in order of `sorts`, using each column's sortValue: numbers as
// numbers, the rest as text (with numbers inside it in number order).
export function sortRows<R>(rows: R[], columns: TableColumn<R>[], sorts: Sort[]): R[] {
  const keys = sorts
    .map((s) => ({ value: columns.find((c) => c.key === s.key)?.sortValue, sign: s.dir === "asc" ? 1 : -1 }))
    .filter((k): k is { value: (row: R) => string | number; sign: number } => !!k.value);
  if (keys.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { value, sign } of keys) {
      const c = compare(value(a), value(b));
      if (c !== 0) return c * sign;
    }
    return 0;
  });
}

export function compare(a: string | number, b: string | number): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// A way to group a list's rows: each row's group, with a label and where
// the group goes among the others.
export interface GroupOption<R> {
  key: string;
  label: string;
  value: (row: R) => { id: string; label: string; order: string | number };
}

// How a saved view keeps them: the first sort as sortKey and sortDir (as
// views did before there could be more), the rest as thenSort, and the
// group keys in order (group, then subgroup) as groupBy.
export function sortSettings(sorts: Sort[]): ViewConfig {
  return { sortKey: sorts[0]?.key ?? "", sortDir: sorts[0]?.dir ?? "asc", thenSort: sorts.slice(1) };
}

export function readSorts(s: ViewConfig, valid: string[], fallback: Sort): Sort[] {
  const key = asString(s.sortKey);
  const first: Sort = valid.includes(key) ? { key, dir: s.sortDir === "desc" ? "desc" : "asc" } : fallback;
  const rest = Array.isArray(s.thenSort) ? s.thenSort : [];
  const out = [first];
  for (const r of rest) {
    if (!r || typeof r !== "object") continue;
    const k = asString((r as Record<string, unknown>).key);
    if (!valid.includes(k) || out.some((o) => o.key === k)) continue;
    out.push({ key: k, dir: (r as Record<string, unknown>).dir === "desc" ? "desc" : "asc" });
  }
  return out.slice(0, MAX_SORTS);
}

export function readGroups(s: ViewConfig, valid: string[]): string[] {
  const keys = Array.isArray(s.groupBy) ? s.groupBy.filter((k): k is string => typeof k === "string" && valid.includes(k)) : [];
  return [...new Set(keys)].slice(0, 2);
}

// Clicking a column's heading: sorts by it first (or flips it, if it's
// already first), keeping the other sorts after it.
export function headingSort(sorts: Sort[], key: string): Sort[] {
  if (sorts[0]?.key === key) return [{ key, dir: sorts[0].dir === "asc" ? "desc" : "asc" }, ...sorts.slice(1)];
  return [{ key, dir: "asc" as SortDir }, ...sorts.filter((s) => s.key !== key)].slice(0, MAX_SORTS);
}
