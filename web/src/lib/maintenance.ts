import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { IntervalUnit, Item, MaintenanceJob, MaintenanceKind, MaintenancePlan, Repair, RepairStatusDef, Serial } from "./api";
import { orgFilter } from "./currentOrg";
import { localDateInput } from "./format";
import { MAINTENANCE_KINDS } from "./statuses";

// Maintenance and repairs on the web side (pb_hooks/lib/maintenance.js and
// repairs.js have the rules). Due and done dates are calendar days
// ("2026-10-22"), compared as text with today's local date.

export type JobWithExpand = MaintenanceJob & { expand?: { item?: Item; serial?: Serial; plan?: MaintenancePlan } };
export type RepairWithItem = Repair & { expand?: { item?: Item; job?: { id: string; number: number; name: string } } };

export const today = () => localDateInput(new Date());

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

export function useRepairs(filter?: string) {
  return useQuery({
    queryKey: ["repairs", filter ?? ""],
    queryFn: () => pb.collection("repairs").getFullList<RepairWithItem>({ filter: orgFilter(filter), sort: "-number", expand: "item,job" }),
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
