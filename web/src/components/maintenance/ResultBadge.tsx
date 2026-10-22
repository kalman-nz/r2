import type { MaintenanceJob } from "../../lib/api";
import { daysUntil, dueLabel, resultLabel } from "../../lib/maintenance";

const base = "inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";

// Passed / Failed (or Done / Needs repair for a service) once it's done;
// how it stands against its due date before then.
export function ResultBadge({ job }: { job: Pick<MaintenanceJob, "status" | "result" | "kind" | "dueOn" | "failedQty"> }) {
  if (job.status === "done") {
    const pass = job.result === "pass";
    return (
      <span className={`${base} ${pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
        {resultLabel(job)}
        {!pass && job.failedQty > 0 && ` (${job.failedQty})`}
      </span>
    );
  }
  const overdue = daysUntil(job.dueOn) < 0;
  return <span className={`${base} ${overdue ? "bg-red-50 text-red-700" : "bg-data-soft text-data-ink"}`}>{dueLabel(job.dueOn)}</span>;
}
