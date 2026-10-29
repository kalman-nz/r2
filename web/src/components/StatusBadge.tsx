import type { ReactNode } from "react";
import type { JobStatus, QuoteStatus, SerialStatus } from "../lib/api";
import { useRepairStatuses } from "../lib/maintenance";
import { useJobStatuses } from "../lib/workflow";
import { JOB_STATUSES, SERIAL_STATUS_LABELS, STATUS_COLOURS } from "../lib/statuses";
import type { Progress } from "../lib/tracking";

// Statuses read as a coloured dot and plain text: the colour's there to
// scan by, without a filled pill behind every row.
const JOB_DOTS: Record<JobStatus, string> = {
  enquiry: "bg-gray-400",
  provisional: "bg-amber-500",
  confirmed: "bg-data",
  out: "bg-violet-500",
  returned: "bg-emerald-500",
  cancelled: "bg-gray-300",
};

const SERIAL_DOTS: Record<SerialStatus, string> = {
  active: "bg-emerald-500",
  repair: "bg-amber-500",
  lost: "bg-red-500",
  retired: "bg-gray-400",
};

const QUOTE_DOTS: Record<QuoteStatus, string> = {
  issued: "bg-data",
  accepted: "bg-emerald-500",
  declined: "bg-red-500",
  void: "bg-gray-300",
};

export function Dotted({ dot, text = "text-gray-700", title, children }: { dot: string; text?: string; title?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${text}`} title={title}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

// A project's status: the organisation's own name and colour when the
// project's jobStatus is known, else its stage's.
export function JobStatusBadge({ status, jobStatus }: { status: JobStatus; jobStatus?: string }) {
  const def = useJobStatuses().byId.get(jobStatus ?? "");
  const cancelled = status === "cancelled";
  const text = cancelled ? "text-gray-400 line-through" : undefined;
  if (def) return <Dotted dot={STATUS_COLOURS[def.colour || "gray"].dot} text={text}>{def.name}</Dotted>;
  const label = JOB_STATUSES.find((s) => s.value === status)?.label ?? status;
  return <Dotted dot={JOB_DOTS[status] ?? "bg-gray-400"} text={text}>{label}</Dotted>;
}

// A project that's overdue (lib/overdue.ts), with why on hover.
export function OverdueBadge({ reason }: { reason: string }) {
  if (!reason) return null;
  return (
    <Dotted dot="bg-red-500" text="text-fault-ink" title={reason}>
      Overdue
    </Dotted>
  );
}

export function SerialStatusBadge({ status }: { status: SerialStatus }) {
  return <Dotted dot={SERIAL_DOTS[status] ?? "bg-gray-400"}>{SERIAL_STATUS_LABELS[status] ?? status}</Dotted>;
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const label = status === "void" ? "Void" : status.charAt(0).toUpperCase() + status.slice(1);
  return <Dotted dot={QUOTE_DOTS[status] ?? "bg-gray-400"} text={status === "void" ? "text-gray-400" : undefined}>{label}</Dotted>;
}

// Where some kit is on its way out and back (lib/tracking.ts): the furthest
// step all of it has reached, and how much has reached the next one.
export function TrackingStatus({ progress, compact = false }: { progress: Progress | null; compact?: boolean }) {
  if (!progress || progress.total === 0) return null;
  const { current, next, nextCount, total } = progress;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {current ? (
        <Dotted dot={STATUS_COLOURS[current.colour || "gray"].dot}>{current.name}</Dotted>
      ) : (
        <Dotted dot="bg-white ring-1 ring-inset ring-gray-300" text="text-gray-500">
          {progress.started > 0 ? "In progress" : "Not started"}
        </Dotted>
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
  return <Dotted dot={STATUS_COLOURS[def?.colour || "gray"].dot}>{def?.name ?? "…"}</Dotted>;
}
