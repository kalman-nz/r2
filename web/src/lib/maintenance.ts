import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { IntervalUnit, Item, MaintenanceJob, MaintenanceKind, MaintenancePlan, Repair, RepairStatusDef, Serial } from "./api";
import { orgFilter } from "./currentOrg";
import { localDateInput, toDateInput } from "./format";
import { MAINTENANCE_KINDS } from "./statuses";

// Maintenance and repairs on the web side (pb_hooks/lib/maintenance.js and
// repairs.js have the rules). Due and done dates are calendar days
// ("2026-10-22"), compared as text with today's local date.

export type JobWithExpand = MaintenanceJob & { expand?: { item?: Item; serial?: Serial; plan?: MaintenancePlan } };
export type RepairWithItem = Repair & { expand?: { item?: Item; job?: { id: string; number: number; name: string }; serials?: Serial[] } };

export const today = () => localDateInput(new Date());

// Whether a date picked as a day (saved as its local midnight, like a
// repair's expected back) is behind us. On the day itself it isn't late.
export function dayPassed(value: string | null | undefined): boolean {
  const day = toDateInput(value);
  return day !== "" && day < today();
}

// The calendar day n days from today.
export function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateInput(d);
}

function dayToDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// "Thu 22 Oct 2026" for a calendar day, in no particular time zone.
export function formatDay(day: string | null | undefined): string {
  const d = dayToDate(day ?? "");
  return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—";
}

// Whole days from today to `day`: negative when it's past.
export function daysUntil(day: string, from = today()): number {
  const a = dayToDate(from);
  const b = dayToDate(day);
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86400000) : 0;
}

// "3 days overdue", "Due today", "In 5 days", "In 3 months"
export function dueLabel(day: string): string {
  const n = daysUntil(day);
  if (n < 0) return n === -1 ? "1 day overdue" : `${-n} days overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n < 60) return `In ${n} days`;
  const months = Math.round(n / 30.4);
  return months < 24 ? `In ${months} months` : `In ${Math.round(n / 365)} years`;
}

export function describeInterval(every: number, unit: IntervalUnit): string {
  return every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
}

function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

// How a plan repeats: "Every month on the 15th", "Every 2 weeks on
// Tuesday", "Every year on 15 March", or "Every 3 months after completion".
export function describePlan(plan: Pick<MaintenancePlan, "every" | "unit" | "repeat" | "firstDue">): string {
  const every = describeInterval(plan.every, plan.unit);
  const start = dayToDate(plan.firstDue ?? "");
  if (plan.repeat !== "fixed" || !start) return `${every} after completion`;
  if (plan.unit === "week") return `${every} on ${start.toLocaleDateString(undefined, { weekday: "long" })}`;
  const dayMonth = start.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  if (plan.unit === "month" && plan.every % 12 === 0) return `${describeInterval(plan.every / 12, "year")} on ${dayMonth}`;
  if (plan.unit === "month") return plan.every === 1 ? `${every} on the ${ordinal(start.getDate())}` : `${every} on the ${ordinal(start.getDate())}, from ${dayMonth}`;
  if (plan.unit === "year") return `${every} on ${dayMonth}`;
  return `${every} from ${formatDay(plan.firstDue)}`;
}

export function kindOf(kind: MaintenanceKind) {
  return MAINTENANCE_KINDS.find((k) => k.value === kind) ?? MAINTENANCE_KINDS[0];
}

// "Passed", "Failed", "Done", "Needs repair"
export function resultLabel(job: Pick<MaintenanceJob, "kind" | "result">): string {
  if (!job.result) return "";
  const k = kindOf(job.kind);
  return job.result === "pass" ? k.pass : k.fail;
}

// What a job is for: "Harness · H-0003", "Hard hats", or "—".
export function assetLabel(job: JobWithExpand): string {
  const item = job.expand?.item;
  const unit = job.expand?.serial;
  if (!item) return job.item ? "(deleted item)" : "—";
  return unit ? `${item.name} · ${unit.label || unit.barcode || "unit"}` : item.name;
}

// A unit's name on a list: its label, else its barcode.
export function unitName(unit: Pick<Serial, "label" | "barcode"> | null | undefined): string {
  return unit ? unit.label || unit.barcode || "unit" : "";
}

// Where a due date falls, for grouping: overdue, this week, or later.
export function dueBucket(day: string): { id: string; label: string; order: number } {
  const n = daysUntil(day);
  if (n < 0) return { id: "overdue", label: "Overdue", order: 0 };
  if (n <= 7) return { id: "week", label: "Due in the next 7 days", order: 1 };
  if (n <= 30) return { id: "month", label: "Due in the next 30 days", order: 2 };
  return { id: "later", label: "Later", order: 3 };
}

// "October 2026" for grouping by month; order is "2026-10".
export function monthOf(day: string): { id: string; label: string; order: string } {
  const d = dayToDate(day);
  if (!d) return { id: "none", label: "No date", order: "9999" };
  const id = day.slice(0, 7);
  return { id, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), order: id };
}

export function useMaintenanceJobs(filter: string, sort = "dueOn", enabled = true) {
  return useQuery({
    queryKey: ["maintenance-jobs", filter, sort],
    queryFn: () => pb.collection("maintenance_jobs").getFullList<JobWithExpand>({ filter: orgFilter(filter), sort, expand: "item,serial,plan" }),
    enabled,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["maintenance-plans"],
    queryFn: () => pb.collection("maintenance_plans").getFullList<MaintenancePlan>({ filter: orgFilter(), sort: "name" }),
  });
}

const NO_STATUSES: RepairStatusDef[] = [];

// The organisation's repair statuses, in order, with lookups by id (the
// same objects until the list changes, so they can go in hook deps). A
// repair whose status can't be found counts as open, as on the server.
export function useRepairStatuses() {
  const { data: statuses = NO_STATUSES, isLoading } = useQuery({
    queryKey: ["repair-statuses"],
    queryFn: () => pb.collection("repair_statuses").getFullList<RepairStatusDef>({ filter: orgFilter(), sort: "sortOrder,created" }),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const byId = new Map(statuses.map((s) => [s.id, s]));
    const open = statuses.filter((s) => s.stage === "open");
    return {
      statuses,
      isLoading,
      byId,
      isOpen: (id: string) => (byId.get(id)?.stage ?? "open") === "open",
      name: (id: string) => byId.get(id)?.name ?? "",
      // Where new repairs start.
      defaultId: (open.find((s) => s.isDefault) ?? open[0])?.id ?? "",
    };
  }, [statuses, isLoading]);
}

export function useRepairs(filter?: string, enabled = true) {
  return useQuery({
    queryKey: ["repairs", filter ?? ""],
    queryFn: () => pb.collection("repairs").getFullList<RepairWithItem>({ filter: orgFilter(filter), sort: "-number", expand: "item,job,serials" }),
    enabled,
  });
}

// Everything a repair or a maintenance job can change: repairs, jobs and
// plans, units, item stock and availability.
export function invalidateMaintenance(queryClient: QueryClient) {
  return Promise.all(
    ["repairs", "maintenance-jobs", "maintenance-plans", "maintenance-job", "serials", "serial", "items", "item", "availability"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
