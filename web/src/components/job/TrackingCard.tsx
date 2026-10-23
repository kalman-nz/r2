import { Link } from "react-router-dom";
import type { JobLineView, JobSummary } from "../../lib/api";
import { STATUS_COLOURS } from "../../lib/statuses";
import { addAt, linesProgress, useTrackingSteps } from "../../lib/tracking";
import { TrackingStatus } from "../StatusBadge";
import TrackingSuggestion from "./TrackingSuggestion";

// Where a project's kit is (equipment tracking): the whole project, then each
// heading, so the audio can be Loaded while the lighting's only Prepped.
// There's no switch: a project's tracked once someone scans its kit, and a
// project nobody scans just goes without.
export default function TrackingCard({ summary, canScan }: { summary: JobSummary; canScan: boolean }) {
  const { steps } = useTrackingSteps();
  const { job, packing } = summary;
  const scanLink = canScan && (
    <Link to={`/projects/${job.id}/scan`} className="text-xs text-signal-ink hover:text-signal-ink-hover">
      Scan →
    </Link>
  );

  if (packing.scanCount === 0) {
    return (
      <section className="card p-4 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-500">Equipment tracking</h2>
          {scanLink}
        </div>
        <p className="text-gray-500 text-xs">Nothing's been scanned yet. Scan this project's kit to track it; projects nobody scans go without.</p>
      </section>
    );
  }
  const notBack = packing.items.reduce((sum, i) => sum + Math.max(0, i.out), 0);
  const tracked = summary.lines.filter((l) => l.tracking);
  const total = tracked.reduce((sum, l) => sum + Math.round(l.quantity), 0);
  const at = tracked.reduce((sum, l) => addAt(sum, l.tracking!.at), {} as Record<string, number>);
  const overall = linesProgress(steps, tracked);

  // By heading, in the order they're on the project.
  const headings: { name: string; lines: JobLineView[] }[] = [];
  for (const line of tracked) {
    const name = line.group || "No heading";
    let heading = headings.find((h) => h.name === name);
    if (!heading) headings.push((heading = { name, lines: [] }));
    heading.lines.push(line);
  }

  return (
    <section className="card p-4 flex flex-col gap-2.5 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500">Equipment tracking</h2>
        {scanLink}
      </div>
      {job.status === "returned" && notBack > 0 && (
        <p className="text-xs font-medium text-fault-ink">
          Overdue: the project's returned, but {notBack} unit{notBack === 1 ? " hasn't" : "s haven't"} been tracked back in.
        </p>
      )}
      {canScan && <TrackingSuggestion summary={summary} />}
      {total === 0 ? (
        <p className="text-gray-500 text-xs">No physical kit on this project.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <TrackingStatus progress={overall} />
            <span className="text-xs text-gray-500 tabular-nums">{total} units</span>
          </div>
          {/* Each step's share of the units, in order. */}
          <div className="flex h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
            {steps.map((s) =>
              at[s.id] ? <div key={s.id} className={STATUS_COLOURS[s.colour || "gray"].dot} style={{ width: `${(at[s.id] / total) * 100}%` }} title={`${at[s.id]} ${s.name}`} /> : null,
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
            {steps
              .filter((s) => at[s.id])
              .map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLOURS[s.colour || "gray"].dot}`} />
                  {at[s.id]} {s.name}
                </span>
              ))}
            {total - (overall?.started ?? 0) > 0 && <span>{total - (overall?.started ?? 0)} not started</span>}
          </div>
          {headings.length > 1 && (
            <div className="flex flex-col divide-y divide-gray-100 border-t border-gray-100 -mx-1">
              {headings.map((h) => (
                <div key={h.name} className="flex items-center justify-between gap-2 px-1 py-1.5">
                  <span className="text-gray-800 truncate">{h.name}</span>
                  <TrackingStatus progress={linesProgress(steps, h.lines)} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
