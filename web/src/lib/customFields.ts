import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { CustomField } from "./api";
import { orgFilter } from "./currentOrg";

// Custom fields on projects, contacts and locations (Settings → Projects →
// Custom fields; migration 0052): the organisation's own, in order, with
// each record's values under the field's key in its `custom` object. Items
// have their own (lib/catalog.ts useItemCustomFields).
export type CustomTarget = "job" | "contact" | "venue";

const NO_FIELDS: CustomField[] = [];

export function useCustomFields(appliesTo: CustomTarget) {
  const { data = NO_FIELDS, isLoading } = useQuery({
    queryKey: ["customFields", appliesTo],
    queryFn: () => pb.collection("custom_fields").getFullList<CustomField>({ filter: orgFilter(`appliesTo = "${appliesTo}"`), sort: "sortOrder,label" }),
    staleTime: 60_000,
  });
  return { fields: data, isLoading };
}

// A value as plain text, for lists, search and sorting ("" for none).
export function customText(field: CustomField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (field.type === "boolean" || typeof value === "boolean") return value === true || value === "true" ? "Yes" : "No";
  if (field.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  if (field.type === "number" && typeof value === "number") return value.toLocaleString();
  return String(value);
}

// For sorting a list column: numbers and dates in order, the rest as text.
export function customSortValue(field: CustomField, value: unknown): string | number {
  if (value === null || value === undefined || value === "") return "￿";
  if (field.type === "number" && typeof value === "number") return value;
  if (field.type === "date" && typeof value === "string") return value;
  return customText(field, value).toLowerCase();
}

// The custom field keys a saved view mentions ("custom:<key>" columns,
// sorts and groups), so they survive the view being applied before the
// fields have loaded.
export function customKeysIn(s: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("custom:")) out.add(v);
  };
  if (Array.isArray(s.columns)) s.columns.forEach(add);
  add(s.sortKey);
  if (Array.isArray(s.thenSort)) for (const t of s.thenSort) if (t && typeof t === "object") add((t as Record<string, unknown>).key);
  if (Array.isArray(s.groupBy)) s.groupBy.forEach(add);
  return [...out];
}

// A record's value for a field.
export function customValueOf(record: object, field: CustomField): unknown {
  const custom = (record as { custom?: unknown }).custom;
  return custom && typeof custom === "object" ? (custom as Record<string, unknown>)[field.key] : undefined;
}
