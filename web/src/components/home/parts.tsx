import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ProjectRow } from "../../lib/home";

// The pieces dashboards are drawn with (pages/Dashboard.tsx).

export function Stat({ label, value, hint, alert = false, to }: { label: string; value: number | string; hint: string; alert?: boolean; to?: string }) {
  const body = (
    <>
      <span className="eyebrow text-gray-500 truncate">{label}</span>
      <span className={`font-display text-2xl tabular-nums leading-tight ${alert ? "text-fault-ink" : "text-gray-900"}`}>{value}</span>
      <span className={`text-xs truncate ${alert ? "text-fault-ink" : "text-gray-500"}`}>{hint}</span>
    </>
  );
  const className = `card px-3.5 py-3 flex flex-col gap-0.5 min-w-0 ${alert ? "shadow-[inset_3px_0_0_var(--color-fault)]" : ""}`;
  return to ? (
    <Link to={to} className={`${className} hover:border-gray-300 hover:bg-gray-50 transition-colors`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function Panel({
  title,
  sub,
  count,
  action,
  empty,
  children,
}: {
  title: string;
  sub: string;
  count: number;
  action?: { to: string; label: string };
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-2 border-b border-gray-200">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {title} <span className="font-mono text-xs text-gray-400 ml-1">{count}</span>
          </h2>
          <p className="text-xs text-gray-500 truncate">{sub}</p>
        </div>
        {action && (
          <Link to={action.to} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover whitespace-nowrap">
            {action.label}
          </Link>
        )}
      </div>
      {count === 0 ? <p className="px-4 py-6 text-sm text-gray-500 text-center">{empty}</p> : <div className="divide-y divide-gray-100">{children}</div>}
    </section>
  );
}

export function DayGroup({ title, late, count, children }: { title: string; late: boolean; count: number; children: ReactNode }) {
  return (
    <div>
      <div className={`px-4 pt-2.5 pb-1 eyebrow ${late ? "text-fault-ink" : "text-gray-500"}`}>
        {title} <span className="text-gray-400 ml-1">{count}</span>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  );
}

export function Row({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <div onClick={onOpen} className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-gray-50 cursor-pointer">
      {children}
    </div>
  );
}

export function ProjectName({ job }: { job: ProjectRow }) {
  return (
    <div className="font-medium text-gray-900 truncate">
      <span className="font-mono text-xs text-gray-500 mr-1.5">{job.number}</span>
      {job.name}
    </div>
  );
}

export function ProjectLine({
  job,
  when,
  late,
  scan,
  extra,
  onOpen,
}: {
  job: ProjectRow;
  when: string;
  late: boolean;
  scan?: string;
  // Anything else for the line's end (a badge, packing progress).
  extra?: ReactNode;
  onOpen: () => void;
}) {
  const where = [job.expand?.client?.name, job.expand?.venue?.name].filter(Boolean).join(" · ");
  return (
    <Row onOpen={onOpen}>
      <span className={`w-24 shrink-0 text-xs tabular-nums ${late ? "text-fault-ink font-medium" : "text-gray-600"}`}>{when}</span>
      <div className="min-w-0 flex-1">
        <ProjectName job={job} />
        {where && <div className="text-xs text-gray-500 truncate">{where}</div>}
      </div>
      {extra}
      {scan && (
        <Link to={`/projects/${job.id}/scan`} onClick={(e) => e.stopPropagation()} className="btn-secondary !px-2.5 !py-1 !text-xs whitespace-nowrap">
          {scan}
        </Link>
      )}
    </Row>
  );
}

export function More({ shown, total, to }: { shown: number; total: number; to: string }) {
  if (total <= shown) return null;
  return (
    <Link to={to} className="block px-4 py-2 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-50">
      and {total - shown} more…
    </Link>
  );
}

// How much of a project's kit is out: "12 of 40 packed".
export function Packed({ needed, out }: { needed: number; out: number }) {
  if (needed <= 0) return <span className="text-xs text-gray-400 whitespace-nowrap">No kit</span>;
  const done = out >= needed;
  return (
    <span className="flex flex-col items-end gap-1 w-24 shrink-0">
      <span className={`text-xs tabular-nums whitespace-nowrap ${done ? "text-emerald-700 font-medium" : "text-gray-600"}`}>
        {done ? "All packed" : `${out} of ${needed} out`}
      </span>
      <span className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <span className={`block h-full ${done ? "bg-emerald-500" : "bg-data"}`} style={{ width: `${Math.min(100, (out / needed) * 100)}%` }} />
      </span>
    </span>
  );
}
