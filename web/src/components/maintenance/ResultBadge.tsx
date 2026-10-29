import type { MaintenanceJob } from "../../lib/api";
import { daysUntil, dueLabel, resultLabel } from "../../lib/maintenance";
import { Dotted } from "../StatusBadge";

// Passed / Failed (or Done / Needs repair for a service) once it's done;
// how it stands against its due date before then. A dot and plain text,
// like the other statuses.
export function ResultBadge({ job }: { job: Pick<MaintenanceJob, "status" | "result" | "kind" | "dueOn" | "failedQty"> }) {
  if (job.status === "done") {
    const pass = job.result === "pass";
    return (
      <Dotted dot={pass ? "bg-emerald-500" : "bg-red-500"} text={pass ? "text-gray-700" : "text-fault-ink"}>
        {resultLabel(job)}
        {!pass && job.failedQty > 0 && ` (${job.failedQty})`}
      </Dotted>
    );
  }
  const days = daysUntil(job.dueOn);
  return (
    <Dotted dot={days < 0 ? "bg-red-500" : days <= 7 ? "bg-amber-500" : "bg-white ring-1 ring-inset ring-gray-300"} text={days < 0 ? "text-fault-ink" : "text-gray-700"}>
      {dueLabel(job.dueOn)}
    </Dotted>
  );
}
