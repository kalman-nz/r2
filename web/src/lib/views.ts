import type { Shared, ViewConfig } from "./api";

// Dashboards and saved views (Inventory, Projects, Contacts, Locations) are kept and shared the
// same way (pb_hooks/lib/sharing.js), so they're picked and managed with the
// same menus: components/ViewMenu.tsx and components/ManageViews.tsx.
export type ViewLike = Shared & { id: string; name: string };

// Everything someone can see, grouped by whose it is.
export function groupViews<T extends ViewLike>(views: T[]) {
  return [
    { label: "Yours", rows: views.filter((v) => v.isOwner) },
    { label: "Shared with you", rows: views.filter((v) => !v.isOwner && !v.public) },
    { label: "Everyone's", rows: views.filter((v) => !v.isOwner && v.public) },
  ].filter((g) => g.rows.length > 0);
}

// Who one's shared with, in a few words.
export function sharedLabel(view: Pick<Shared, "public" | "sharedWith">): string {
  if (view.public) return "Everyone";
  if (view.sharedWith.length > 0) return view.sharedWith.length === 1 ? view.sharedWith[0].name || "1 person" : `${view.sharedWith.length} people`;
  return "Only you";
}

// Whose it is, for one that isn't yours.
export function byLabel(view: ViewLike, orgName = ""): string {
  if (view.isOwner) return "";
  return view.ownerName ? `by ${view.ownerName}` : orgName ? `${orgName}'s` : "";
}

// What a saved view gives its page: its own settings over the page's
// built-in ones, for the settings the page has now (any it no longer has
// are left out).
export function viewSettings(defaults: ViewConfig, saved: ViewConfig | undefined): ViewConfig {
  const out: ViewConfig = {};
  for (const key of Object.keys(defaults)) out[key] = saved && key in saved ? saved[key] : defaults[key];
  return out;
}

// The same settings? Object keys in any order: the server sorts them.
export function sameSettings(a: ViewConfig, b: ViewConfig): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// Reading a view's settings back safely: they're JSON from the server.
export const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
export const asBool = (value: unknown) => value === true;
export const asStrings = (value: unknown, allowed?: string[]) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && (!allowed || allowed.includes(v))) : [];
