import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { orgFilter } from "../../lib/currentOrg";
import { assetLabel, dueLabel, formatDay, inDays, kindOf, today, useMaintenanceJobs, usePlans, type JobWithExpand } from "../../lib/maintenance";
import Segmented from "../Segmented";

type Ahead = "30" | "90" | "all";

// Scheduled maintenance, soonest first: what's overdue, what's due this
// week, then later. Tick a batch and pass it in one go (an inspection day);
// fails are recorded one at a time from the job, with what's wrong.
export default function DueTab({ canRecord, onPass }: { canRecord: boolean; onPass: (jobs: JobWithExpand[]) => void }) {
  const navigate = useNavigate();
  const [ahead, setAhead] = useState<Ahead>("30");
  const [plan, setPlan] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: plans = [] } = usePlans();
  const filter = `status = 'scheduled'${ahead === "all" ? "" : ` && dueOn <= "${inDays(Number(ahead))}"`}`;
  const { data: jobs = [], isLoading, error } = useMaintenanceJobs(filter);
  // When nothing's due in the window: is anything scheduled at all, and when?
  const { data: soonest } = useQuery({
    queryKey: ["maintenance-jobs", "soonest"],
    queryFn: async () => {
      const page = await pb.collection("maintenance_jobs").getList<JobWithExpand>(1, 1, { filter: orgFilter("status = 'scheduled'"), sort: "dueOn", skipTotal: false });
      return { total: page.totalItems, next: page.items[0]?.dueOn ?? "" };
    },
    enabled: !isLoading && jobs.length === 0,
  });

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (plan === "one-off" ? j.plan : plan && j.plan !== plan) return false;
      if (!term) return true;
      const unit = j.expand?.serial;
      return [j.name, j.expand?.item?.name, unit?.barcode, unit?.label, unit?.serialNumber, j.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [jobs, plan, search]);

  const now = today();
  const week = inDays(7);
  const groups = [
    { title: "Overdue", rows: shown.filter((j) => j.dueOn < now), tone: "text-fault-ink" },
    { title: "Due in the next 7 days", rows: shown.filter((j) => j.dueOn >= now && j.dueOn <= week), tone: "text-gray-900" },
    { title: "Later", rows: shown.filter((j) => j.dueOn > week), tone: "text-gray-900" },
  ].filter((g) => g.rows.length > 0);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const picked = shown.filter((j) => selected.has(j.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work, item, barcode…" className="input w-64 max-w-full" />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input w-auto">
          <option value="">All work</option>
          <option value="one-off">One-off jobs</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Segmented
          label="How far ahead"
          value={ahead}
          onChange={setAhead}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "all", label: "Everything" },
          ]}
        />
        <span className="text-xs text-gray-500 ml-auto">{shown.length.toLocaleString()} scheduled</span>
      </div>

      {canRecord && picked.length > 0 && (
        <div className="card px-4 py-2 flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium text-gray-900 mr-1">{picked.length} selected</span>
          <button onClick={() => onPass(picked)} className="btn-primary">
            Mark passed
          </button>
          <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-900 ml-auto">
            Clear selection
          </button>
        </div>
      )}

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load maintenance: {(error as Error).message}</p>}

      {groups.map((g) => {
        const ids = g.rows.map((j) => j.id);
        const all = ids.every((id) => selected.has(id));
        return (
          <section key={g.title} className="card overflow-x-auto">
            <h2 className={`px-4 pt-3 pb-2 text-sm font-semibold ${g.tone}`}>
              {g.title} <span className="font-mono text-xs text-gray-400 ml-1">{g.rows.length}</span>
            </h2>
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-y border-gray-200 text-left text-gray-500">
                  {canRecord && (
                    <th className="pl-4 pr-1 py-1.5 w-8">
                      <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} aria-label={`Select all ${g.title.toLowerCase()}`} />
                    </th>
                  )}
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Due</th>
                  <th className="px-3 py-1.5 font-medium">Work</th>
                  <th className="px-3 py-1.5 font-medium hidden sm:table-cell">Kit</th>
                  <th className="px-3 py-1.5 font-medium hidden md:table-cell">Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {g.rows.map((j) => (
                  <tr key={j.id} onClick={() => navigate(`/maintenance/jobs/${j.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    {canRecord && (
                      <td className="pl-4 pr-1 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(j.id)} onChange={(e) => toggle([j.id], e.target.checked)} aria-label={`Select ${j.name}`} />
                      </td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`block ${j.dueOn < now ? "text-fault-ink font-medium" : "text-gray-900"}`}>{dueLabel(j.dueOn)}</span>
                      <span className="block text-xs text-gray-500">{formatDay(j.dueOn)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block font-medium text-gray-900">{j.name}</span>
                      <span className="hidden sm:block text-xs text-gray-500">{kindOf(j.kind).label}</span>
                      {/* No room for the kit column on phones: it goes here. */}
                      <span className="sm:hidden block text-xs text-gray-600">{assetLabel(j)}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 hidden sm:table-cell">{assetLabel(j)}</td>
                    <td className="px-3 py-2 text-gray-500 hidden md:table-cell">{j.expand?.plan?.name ?? "One-off"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {!isLoading && groups.length === 0 && (
        <div className="card px-4 py-8 text-center text-sm text-gray-500">
          {jobs.length > 0
            ? "Nothing matches."
            : soonest && soonest.total > 0
              ? `Nothing due in the next ${ahead} days. The next is due ${formatDay(soonest.next)}.`
              : "Nothing scheduled. Set up a plan for repeating work like PPE inspections or test & tag (Plans), or schedule a one-off job."}
        </div>
      )}
    </div>
  );
}
