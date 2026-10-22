import type { JobStatus, QuoteStatus, SerialStatus } from "../lib/api";
import { useRepairStatuses } from "../lib/maintenance";
import { useJobStatuses } from "../lib/workflow";
import { JOB_STATUSES, SERIAL_STATUS_LABELS, STATUS_COLOURS } from "../lib/statuses";
import type { Progress } from "../lib/tracking";

const JOB_STYLES: Record<JobStatus, string> = {
  enquiry: "bg-gray-100 text-gray-600",
  provisional: "bg-amber-50 text-amber-700",
  confirmed: "bg-data-soft text-data-ink",
  out: "bg-violet-50 text-violet-700",
  returned: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-400 line-through",
};

const SERIAL_STYLES: Record<SerialStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  repair: "bg-amber-50 text-amber-700",
  lost: "bg-red-50 text-red-700",
  retired: "bg-gray-100 text-gray-500",
};

const QUOTE_STYLES: Record<QuoteStatus, string> = {
  issued: "bg-data-soft text-data-ink",
  accepted: "bg-emerald-50 text-emerald-700",
  declined: "bg-red-50 text-red-700",
  void: "bg-gray-100 text-gray-400",
};

const base = "inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";

// A project's status: the organisation's own name and colour when the
// project's jobStatus is known, else its stage's.
export function JobStatusBadge({ status, jobStatus }: { status: JobStatus; jobStatus?: string }) {
  const def = useJobStatuses().byId.get(jobStatus ?? "");
  if (def) return <span className={`${base} ${STATUS_COLOURS[def.colour || "gray"].badge}`}>{def.name}</span>;
  const label = JOB_STATUSES.find((s) => s.value === status)?.label ?? status;
  return <span className={`${base} ${JOB_STYLES[status] ?? ""}`}>{label}</span>;
}

export function SerialStatusBadge({ status }: { status: SerialStatus }) {
  return <span className={`${base} ${SERIAL_STYLES[status] ?? ""}`}>{SERIAL_STATUS_LABELS[status] ?? status}</span>;
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const label = status === "void" ? "Void" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`${base} ${QUOTE_STYLES[status] ?? ""}`}>{label}</span>;
}

// Where some kit is on its way out and back (lib/tracking.ts): the furthest
// step all of it has reached, and how much has reached the next one.
export function TrackingStatus({ progress, compact = false }: { progress: Progress | null; compact?: boolean }) {
  if (!progress || progress.total === 0) return null;
  const { current, next, nextCount, total } = progress;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {current ? (
        <span className={`${base} ${STATUS_COLOURS[current.colour || "gray"].badge}`}>{current.name}</span>
      ) : (
        <span className={`${base} bg-white text-gray-500 ring-1 ring-inset ring-gray-200`}>Not started</span>
      )}
      {next && nextCount > 0 && (
        <span className="text-xs text-gray-500 tabular-nums" title={`${nextCount} of ${total} ${next.name} or further along`}>
          {nextCount}/{total}
          {!compact && ` ${next.name}`}
        </span>
      )}
    </span>
  );
}

// A repair's status in its organisation's own name and colour.
export function RepairStatusBadge({ status }: { status: string }) {
  const def = useRepairStatuses().byId.get(status);
  return <span className={`${base} ${STATUS_COLOURS[def?.colour || "gray"].badge}`}>{def?.name ?? "…"}</span>;
}
