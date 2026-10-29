import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { orgFilter } from "../lib/currentOrg";
import { inDays, invalidateMaintenance, today, type JobWithExpand } from "../lib/maintenance";
import { useFeature, useRole } from "../lib/roles";
import { OPEN_REPAIRS_FILTER } from "../lib/statuses";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { useToast } from "../components/ToastProvider";
import DueTab from "../components/maintenance/DueTab";
import PlansTab from "../components/maintenance/PlansTab";
import HistoryTab from "../components/maintenance/HistoryTab";
import PlanModal from "../components/maintenance/PlanModal";
import NewJobModal from "../components/maintenance/NewJobModal";
import PassModal from "../components/maintenance/PassModal";
import RescheduleModal from "../components/maintenance/RescheduleModal";
import RepairsTab from "../components/repair/RepairsTab";
import NewRepairModal from "../components/repair/NewRepairModal";

type Tab = "due" | "repairs" | "plans" | "history";
const TABS: TabDef<Tab>[] = [
  { key: "due", label: "Due" },
  { key: "repairs", label: "Repairs" },
  { key: "plans", label: "Plans" },
  { key: "history", label: "History" },
];

type Open = "repair" | "job" | "plan" | null;

// Looking after the kit: scheduled maintenance (from repeating plans, or
// one-off), repairs for what's broken, the plans themselves, and the record
// of what's been done. The lists work like Inventory's, with saved views.
// Each part only while the organisation uses it (Settings → Features).
export default function MaintenancePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const feature = useFeature();
  const { showToast } = useToast();
  const maintenanceOn = feature("maintenance");
  const repairsOn = feature("repairs");
  const tabs = TABS.filter((t) => (t.key === "repairs" ? repairsOn : maintenanceOn));
  const [tab, openTab] = useTab(tabs.length > 0 ? tabs : TABS);
  const [open, setOpen] = useState<Open>(null);
  const [passing, setPassing] = useState<JobWithExpand[] | null>(null);
  const [moving, setMoving] = useState<JobWithExpand[] | null>(null);
  // Goes up after each batch pass or move, so the Due list clears its ticks.
  const [batchesDone, setBatchesDone] = useState(0);
  const canRecord = can("units.flag");
  const canPlan = can("maintenance.plans");

  // For the summary and tab counts: what needs attention.
  const { data: counts } = useQuery({
    queryKey: ["maintenance-jobs", "counts", today()],
    queryFn: async () => {
      const total = async (collection: string, filter: string) =>
        (await pb.collection(collection).getList(1, 1, { filter: orgFilter(filter), fields: "id", skipTotal: false })).totalItems;
      const [overdue, week, repairs] = await Promise.all([
        maintenanceOn ? total("maintenance_jobs", pb.filter("status = 'scheduled' && dueOn < {:today}", { today: today() })) : 0,
        maintenanceOn ? total("maintenance_jobs", pb.filter("status = 'scheduled' && dueOn >= {:today} && dueOn <= {:week}", { today: today(), week: inDays(7) })) : 0,
        repairsOn ? total("repairs", OPEN_REPAIRS_FILTER) : 0,
      ]);
      return { overdue, week, repairs };
    },
  });
  const refresh = () => invalidateMaintenance(queryClient);
  const batchDone = async () => {
    setPassing(null);
    setMoving(null);
    setBatchesDone((n) => n + 1);
    await refresh();
  };

  if (tabs.length === 0) {
    return <p className="text-sm text-gray-500">Repairs and maintenance plans aren&apos;t part of your R2.</p>;
  }

  // "2 overdue · 5 due this week · 3 out for repair", the first and last
  // opening their tab.
  const summary: ReactNode[] = [];
  if (counts && maintenanceOn) {
    summary.push(
      counts.overdue > 0 ? (
        <button key="overdue" onClick={() => openTab("due")} className="text-fault-ink font-medium hover:underline">
          {counts.overdue} overdue
        </button>
      ) : (
        <span key="overdue">Nothing overdue</span>
      ),
      <span key="week">{counts.week > 0 ? `${counts.week} due in the next 7 days` : "Nothing due this week"}</span>,
    );
  }
  if (counts && repairsOn) {
    summary.push(
      <button key="repairs" onClick={() => openTab("repairs")} className="hover:underline">
        {counts.repairs === 0 ? "Nothing out for repair" : `${counts.repairs} out for repair`}
      </button>,
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Maintenance</h1>
          <p className="text-xs text-gray-500">
            {summary.length === 0
              ? " "
              : summary.flatMap((el, i) => (i === 0 ? [el] : [<span key={`dot${i}`} className="text-gray-300"> · </span>, el]))}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {tab === "due" && canRecord && (
            <button onClick={() => setOpen("job")} className="btn-primary">
              Schedule job
            </button>
          )}
          {tab === "repairs" && canRecord && (
            <button onClick={() => setOpen("repair")} className="btn-primary">
              Create repair
            </button>
          )}
          {tab === "plans" && canPlan && (
            <button onClick={() => setOpen("plan")} className="btn-primary">
              New plan
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <TabBar
          label="Maintenance sections"
          current={tab}
          onOpen={openTab}
          tabs={tabs.map((t) => ({ ...t, count: t.key === "due" ? counts?.overdue || undefined : t.key === "repairs" ? counts?.repairs || undefined : undefined }))}
        />
      </div>

      {tab === "due" && <DueTab canRecord={canRecord} onPass={setPassing} onReschedule={setMoving} batchesDone={batchesDone} />}
      {tab === "repairs" && <RepairsTab />}
      {tab === "plans" && <PlansTab canManage={canPlan} onNew={() => setOpen("plan")} />}
      {tab === "history" && <HistoryTab />}

      {open === "repair" && (
        <NewRepairModal
          onClose={() => setOpen(null)}
          onCreated={async (repair) => {
            setOpen(null);
            await refresh();
            navigate(`/maintenance/repairs/${repair.id}`);
          }}
        />
      )}
      {open === "job" && (
        <NewJobModal
          onClose={() => setOpen(null)}
          onCreated={async (jobs) => {
            setOpen(null);
            await refresh();
            if (jobs.length === 1) navigate(`/maintenance/jobs/${jobs[0].id}`);
            else showToast("success", `Scheduled ${jobs.length} jobs`);
          }}
        />
      )}
      {open === "plan" && (
        <PlanModal
          onClose={() => setOpen(null)}
          onSaved={async (plan) => {
            setOpen(null);
            await refresh();
            navigate(`/maintenance/plans/${plan.id}`);
          }}
        />
      )}
      {passing && <PassModal jobs={passing} onClose={() => setPassing(null)} onDone={batchDone} />}
      {moving && <RescheduleModal jobs={moving} onClose={() => setMoving(null)} onDone={batchDone} />}
    </div>
  );
}
