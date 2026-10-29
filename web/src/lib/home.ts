import type { Contact, FeatureKey, Job, Venue } from "./api";
import { localDateInput, parseDate } from "./format";
import { daysUntil, today } from "./maintenance";

// What dashboards are made of (pages/Dashboard.tsx draws them): everyone
// picks their own panels and order (pb_hooks/lib/views.js keeps them). A
// panel someone can't use — their role can't see quotes, or the
// organisation's turned the feature off — just doesn't show for them, so a
// shared dashboard never shows anyone more than they could see anyway.
//
// size: full goes across the top; wide panels fill the main column and side
// ones the narrow column, each in the dashboard's order.

export type PanelId = "glance" | "mine" | "prep" | "going-out" | "coming-back" | "out-now" | "confirm" | "maintenance" | "repairs" | "quotes";

export interface PanelInfo {
  id: PanelId;
  label: string;
  hint: string;
  size: "full" | "wide" | "side";
  permission?: string;
  feature?: FeatureKey;
}

export const PANELS: PanelInfo[] = [
  // Without projects, it's the inventory's: maintenance, repairs and units out of service.
  { id: "glance", label: "At a glance", hint: "Going out and due back today, overdue returns, what's out, maintenance and repairs", size: "full" },
  { id: "mine", label: "My projects", hint: "The projects you're on the crew for, soonest first", size: "wide", feature: "projects" },
  { id: "prep", label: "To prep next", hint: "Confirmed projects in the order they go out, with how much is packed", size: "wide", feature: "projects" },
  { id: "going-out", label: "Going out", hint: "Confirmed projects going out in the next 7 days, by day", size: "wide", feature: "projects" },
  { id: "coming-back", label: "Coming back", hint: "Projects out on hire, due back in the next 7 days", size: "wide", feature: "projects" },
  { id: "out-now", label: "Out now", hint: "Everything out on hire, by when it's due back", size: "side", feature: "projects" },
  { id: "confirm", label: "Needs confirming", hint: "Enquiries and pencilled projects starting within 14 days", size: "side", feature: "projects" },
  { id: "maintenance", label: "Maintenance due", hint: "Maintenance overdue and due in the next 7 days", size: "side", feature: "maintenance" },
  { id: "repairs", label: "Open repairs", hint: "Kit out of service for repair", size: "side", feature: "repairs" },
  { id: "quotes", label: "Quotes waiting", hint: "Issued quotes waiting on the client, and what they're worth", size: "side", permission: "quotes.view", feature: "pricing" },
];

export const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));

// The Home page anyone gets before there's a dashboard (or if theirs has
// gone): the same as the organisation's default Overview.
export const STANDARD_PANELS: PanelId[] = ["glance", "going-out", "coming-back", "confirm", "maintenance", "repairs", "quotes"];

// Whether someone can use a panel: the permission and feature it needs.
export function panelAllowed(panel: PanelInfo, can: (p: string) => boolean, feature: (k: FeatureKey) => boolean): boolean {
  return (!panel.permission || can(panel.permission)) && (!panel.feature || feature(panel.feature));
}

export type ProjectRow = Job & { expand?: { client?: Contact; venue?: Venue } };

// The local calendar day of a stored datetime ("2026-10-22"), "" if none.
export function dayOf(value: string): string {
  const d = parseDate(value);
  return d ? localDateInput(d) : "";
}

export function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// "Starts today", "Starts in 3 days", "Started 2 days ago"
export function startsLabel(day: string): string {
  const n = daysUntil(day);
  if (n === 0) return "Starts today";
  if (n === 1) return "Starts tomorrow";
  if (n > 1) return `Starts in ${n} days`;
  return n === -1 ? "Started yesterday" : `Started ${-n} days ago`;
}

// Rows bucketed by calendar day, in the order given: past days fold into
// one "late" group at the top, then Today, Tomorrow, and each day after.
export function byDay<T>(rows: T[], at: (row: T) => string, lateTitle: string) {
  const now = today();
  const groups: { key: string; title: string; late: boolean; rows: T[] }[] = [];
  for (const row of rows) {
    const day = dayOf(at(row));
    const late = day < now;
    const key = late ? "late" : day;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const n = daysUntil(day);
      const title = late
        ? lateTitle
        : n === 0
          ? "Today"
          : n === 1
            ? "Tomorrow"
            : (parseDate(at(row))?.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }) ?? day);
      group = { key, title, late, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}
