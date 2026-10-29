import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type MaintenanceJob } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { assetLabel, describePlan, formatDay, invalidateMaintenance, kindOf, today, type JobWithExpand } from "../lib/maintenance";
import { useAuthRecord } from "../lib/pocketbase";
import { useFollowOrg } from "../lib/org";
import { useRole } from "../lib/roles";
import FilesCard from "../components/FilesCard";
import NumberInput from "../components/NumberInput";
import { ResultBadge } from "../components/maintenance/ResultBadge";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import Breadcrumbs from "../components/Breadcrumbs";

// One piece of maintenance: what and when, recording how it went (a fail
// can take the kit out of service on a repair), its files, and what's been
// done on the same kit before.
export default function MaintenanceJobDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const canEdit = can("units.flag");

  const { data: job, isLoading, error } = useQuery({
    queryKey: ["maintenance-job", id],
    queryFn: () => pb.collection("maintenance_jobs").getOne<JobWithExpand>(id, { expand: "item,serial,plan" }),
  });
  useFollowOrg(job?.org);
  const setJob = (next: MaintenanceJob) => queryClient.setQueryData(["maintenance-job", id], { ...next, expand: job?.expand });

  // The same kit's other work: under this plan, or everything for one-off jobs.
  const { data: others = [] } = useQuery({
    queryKey: ["maintenance-jobs", "asset", job?.item, job?.serial, job?.plan],
    queryFn: () =>
      pb.collection("maintenance_jobs").getFullList<JobWithExpand>({
        filter: orgFilter(
          pb.filter(`item = {:item} && ${job!.serial ? "serial = {:serial}" : "serial = ''"}${job!.plan ? " && plan = {:plan}" : ""} && id != {:id}`, {
            item: job!.item,
            serial: job!.serial,
            plan: job!.plan,
            id: job!.id,
          }),
        ),
        sort: "-dueOn",
      }),
    enabled: !!job?.item,
  });

  const [dueOn, setDueOn] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState(0);
  useEffect(() => {
    if (!job) return;
    setDueOn(job.dueOn);
    setNotes(job.notes);
    setCost(job.cost);
  }, [job]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !job) return <p className="text-red-600 text-sm">Couldn't load this job: {error ? errorText(error) : "not found"}</p>;

  const k = kindOf(job.kind);
  const scheduled = job.status === "scheduled";
  const plan = job.expand?.plan;
  const item = job.expand?.item;
  const unit = job.expand?.serial;
  const dirty = dueOn !== job.dueOn || notes !== job.notes || cost !== job.cost;

  async function saveDetails() {
    try {
      setJob(await api.updateJob(id, { ...(scheduled && dueOn !== job!.dueOn ? { dueOn } : {}), notes, cost }));
      await invalidateMaintenance(queryClient);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    }
  }

  async function remove() {
    const ok = await confirm({ title: "Delete job", message: `Delete ${job!.name}? It hasn't been done, so nothing's lost.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.deleteJob(id);
      await invalidateMaintenance(queryClient);
      navigate("/maintenance", { replace: true });
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <Breadcrumbs
        crumbs={[
          { label: "Maintenance", to: "/maintenance" },
          scheduled ? { label: "Due", to: "/maintenance" } : { label: "History", to: "/maintenance?tab=history" },
          { label: job.name },
        ]}
      />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">{job.name}</h1>
            <ResultBadge job={job} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {item ? (
              <>
                <Link to={unit ? `/assets/${unit.id}` : `/inventory/${item.id}`} className="hover:underline text-gray-700">
                  {assetLabel(job)}
                </Link>
              </>
            ) : null}
            {plan ? (
              <>
                {" · "}
                <Link to={`/maintenance/plans/${plan.id}`} className="hover:underline text-gray-700">
                  {plan.name}
                </Link>
                {`, ${describePlan(plan).toLowerCase()}`}
              </>
            ) : (
              " · one-off"
            )}
          </p>
        </div>
        {canEdit && scheduled && !job.plan && (
          <button onClick={remove} className="btn-secondary hover:text-fault-ink">
            Delete
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {scheduled && canEdit && <RecordCard job={job} onDone={async () => { await invalidateMaintenance(queryClient); }} />}
          {!scheduled && (
            <section className="card p-4 flex flex-col gap-1 text-sm">
              <h2 className="eyebrow text-gray-500 mb-1">Done</h2>
              <p className="text-gray-900">
                {job.result === "pass" ? k.pass : k.fail}
                {job.failedQty > 0 && ` (${job.failedQty} of them)`} on {formatDay(job.doneOn)}
                {job.doneBy && ` by ${job.doneBy}`}
              </p>
              {job.repair && (
                <Link to={`/maintenance/repairs/${job.repair}`} className="text-signal-ink hover:text-signal-ink-hover w-fit">
                  See the repair →
                </Link>
              )}
            </section>
          )}

          {plan?.instructions && (
            <section className="card p-4 text-sm">
              <h2 className="eyebrow text-gray-500 mb-2">Instructions</h2>
              <p className="text-gray-800 whitespace-pre-line">{plan.instructions}</p>
            </section>
          )}

          <section className="card p-4 flex flex-col gap-3 text-sm">
            <h2 className="eyebrow text-gray-500">Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Due</span>
                <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} disabled={!canEdit || !scheduled} className="input py-1.5" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-gray-500">Cost</span>
                <NumberInput value={cost} min={0} onChange={setCost} disabled={!canEdit} className="input py-1.5" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} rows={3} className="input py-1.5" />
            </label>
            {canEdit && (
              <button onClick={saveDetails} disabled={!dirty || !dueOn} className="btn-secondary w-fit">
                Save
              </button>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <FilesCard
            record={job}
            canEdit={canEdit}
            upload={(file) => api.uploadJobFile(id, file)}
            remove={(name) => api.deleteJobFile(id, name)}
            onChanged={setJob}
          />
          {item && (
            <section className="card overflow-hidden text-sm">
              <h2 className="eyebrow text-gray-500 px-4 pt-3 pb-2">{plan ? "Before and after, on this plan" : "Other work on this kit"}</h2>
              {others.length === 0 ? (
                <p className="px-4 pb-4 text-gray-500 text-xs">Nothing else yet.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {others.map((o) => (
                    <Link key={o.id} to={`/maintenance/jobs/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
                      <span className="min-w-0">
                        <span className="block text-gray-900 truncate">{o.name}</span>
                        <span className="block text-xs text-gray-500">{formatDay(o.status === "done" ? o.doneOn : o.dueOn)}</span>
                      </span>
                      <ResultBadge job={o} />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Recording how it went. A fail on kit can take it out of service: a unit
// goes on a repair, or some of a bulk item.
function RecordCard({ job, onDone }: { job: JobWithExpand; onDone: () => Promise<void> }) {
  const me = useAuthRecord();
  const { showToast } = useToast();
  const k = kindOf(job.kind);
  const bulk = !!job.item && !job.serial;
  const [result, setResult] = useState<"pass" | "fail" | null>(null);
  const [doneOn, setDoneOn] = useState(today());
  const [doneBy, setDoneBy] = useState<string>(me?.name || me?.email || "");
  const [notes, setNotes] = useState("");
  const [failedQty, setFailedQty] = useState(1);
  const [repair, setRepair] = useState(true);
  const [fault, setFault] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!result) return;
    setSaving(true);
    try {
      const done = await api.completeJob(job.id, {
        result,
        doneOn,
        doneBy: doneBy.trim(),
        notes: [job.notes, notes.trim()].filter(Boolean).join("\n"),
        ...(result === "fail" && bulk ? { failedQty } : {}),
        ...(result === "fail" && repair && job.item ? { repair: { fault: fault.trim() || notes.trim() } } : {}),
      });
      await onDone();
      showToast("success", `${result === "pass" ? k.pass : k.fail}${done.repair ? `: on repair R${done.repair.number}` : ""}`);
    } catch (err) {
      showToast("error", `Couldn't record it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const choice = (value: "pass" | "fail", label: string, on: string) => (
    <button
      type="button"
      onClick={() => setResult(value)}
      className={`flex-1 py-2.5 rounded-md text-sm font-semibold border transition-colors ${result === value ? on : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"}`}
    >
      {label}
    </button>
  );

  return (
    <section className="card p-4 flex flex-col gap-3 text-sm">
      <h2 className="eyebrow text-gray-500">Record it</h2>
      <div className="flex items-center gap-2">
        {choice("pass", k.pass, "bg-emerald-600 border-emerald-600 text-white")}
        {choice("fail", k.fail, "bg-fault border-fault text-white")}
      </div>
      {result && (
        <>
          {result === "fail" && (
            <div className="flex flex-col gap-2 rounded-md bg-red-50/60 p-3">
              {bulk && (
                <label className="flex items-center gap-2">
                  <span className="text-gray-600">How many failed</span>
                  <NumberInput value={failedQty} min={1} onChange={(n) => setFailedQty(Math.max(1, Math.round(n)))} className="input py-1 w-20" />
                </label>
              )}
              {job.item && (
                <label className="flex items-center gap-2 text-gray-700">
                  <input type="checkbox" checked={repair} onChange={(e) => setRepair(e.target.checked)} />
                  Take {bulk ? "them" : "it"} out of service on a repair
                </label>
              )}
              {repair && job.item && <input value={fault} onChange={(e) => setFault(e.target.value)} placeholder="What's wrong?" className="input py-1.5" />}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Done on</span>
              <input type="date" value={doneOn} max={today()} onChange={(e) => setDoneOn(e.target.value)} className="input py-1.5" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Done by</span>
              <input value={doneBy} onChange={(e) => setDoneBy(e.target.value)} className="input py-1.5" placeholder="Who did it, or which company" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input py-1.5" placeholder="Readings, what was done, parts used…" />
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={save} disabled={saving || !doneOn || (result === "fail" && repair && !!job.item && !fault.trim())} className="btn-primary">
              {saving ? "Recording…" : "Record"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
