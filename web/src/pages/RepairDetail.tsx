import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type Repair, type Serial } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatDate, formatDateTime, fromDateInput, toDateInput } from "../lib/format";
import { invalidateMaintenance, useRepairStatuses } from "../lib/maintenance";
import { STATUS_COLOURS } from "../lib/statuses";
import { useFeature, useRole } from "../lib/roles";
import { useFollowOrg } from "../lib/org";
import FilesCard from "../components/FilesCard";
import NumberInput from "../components/NumberInput";
import ProjectPicker, { type ProjectRef } from "../components/ProjectPicker";
import { RepairStatusBadge, SerialStatusBadge } from "../components/StatusBadge";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import AssigneeInput from "../components/repair/AssigneeInput";
import Breadcrumbs from "../components/Breadcrumbs";

type RepairWithExpand = Repair & {
  expand?: { item?: Item; serials?: Serial[]; job?: ProjectRef; createdBy?: { name: string; email: string } };
};

interface Draft {
  fault: string;
  repairer: string;
  cost: number;
  dueAt: string;
  notes: string;
}

const draftOf = (r: Repair): Draft => ({ fault: r.fault, repairer: r.repairer, cost: r.cost, dueAt: toDateInput(r.dueAt), notes: r.notes });

export default function RepairDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const feature = useFeature();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);

  const {
    data: repair,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repairs", id],
    queryFn: () => pb.collection("repairs").getOne<RepairWithExpand>(id, { expand: "item,serials,job,createdBy" }),
  });
  useFollowOrg(repair?.org);
  const { statuses, byId, isOpen } = useRepairStatuses();
  const { data: activity = [] } = useQuery({
    queryKey: ["repairs", id, "activity", repair?.updated],
    queryFn: () => api.repairActivity(id),
    enabled: !!repair,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (repair) setDraft(draftOf(repair));
  }, [repair]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !repair || !draft) return <p className="text-red-600 text-sm">Couldn't load this repair: {error ? errorText(error) : "not found"}</p>;

  const open = isOpen(repair.status);
  const canEdit = can("units.flag");
  const item = repair.expand?.item;
  const units = repair.expand?.serials ?? [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(repair));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function update(body: Parameters<typeof api.updateRepair>[1], done: string) {
    setSaving(true);
    try {
      await api.updateRepair(id, body);
      await invalidateMaintenance(queryClient);
      showToast("success", done);
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const saveDetails = () => update({ ...draft!, fault: draft!.fault.trim(), dueAt: fromDateInput(draft!.dueAt) }, "Saved");

  // Moving between statuses. One that changes what happens to the kit
  // (ending it repaired or unrepairable, or moving it back) asks first.
  async function setStatus(next: string) {
    if (!repair || !draft || next === repair.status) return;
    const from = byId.get(repair.status)?.stage ?? "open";
    const to = byId.get(next)?.stage ?? "open";
    const label = byId.get(next)?.name ?? "";
    const serialised = repair.serials.length > 0;
    const many = serialised ? repair.serials.length > 1 : repair.quantity > 1;
    const what = serialised ? (many ? `The ${repair.serials.length} units` : "The unit") : `${repair.quantity} of ${item?.name ?? "the item"}`;
    let question: { title: string; message: string; confirmLabel: string; danger?: boolean } | null = null;
    if (from !== to && to === "repaired") {
      question = { title: label, message: `Move it to ${label}? ${what} ${many ? "go" : "goes"} back in service.`, confirmLabel: `Move to ${label}` };
    } else if (from !== to && to === "unrepairable") {
      question = {
        title: label,
        message: `Move it to ${label}? ${serialised ? `${what} ${many ? "are" : "is"} retired.` : `The stock goes down by ${repair.quantity}.`} You can move it back if it's a mistake.`,
        confirmLabel: `Move to ${label}`,
        danger: true,
      };
    } else if (from !== to) {
      question = { title: label, message: `Move it back to ${label}? ${what} ${many ? "come" : "comes"} out of service again.`, confirmLabel: `Move to ${label}` };
    }
    if (question && !(await confirm(question))) return;
    // Unsaved edits go with it.
    await update(
      { ...(dirty ? { ...draft, dueAt: fromDateInput(draft.dueAt) } : {}), status: next },
      to === "repaired" && from !== to ? `${label}: back in service` : `Moved to ${label}`,
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Maintenance", to: "/maintenance" }, { label: "Repairs", to: "/maintenance?tab=repairs" }, { label: `R${repair.number}` }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl text-gray-400 font-mono">R{repair.number}</span>
            <h1 className="text-xl font-semibold text-gray-900">
              {item ? (
                <Link to={`/inventory/${item.id}`} className="hover:underline">
                  {item.name}
                </Link>
              ) : (
                "(deleted item)"
              )}
            </h1>
            <RepairStatusBadge status={repair.status} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Opened {formatDateTime(repair.created)}
            {repair.expand?.createdBy && ` by ${repair.expand.createdBy.name || repair.expand.createdBy.email}`}
            {repair.closedAt && ` · closed ${formatDateTime(repair.closedAt)}`}
          </p>
        </div>
        {canEdit && (
          // The organisation's statuses in their order, with a line where
          // they go from holding the kit to ending the repair.
          <div className="flex items-center gap-1 flex-wrap" role="radiogroup" aria-label="Status">
            {statuses.map((s, i) => {
              const on = s.id === repair.status;
              const ends = s.stage !== "open";
              return (
                <span key={s.id} className="flex items-center gap-1">
                  {i > 0 && ends !== (statuses[i - 1].stage !== "open") && <span className="w-px h-5 bg-gray-300 mx-1" aria-hidden />}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={s.stage === "open" ? "Out of service while it's here" : s.stage === "repaired" ? "Ends it: back in service" : "Ends it: retired"}
                    disabled={saving}
                    onClick={() => setStatus(s.id)}
                    className={`flex items-center gap-1.5 pl-2.5 pr-3 py-1 rounded-full text-[13px] font-medium border transition-colors disabled:opacity-60 ${
                      on ? "bg-carbon border-carbon text-white" : "bg-white border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${STATUS_COLOURS[s.colour || "gray"].dot}`} aria-hidden />
                    {s.name}
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <div className="card bg-amber-50/60 px-4 py-2.5 text-sm text-gray-700">
          Out of service:{" "}
          {units.length > 0
            ? `${units.length === 1 ? "this unit isn't" : "these units aren't"}`
            : `${repair.quantity} ${repair.quantity === 1 ? "isn't" : "aren't"}`}{" "}
          available for projects until it's repaired.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
        <section className="card p-4 flex flex-col gap-3 text-sm">
          <h2 className="eyebrow text-gray-500">Details</h2>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">What's wrong</span>
            <textarea value={draft.fault} onChange={(e) => set("fault", e.target.value)} disabled={!canEdit} rows={3} className="input py-1.5" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Assigned to</span>
              <AssigneeInput value={draft.repairer} onChange={(v) => set("repairer", v)} disabled={!canEdit} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Expected back</span>
              <input type="date" value={draft.dueAt} onChange={(e) => set("dueAt", e.target.value)} disabled={!canEdit} className="input py-1.5" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-gray-500">Cost</span>
              <NumberInput value={draft.cost} min={0} onChange={(n) => set("cost", n)} disabled={!canEdit} className="input py-1.5" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500">Notes</span>
            <textarea
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              disabled={!canEdit}
              rows={4}
              className="input py-1.5"
              placeholder="Quotes, parts ordered, what was done…"
            />
          </label>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button onClick={saveDetails} disabled={!dirty || saving || !draft.fault.trim()} className="btn-secondary w-fit">
                {saving ? "Saving…" : "Save"}
              </button>
              {dirty && (
                <button onClick={() => setDraft(draftOf(repair))} disabled={saving} className="text-xs text-gray-500 hover:text-gray-900">
                  Discard changes
                </button>
              )}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4 min-w-0">
        <section className="card p-4 flex flex-col gap-2 text-sm">
          <h2 className="eyebrow text-gray-500">{units.length > 0 ? `Units (${units.length})` : "Quantity"}</h2>
          {units.length > 0 ? (
            <div className="flex flex-col divide-y divide-gray-100 -mx-4">
              {units.map((u) => (
                <Link key={u.id} to={`/assets/${u.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-gray-50">
                  <span className="flex flex-col min-w-0">
                    <span className="font-mono text-gray-900">{u.barcode || "(no barcode)"}</span>
                    {(u.label || u.serialNumber) && (
                      <span className="text-xs text-gray-400">{[u.label, u.serialNumber].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <SerialStatusBadge status={u.status} />
                </Link>
              ))}
            </div>
          ) : repair.serials.length > 0 ? (
            <p className="text-gray-500">The units have since been deleted.</p>
          ) : (
            <p className="text-gray-900">
              {repair.quantity} of {item?.name ?? "the item"}
            </p>
          )}
          {repair.dueAt && <p className="text-xs text-gray-500 pt-1">Expected back {formatDate(repair.dueAt)}</p>}
        </section>

        {feature("projects") && (
          <section className="card p-4 flex flex-col gap-2 text-sm">
            <h2 className="eyebrow text-gray-500">Came back damaged from</h2>
            {canEdit ? (
              <ProjectPicker
                value={repair.expand?.job ?? null}
                onChange={(job) => update({ job: job?.id ?? "" }, job ? `Linked to #${job.number}` : "Unlinked")}
                disabled={saving}
              />
            ) : repair.expand?.job ? null : (
              <p className="text-gray-500">No project.</p>
            )}
            {repair.expand?.job && (
              <Link to={`/projects/${repair.expand.job.id}`} className="text-xs text-signal-ink hover:text-signal-ink-hover w-fit">
                Open #{repair.expand.job.number} {repair.expand.job.name} →
              </Link>
            )}
          </section>
        )}

        <FilesCard
          record={repair}
          canEdit={canEdit}
          upload={(file) => api.uploadRepairFile(id, file)}
          remove={(name) => api.deleteRepairFile(id, name)}
          onChanged={(next) => {
            queryClient.setQueryData(["repairs", id], { ...next, expand: repair.expand });
            queryClient.invalidateQueries({ queryKey: ["repairs"] });
          }}
        />

        {activity.length > 0 && (
          <section className="card p-4 flex flex-col gap-2 text-sm">
            <h2 className="eyebrow text-gray-500">Activity</h2>
            <ol className="flex flex-col gap-2">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col">
                  <span className="text-gray-800">{a.summary}</span>
                  <span className="text-xs text-gray-400">
                    {[a.who, formatDateTime(a.timestamp)].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        </div>
      </div>
    </div>
  );
}
