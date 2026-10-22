import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { orgFilter } from "../lib/currentOrg";
import { invalidateMaintenance, today, type JobWithExpand } from "../lib/maintenance";
import { useRole } from "../lib/roles";
import { OPEN_REPAIRS_FILTER } from "../lib/statuses";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { useToast } from "../components/ToastProvider";
import DueTab from "../components/maintenance/DueTab";
import PlansTab from "../components/maintenance/PlansTab";
import HistoryTab from "../components/maintenance/HistoryTab";
import PlanModal from "../components/maintenance/PlanModal";
import NewJobModal from "../components/maintenance/NewJobModal";
import PassModal from "../components/maintenance/PassModal";
import ScanRecordModal from "../components/maintenance/ScanRecordModal";
import RepairsTab from "../components/repair/RepairsTab";
import NewRepairModal from "../components/repair/NewRepairModal";

type Tab = "due" | "repairs" | "plans" | "history";
const TABS: TabDef<Tab>[] = [
  { key: "due", label: "Due" },
  { key: "repairs", label: "Repairs" },
  { key: "plans", label: "Plans" },
  { key: "history", label: "History" },
];

type Open = "repair" | "job" | "plan" | "scan" | null;

// Looking after the kit: scheduled maintenance (from repeating plans, or
// one-off), repairs for what's broken, the plans themselves, and the record
// of what's been done.
export default function MaintenancePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const [tab, openTab] = useTab(TABS);
  const [open, setOpen] = useState<Open>(null);
  const [passing, setPassing] = useState<JobWithExpand[] | null>(null);
  const canRecord = can("units.flag");
  const canPlan = can("maintenance.plans");

  // For the tab counts: what needs attention.
  const { data: counts } = useQuery({
    queryKey: ["maintenance-jobs", "counts", today()],
    queryFn: async () => {
      const total = async (collection: string, filter: string) =>
        (await pb.collection(collection).getList(1, 1, { filter: orgFilter(filter), fields: "id", skipTotal: false })).totalItems;
      const [overdue, repairs] = await Promise.all([
        total("maintenance_jobs", pb.filter("status = 'scheduled' && dueOn < {:today}", { today: today() })),
        total("repairs", OPEN_REPAIRS_FILTER),
      ]);
      return { overdue, repairs };
    },
  });
  const refresh = () => invalidateMaintenance(queryClient);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Maintenance</h1>
          <p className="text-xs text-gray-500">
            {counts
              ? [
                  counts.overdue > 0 ? `${counts.overdue} overdue` : "Nothing overdue",
                  `${counts.repairs} repair${counts.repairs === 1 ? "" : "s"} open`,
                ].join(" · ")
              : " "}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {tab === "due" && canRecord && (
            <>
              <button onClick={() => setOpen("scan")} className="btn-secondary">
                Record by scanning
              </button>
              <button onClick={() => setOpen("job")} className="btn-primary">
                Schedule job
              </button>
            </>
          )}
          {tab === "repairs" && canRecord && (
            <button onClick={() => setOpen("repair")} className="btn-primary">
              New repair
            </button>
          )}
          {tab === "plans" && canPlan && (
            <button onClick={() => setOpen("plan")} className="btn-primary">
              New plan
            </button>
          )}
        </div>
      </div>

      <TabBar
        label="Maintenance sections"
        current={tab}
        onOpen={openTab}
        tabs={TABS.map((t) => ({ ...t, count: t.key === "due" ? counts?.overdue || undefined : t.key === "repairs" ? counts?.repairs || undefined : undefined }))}
      />

      {tab === "due" && <DueTab canRecord={canRecord} onPass={setPassing} />}
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
      {open === "scan" && <ScanRecordModal onClose={() => setOpen(null)} onChanged={refresh} />}
      {passing && (
        <PassModal
          jobs={passing}
          onClose={() => setPassing(null)}
          onDone={async () => {
            setPassing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
