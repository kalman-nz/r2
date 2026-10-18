import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type Repair, type RepairStatus, type Serial } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatDate, formatDateTime, fromDateInput, toDateInput } from "../lib/format";
import { useRole } from "../lib/roles";
import { useFollowOrg } from "../lib/org";
import NumberInput from "../components/NumberInput";
import { RepairStatusBadge, SerialStatusBadge } from "../components/StatusBadge";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import { invalidateRepairs } from "./RepairsList";

type RepairWithExpand = Repair & { expand?: { item?: Item; serials?: Serial[] } };

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
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);

  const {
    data: repair,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["repairs", id],
    queryFn: () => pb.collection("repairs").getOne<RepairWithExpand>(id, { expand: "item,serials" }),
  });
  useFollowOrg(repair?.org);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (repair) setDraft(draftOf(repair));
  }, [repair]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !repair || !draft) return <p className="text-red-600 text-sm">Couldn't load this repair: {error ? errorText(error) : "not found"}</p>;

  const open = repair.status === "open" || repair.status === "in_progress";
  const canEdit = can("units.flag");
  const item = repair.expand?.item;
  const units = repair.expand?.serials ?? [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(repair));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function update(body: Parameters<typeof api.updateRepair>[1], done: string) {
    setSaving(true);
    try {
      await api.updateRepair(id, body);
      await invalidateRepairs(queryClient);
      showToast("success", done);
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const saveDetails = () => update({ ...draft!, fault: draft!.fault.trim(), dueAt: fromDateInput(draft!.dueAt) }, "Saved");

  async function close(status: RepairStatus) {
    const what =
      repair!.serials.length > 0
        ? `the ${repair!.serials.length === 1 ? "unit" : `${repair!.serials.length} units`}`
        : `${repair!.quantity} of ${item?.name ?? "the item"}`;
    const ok = await confirm(
      status === "written_off"
        ? {
            title: "Write off",
            message: `Write off ${what}? ${repair!.serials.length > 0 ? "The units are marked retired." : "The stock quantity goes down by " + repair!.quantity + "."} This repair can't be reopened.`,
            confirmLabel: "Write off",
            danger: true,
          }
        : { title: "Mark fixed", message: `Mark fixed? ${what[0].toUpperCase() + what.slice(1)} go back in service.`, confirmLabel: "Mark fixed" },
    );
    if (!ok) return;
    // Unsaved edits go with it.
    await update(
      { ...(dirty ? { ...draft!, dueAt: fromDateInput(draft!.dueAt) } : {}), status },
      status === "written_off" ? "Written off" : "Back in service",
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <Link to="/repairs" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Repairs
      </Link>

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
            {repair.closedAt && ` · closed ${formatDateTime(repair.closedAt)}`}
          </p>
        </div>
        {open && canEdit && (
          <div className="flex items-center gap-1.5">
            {repair.status === "open" && (
              <button onClick={() => update({ status: "in_progress" }, "Marked being repaired")} disabled={saving} className="btn-secondary">
                Start repair
              </button>
            )}
            <button onClick={() => close("written_off")} disabled={saving} className="btn-secondary hover:text-fault-ink">
              Write off
            </button>
            <button onClick={() => close("completed")} disabled={saving} className="btn-primary">
              Mark fixed
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="card bg-amber-50/60 px-4 py-2.5 text-sm text-gray-700">
          Out of service:{" "}
          {units.length > 0
            ? `${units.length === 1 ? "this unit isn't" : "these units aren't"}`
            : `${repair.quantity} ${repair.quantity === 1 ? "isn't" : "aren't"}`}{" "}
          available for projects until the repair is closed.
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
              <span className="text-gray-500">Repaired by</span>
              <input value={draft.repairer} onChange={(e) => set("repairer", e.target.value)} disabled={!canEdit} className="input py-1.5" />
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
      </div>
    </div>
  );
}
