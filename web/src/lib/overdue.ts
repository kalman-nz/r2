import type { Job } from "./api";
import { parseDate } from "./format";

// Why a project's overdue, or "" when it isn't:
// - it's out and past when its kit was due back, or
// - it's been set to returned but some of its kit hasn't been tracked back
//   in yet (unitsOut: units still out, from its scans; projects nobody
//   scans never have any).
export function overdueReason(job: Pick<Job, "status" | "returnAt">, unitsOut: number, now = Date.now()): string {
  if (job.status === "returned" && unitsOut > 0) return `Returned, but ${unitsOut} unit${unitsOut === 1 ? "" : "s"} not back yet`;
  const due = parseDate(job.returnAt)?.getTime();
  if (job.status === "out" && due !== undefined && due < now) return "Out past its return time";
  return "";
}
