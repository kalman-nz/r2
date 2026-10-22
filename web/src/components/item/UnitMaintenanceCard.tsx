import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Item, Serial } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { formatDay, invalidateMaintenance, useMaintenanceJobs, type RepairWithItem } from "../../lib/maintenance";
import { RepairStatusBadge } from "../StatusBadge";
import { ResultBadge } from "../maintenance/ResultBadge";
import NewJobModal from "../maintenance/NewJobModal";
import { useToast } from "../ToastProvider";
import { useFeature } from "../../lib/roles";

// A unit's maintenance and repairs, newest first, with what's next.
export default function UnitMaintenanceCard({ unit, item, repairs, canRecord }: { unit: Serial; item: Item | null; repairs: RepairWithItem[]; canRecord: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [scheduling, setScheduling] = useState(false);
  // Only what the organisation uses (Settings → Features).
  const feature = useFeature();
  const { data: jobs = [] } = useMaintenanceJobs(`serial = "${unit.id}"`, "dueOn", feature("maintenance"));
  const scheduled = jobs.filter((j) => j.status === "scheduled");
  // Done work and repairs together, by when they happened.
  const past = [
    ...jobs.filter((j) => j.status === "done").map((j) => ({ at: j.doneOn, job: j, repair: null })),
    ...(feature("repairs") ? repairs : []).map((r) => ({ at: r.created.slice(0, 10), job: null, repair: r })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="card overflow-hidden text-sm">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-500">Maintenance</h2>
        {canRecord && item && feature("maintenance") && (
          <button onClick={() => setScheduling(true)} className="btn-secondary py-1">
            Schedule
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {scheduled.map((j) => (
          <Link key={j.id} to={`/maintenance/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
            <span className="min-w-0">
              <span className="block text-gray-900 truncate">{j.name}</span>
              <span className="block text-xs text-gray-500">Due {formatDay(j.dueOn)}</span>
            </span>
            <ResultBadge job={j} />
          </Link>
        ))}
        {past.map((p) =>
          p.job ? (
            <Link key={p.job.id} to={`/maintenance/jobs/${p.job.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
              <span className="min-w-0">
                <span className="block text-gray-900 truncate">{p.job.name}</span>
                <span className="block text-xs text-gray-500">
                  {formatDay(p.job.doneOn)}
                  {p.job.doneBy && ` · ${p.job.doneBy}`}
                </span>
              </span>
              <ResultBadge job={p.job} />
            </Link>
          ) : (
            <Link key={p.repair!.id} to={`/maintenance/repairs/${p.repair!.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
              <span className="min-w-0">
                <span className="block text-gray-900 truncate">
                  <span className="font-mono text-xs text-gray-400 mr-1.5">R{p.repair!.number}</span>
                  {p.repair!.fault}
                </span>
                <span className="block text-xs text-gray-500">Repair, opened {formatDate(p.repair!.created)}</span>
              </span>
              <RepairStatusBadge status={p.repair!.status} />
            </Link>
          ),
        )}
        {scheduled.length === 0 && past.length === 0 && <p className="px-4 py-3 text-xs text-gray-500">No maintenance or repairs yet.</p>}
      </div>
      {scheduling && item && (
        <NewJobModal
          item={item}
          serials={[unit.id]}
          onClose={() => setScheduling(false)}
          onCreated={async () => {
            setScheduling(false);
            await invalidateMaintenance(queryClient);
            showToast("success", "Scheduled");
          }}
        />
      )}
    </section>
  );
}
