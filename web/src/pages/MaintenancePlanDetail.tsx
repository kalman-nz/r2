import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type MaintenancePlan } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { assetLabel, describePlan, dueLabel, formatDay, invalidateMaintenance, today, type JobWithExpand } from "../lib/maintenance";
import { useFollowOrg } from "../lib/org";
import { useRole } from "../lib/roles";
import PlanModal from "../components/maintenance/PlanModal";
import { ResultBadge } from "../components/maintenance/ResultBadge";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import Breadcrumbs from "../components/Breadcrumbs";

// A repeating plan: what it is, what it covers, and where each unit stands
// (when it was last done and how it went, when it's next due).
export default function MaintenancePlanDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ["maintenance-plans", id],
    queryFn: () => pb.collection("maintenance_plans").getOne<MaintenancePlan & { expand?: { items?: Item[] } }>(id, { expand: "items" }),
  });
  useFollowOrg(plan?.org);
  const { data: jobs = [] } = useQuery({
    queryKey: ["maintenance-jobs", "plan", id],
    queryFn: () => pb.collection("maintenance_jobs").getFullList<JobWithExpand>({ filter: orgFilter(pb.filter("plan = {:id}", { id })), sort: "dueOn", expand: "item,serial" }),
  });

  // One row per unit (or bulk item): its scheduled job and its last done one.
  const rows = useMemo(() => {
    const byKey = new Map<string, { next?: JobWithExpand; last?: JobWithExpand }>();
    for (const j of jobs) {
      const key = `${j.item}/${j.serial}`;
      const row = byKey.get(key) ?? {};
      if (j.status === "scheduled") row.next = j;
      else if (!row.last || j.doneOn > row.last.doneOn) row.last = j;
      byKey.set(key, row);
    }
    const term = search.trim().toLowerCase();
    return [...byKey.values()]
      .filter((r) => r.next)
      .filter((r) => !term || assetLabel(r.next!).toLowerCase().includes(term) || (r.next!.expand?.serial?.serialNumber ?? "").toLowerCase().includes(term))
      .sort((a, b) => a.next!.dueOn.localeCompare(b.next!.dueOn));
  }, [jobs, search]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !plan) return <p className="text-red-600 text-sm">Couldn't load this plan: {error ? errorText(error) : "not found"}</p>;

  const canManage = can("maintenance.plans");
  const now = today();
  const overdue = rows.filter((r) => r.next!.dueOn < now).length;
  const items = plan.expand?.items ?? [];

  async function remove() {
    const ok = await confirm({
      title: "Delete plan",
      message: `Delete ${plan!.name}? Its ${rows.length} scheduled job${rows.length === 1 ? "" : "s"} go with it; what's been done stays on record.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePlan(id);
      await invalidateMaintenance(queryClient);
      navigate("/maintenance?tab=plans", { replace: true });
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Maintenance", to: "/maintenance" }, { label: "Plans", to: "/maintenance?tab=plans" }, { label: plan.name }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">{plan.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {describePlan(plan)}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1.5">
            <button onClick={remove} className="btn-secondary hover:text-fault-ink">
              Delete
            </button>
            <button onClick={() => setEditing(true)} className="btn-primary">
              Change plan
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ["Items", String(items.length)],
          ["Scheduled", String(rows.length)],
          ["Overdue", String(overdue)],
          ["Next due", rows[0] ? formatDay(rows[0].next!.dueOn) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3 flex flex-col gap-0.5 min-w-0">
            <span className="eyebrow text-gray-500">{label}</span>
            <span className={`text-lg font-semibold truncate ${label === "Overdue" && overdue > 0 ? "text-fault-ink" : "text-gray-900"}`}>{value}</span>
          </div>
        ))}
      </div>

      {plan.instructions && (
        <section className="card p-4 text-sm">
          <h2 className="eyebrow text-gray-500 mb-2">Instructions</h2>
          <p className="text-gray-800 whitespace-pre-line">{plan.instructions}</p>
        </section>
      )}

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <h2 className="eyebrow text-gray-500">Items</h2>
        {items.length === 0 ? (
          <p className="text-gray-500 text-xs">None yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {items.map((i) => (
              <Link key={i.id} to={`/inventory/${i.id}?tab=maintenance`} className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700 hover:bg-gray-200">
                {i.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="eyebrow text-gray-500">Each unit</h2>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a unit…" className="input py-1 w-56" />
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-y border-gray-200 text-left text-gray-500">
              <th className="px-4 py-1.5 font-medium">Kit</th>
              <th className="px-3 py-1.5 font-medium">Last done</th>
              <th className="px-3 py-1.5 font-medium">Next due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ next, last }) => (
              <tr key={next!.id} onClick={() => navigate(`/maintenance/jobs/${next!.id}`)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-2 text-gray-900">{assetLabel(next!)}</td>
                <td className="px-3 py-2">
                  {last ? (
                    <span className="flex items-center gap-2">
                      <span className="text-gray-700">{formatDay(last.doneOn)}</span>
                      <ResultBadge job={last} />
                    </span>
                  ) : (
                    <span className="text-gray-400">Never</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={next!.dueOn < now ? "text-fault-ink font-medium" : "text-gray-900"}>{dueLabel(next!.dueOn)}</span>
                  <span className="text-xs text-gray-500 ml-2">{formatDay(next!.dueOn)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm text-center">{search ? "No units match." : "Nothing scheduled."}</p>}
      </section>

      {editing && (
        <PlanModal
          plan={plan}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await invalidateMaintenance(queryClient);
            showToast("success", "Plan saved");
          }}
        />
      )}
    </div>
  );
}
