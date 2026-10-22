import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Item } from "../../lib/api";
import { formatDate, nzd, parseDate } from "../../lib/format";
import { assetLabel, describeInterval, formatDay, invalidateMaintenance, useMaintenanceJobs, usePlans, useRepairStatuses, useRepairs } from "../../lib/maintenance";
import { RepairStatusBadge } from "../StatusBadge";
import { ResultBadge } from "../maintenance/ResultBadge";
import NewJobModal from "../maintenance/NewJobModal";
import { useToast } from "../ToastProvider";

// An item's maintenance tab: the plans it's on, what's scheduled, its
// repairs (with what they've cost), and what's been done.
export default function MaintenanceSection({ item, canRecord }: { item: Item; canRecord: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [scheduling, setScheduling] = useState(false);
  const { data: plans = [] } = usePlans();
  const covering = plans.filter((p) => p.items.includes(item.id));
  const { data: jobs = [] } = useMaintenanceJobs(`item = "${item.id}"`, "dueOn");
  const { data: repairs = [] } = useRepairs(`item = "${item.id}"`);
  const { isOpen } = useRepairStatuses();
  const scheduled = jobs.filter((j) => j.status === "scheduled");
  const done = jobs.filter((j) => j.status === "done").sort((a, b) => b.doneOn.localeCompare(a.doneOn));
  const repairCost = repairs.reduce((sum, r) => sum + (r.cost || 0), 0);
  const maintenanceCost = done.reduce((sum, j) => sum + (j.cost || 0), 0);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="eyebrow text-gray-500">Plans</h2>
          <Link to="/maintenance?tab=plans" className="text-xs text-signal-ink hover:text-signal-ink-hover">
            All plans →
          </Link>
        </div>
        {covering.length === 0 ? (
          <p className="text-xs text-gray-500">Not on any repeating plan. Add it to one from Maintenance → Plans, like an annual inspection or test &amp; tag.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {covering.map((p) => (
              <li key={p.id}>
                <Link to={`/maintenance/plans/${p.id}`} className="text-gray-900 hover:underline">
                  {p.name}
                </Link>
                <span className="text-gray-500"> · {describeInterval(p.every, p.unit).toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden text-sm">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <h2 className="eyebrow text-gray-500">Scheduled</h2>
          {canRecord && (
            <button onClick={() => setScheduling(true)} className="btn-secondary py-1">
              Schedule job
            </button>
          )}
        </div>
        {scheduled.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-gray-500">Nothing scheduled.</p>
        ) : (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {scheduled.map((j) => (
              <Link key={j.id} to={`/maintenance/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
                <span className="min-w-0">
                  <span className="block text-gray-900 truncate">{j.name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {assetLabel(j)} · {formatDay(j.dueOn)}
                  </span>
                </span>
                <ResultBadge job={j} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden text-sm">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <h2 className="eyebrow text-gray-500">Repairs</h2>
          {repairCost > 0 && <span className="text-xs text-gray-500">{nzd(repairCost)} spent on repairs</span>}
        </div>
        {repairs.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-gray-500">Never repaired.</p>
        ) : (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {repairs.map((r) => {
              const open = isOpen(r.status);
              const overdue = open && (parseDate(r.dueAt)?.getTime() ?? Infinity) < now;
              return (
                <Link key={r.id} to={`/maintenance/repairs/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block text-gray-900 truncate">
                      <span className="font-mono text-xs text-gray-400 mr-1.5">R{r.number}</span>
                      {r.fault}
                    </span>
                    <span className={`block text-xs truncate ${overdue ? "text-fault-ink" : "text-gray-500"}`}>
                      {r.serials.length > 0 ? `${r.serials.length} unit${r.serials.length === 1 ? "" : "s"}` : `× ${r.quantity}`} · opened {formatDate(r.created)}
                      {r.cost > 0 && ` · ${nzd(r.cost)}`}
                    </span>
                  </span>
                  <RepairStatusBadge status={r.status} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="card overflow-hidden text-sm">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <h2 className="eyebrow text-gray-500">Done</h2>
          {maintenanceCost > 0 && <span className="text-xs text-gray-500">{nzd(maintenanceCost)} on maintenance</span>}
        </div>
        {done.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-gray-500">No maintenance recorded yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {done.slice(0, 50).map((j) => (
              <Link key={j.id} to={`/maintenance/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
                <span className="min-w-0">
                  <span className="block text-gray-900 truncate">{j.name}</span>
                  <span className="block text-xs text-gray-500 truncate">
                    {assetLabel(j)} · {formatDay(j.doneOn)}
                    {j.doneBy && ` · ${j.doneBy}`}
                  </span>
                </span>
                <ResultBadge job={j} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {scheduling && (
        <NewJobModal
          item={item}
          onClose={() => setScheduling(false)}
          onCreated={async (made) => {
            setScheduling(false);
            await invalidateMaintenance(queryClient);
            showToast("success", made.length === 1 ? "Scheduled" : `Scheduled ${made.length} jobs`);
          }}
        />
      )}
    </div>
  );
}
