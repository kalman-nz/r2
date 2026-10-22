import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { orgFilter } from "../../lib/currentOrg";
import { describeInterval, dueLabel, kindOf, today, usePlans } from "../../lib/maintenance";

// Repeating maintenance: each plan with how often it comes round, what it
// covers, and how its scheduled work stands.
export default function PlansTab({ canManage, onNew }: { canManage: boolean; onNew: () => void }) {
  const navigate = useNavigate();
  const { data: plans = [], isLoading } = usePlans();
  const { data: scheduled = [] } = useQuery({
    queryKey: ["maintenance-jobs", "plan-due"],
    queryFn: () =>
      pb.collection("maintenance_jobs").getFullList<{ plan: string; dueOn: string }>({ filter: orgFilter("status = 'scheduled' && plan != ''"), fields: "plan,dueOn" }),
  });
  const stats = useMemo(() => {
    const now = today();
    const out = new Map<string, { count: number; overdue: number; next: string }>();
    for (const j of scheduled) {
      const s = out.get(j.plan) ?? { count: 0, overdue: 0, next: "" };
      s.count++;
      if (j.dueOn < now) s.overdue++;
      if (!s.next || j.dueOn < s.next) s.next = j.dueOn;
      out.set(j.plan, s);
    }
    return out;
  }, [scheduled]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;

  if (plans.length === 0) {
    return (
      <div className="card px-6 py-8 flex flex-col items-center gap-3 text-center text-sm text-gray-600">
        <p className="max-w-md">
          Plans are maintenance that comes round again: an annual PPE inspection, test &amp; tag every 3 months, a hazer service every 6. Each unit gets
          its own due date, and doing it schedules the next.
        </p>
        {canManage && (
          <button onClick={onNew} className="btn-primary">
            New plan
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-4 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium">How often</th>
            <th className="px-3 py-2 font-medium hidden sm:table-cell">Covers</th>
            <th className="px-3 py-2 font-medium">Next due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {plans.map((p) => {
            const s = stats.get(p.id);
            return (
              <tr key={p.id} onClick={() => navigate(`/maintenance/plans/${p.id}`)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-2">
                  <span className="block font-medium text-gray-900">{p.name}</span>
                  <span className="block text-xs text-gray-500">{kindOf(p.kind).label}</span>
                </td>
                <td className="px-3 py-2 text-gray-700">{describeInterval(p.every, p.unit)}</td>
                <td className="px-3 py-2 text-gray-700 hidden sm:table-cell">
                  {p.items.length} item{p.items.length === 1 ? "" : "s"}
                  {s && <span className="text-gray-500"> · {s.count} scheduled</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {s ? (
                    <>
                      <span className={s.overdue > 0 ? "text-fault-ink font-medium" : "text-gray-900"}>
                        {s.overdue > 0 ? `${s.overdue} overdue` : dueLabel(s.next)}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-400">Nothing covered yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
