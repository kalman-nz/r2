import type { Shared } from "./api";

// Dashboards and saved views (Projects, Inventory) are kept and shared the
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

// The same filters? The server hands keys back in its own order, and a
// missing one is the same as an empty one.
export function sameConfig(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? "") === (b[k] ?? ""));
}
