import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type Job, type Location, type Scan, type Serial, type SerialStatus } from "../lib/api";
import { unitTitle, useCategoryPaths, useLocations, useSerialNumberTaken } from "../lib/catalog";
import { buildLabelContext, unitDisplayName } from "../lib/labelSpec";
import { formatDateTime, fromDateInput, toDateInput } from "../lib/format";
import { errorText } from "../lib/errors";
import { useFeature, useRole } from "../lib/roles";
import Field, { Problem } from "../components/Field";
import NumberInput from "../components/NumberInput";
import { AMOUNT, numberProblem } from "../lib/numbers";
import PrintButton from "../components/PrintButton";
import { SerialStatusBadge } from "../components/StatusBadge";
import { SERIAL_STATUS_LABELS } from "../lib/statuses";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { useFollowOrg } from "../lib/org";
import { invalidateMaintenance, useMaintenanceJobs, useRepairStatuses, useRepairs } from "../lib/maintenance";
import UnitMaintenanceCard from "../components/item/UnitMaintenanceCard";
import Breadcrumbs, { useFolderCrumbs } from "../components/Breadcrumbs";
import FilesCard from "../components/FilesCard";

type SerialWithExpand = Serial & { expand?: { item?: Item; location?: Location } };
type ScanWithExpand = Scan & { expand?: { job?: Job; who?: { name: string; email: string } } };

export default function SerialDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = useRole();
  const feature = useFeature();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const paths = useCategoryPaths();

  const { data: serial, isLoading, error } = useQuery({
    queryKey: ["serial", id],
    queryFn: () => pb.collection("serials").getOne<SerialWithExpand>(id, { expand: "item,location" }),
  });
  useFollowOrg(serial?.org);
  const folderCrumbs = useFolderCrumbs(serial?.expand?.item?.category ?? "");
  const { data: scans = [] } = useQuery({
    queryKey: ["scans", "serial", id],
    queryFn: () =>
      pb.collection("scans").getFullList<ScanWithExpand>({
        filter: pb.filter("serial = {:serial}", { serial: id }),
        sort: "-created",
        expand: "job,who",
      }),
  });
  const { data: repairs = [] } = useRepairs(pb.filter("serials.id ?= {:id}", { id }));
  const { isOpen } = useRepairStatuses();
  const onRepair = repairs.find((r) => isOpen(r.status));
  // Same query as the maintenance card, so it's shared.
  const { data: maintenance = [] } = useMaintenanceJobs(`serial = "${id}"`, "dueOn");
  // Scans, repairs and done maintenance are its history: the server keeps
  // units with any of them (retire those instead).
  const hasHistory = scans.length > 0 || repairs.length > 0 || maintenance.some((j) => j.status === "done");

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !serial) return <p className="text-red-600 text-sm">Couldn't load this unit: {error ? errorText(error) : "not found"}</p>;

  const item = serial.expand?.item ?? null;
  const latest = scans[0];
  const outOn = latest?.direction === "out" ? latest.expand?.job : undefined;
  const unit = {
    serial,
    item,
    categoryPath: item ? (paths.get(item.category) ?? "") : "",
    locationName: [serial.expand?.location?.name, serial.bin].filter(Boolean).join(", "),
    currentJob: outOn ? `#${outOn.number} ${outOn.name}` : "",
  };

  async function refresh(next?: Serial) {
    if (next) queryClient.setQueryData(["serial", id], { ...serial, ...next, expand: serial?.expand });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["serial", id] }), invalidateMaintenance(queryClient)]);
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete unit",
      message: `Delete ${serial!.barcode || "this unit"}? To keep its history, mark it retired instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("serials").delete(id);
      await queryClient.invalidateQueries({ queryKey: ["serials"] });
      navigate(item ? `/inventory/${item.id}?tab=units` : "/inventory", { replace: true });
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[...folderCrumbs, ...(item ? [{ label: item.name, to: `/inventory/${item.id}?tab=units` }] : []), { label: unitDisplayName(serial, item) }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">{unitDisplayName(serial, item)}</h1>
            <SerialStatusBadge status={serial.status} />
          </div>
          <p className="text-gray-500 text-sm font-mono">{[serial.barcode, serial.serialNumber].filter(Boolean).join(" · ")}</p>
          {outOn && (
            <p className="text-sm text-violet-700 mt-0.5">
              Out on{" "}
              <Link to={`/projects/${outOn.id}`} className="underline">
                #{outOn.number} {outOn.name}
              </Link>
            </p>
          )}
        </div>
        <PrintButton context={buildLabelContext(unit)} serialId={serial.id} />
      </div>

      {onRepair && (
        <div className="card bg-amber-50/60 px-4 py-2.5 text-sm text-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <span>
            On repair R{onRepair.number}: {onRepair.fault}. It's back in service when the repair's marked repaired.
          </span>
          <Link to={`/maintenance/repairs/${onRepair.id}`} className="btn-secondary py-1">
            Open repair
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="md:col-span-2 flex flex-col gap-4">
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">Details</h2>
            <SerialForm serial={serial} readOnly={!can("units.edit")} onSaved={refresh} />
            {can("units.delete") && !hasHistory && (
              <div className="pt-3 mt-3 border-t border-gray-100 flex justify-end">
                <button onClick={remove} className="text-sm text-red-600 hover:text-red-700">
                  Delete unit
                </button>
              </div>
            )}
          </section>

          <FilesCard
            record={{ ...serial, files: serial.files ?? [], fileInfo: serial.fileInfo ?? null }}
            canEdit={can("units.edit")}
            upload={(file) => api.uploadSerialFile(serial.id, file)}
            remove={(stored) => api.deleteSerialFile(serial.id, stored)}
            onChanged={refresh}
            hint=""
          />

          {feature("scanning") && <section className="card overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-500 px-4 pt-3 pb-2">Scan history</h2>
            <div className="divide-y divide-gray-100">
              {scans.map((s) => (
                <div key={s.id} className="px-4 py-2 text-sm flex items-center justify-between gap-3">
                  <span>
                    <span className={s.direction === "out" ? "text-violet-700 font-medium" : "text-emerald-700 font-medium"}>
                      {s.direction === "out" ? "Out" : "In"}
                    </span>{" "}
                    {s.expand?.job ? (
                      <Link to={`/projects/${s.job}`} className="hover:underline">
                        #{s.expand.job.number} {s.expand.job.name}
                      </Link>
                    ) : (
                      "(deleted project)"
                    )}
                    {s.expand?.who && <span className="text-gray-400"> · {s.expand.who.name || s.expand.who.email}</span>}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0">{formatDateTime(s.created)}</span>
                </div>
              ))}
              {scans.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">Never scanned out.</p>}
            </div>
          </section>}
        </div>

        <div className="flex flex-col gap-4">
          {can("units.flag") && <StatusCard serial={serial} onRepair={onRepair?.number ?? null} onSaved={refresh} />}
          {(feature("repairs") || feature("maintenance")) && <UnitMaintenanceCard unit={serial} item={item} repairs={repairs} canRecord={can("units.flag")} />}
        </div>
      </div>
    </div>
  );
}

// Flagging a unit is its own permission (units.flag), so a tech who finds a
// blown driver doesn't need someone who can edit units to take it out of
// stock. A unit on a repair comes back to Active by closing the repair.
function StatusCard({ serial, onRepair, onSaved }: { serial: Serial; onRepair: number | null; onSaved: (s: Serial) => void }) {
  // Without repair jobs (Settings → Features), In repair is a plain flag.
  const feature = useFeature();
  const repairs = feature("repairs");
  const [status, setStatus] = useState<SerialStatus>(serial.status);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  useEffect(() => setStatus(serial.status), [serial.status]);

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.setSerialStatus(serial.id, status, note));
      setNote("");
      showToast("success", `Marked ${SERIAL_STATUS_LABELS[status].toLowerCase()}`);
    } catch (err) {
      showToast("error", `Couldn't update: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-3 text-sm">
      <div>
        <h2 className="text-sm font-semibold text-gray-500">Status</h2>
      </div>
      <select value={status} onChange={(e) => setStatus(e.target.value as SerialStatus)} className="input py-1.5">
        {/* In repair comes from opening a repair, so it's tracked; it only shows while the unit is in one. */}
        {(Object.keys(SERIAL_STATUS_LABELS) as SerialStatus[])
          .filter((s) => (s !== "repair" || serial.status === "repair" || !repairs) && !(s === "active" && onRepair))
          .map((s) => (
          <option key={s} value={s}>
            {SERIAL_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What happened? (added to the unit's notes)"
        className="input py-1.5"
      />
      <button onClick={save} disabled={saving || (status === serial.status && !note.trim())} className="btn-secondary w-fit">
        {saving ? "Saving…" : "Update status"}
      </button>
    </section>
  );
}

function SerialForm({ serial, readOnly, onSaved }: { serial: Serial; readOnly: boolean; onSaved: (s: Serial) => void }) {
  const initial = () => ({
    barcode: serial.barcode,
    serialNumber: serial.serialNumber,
    label: serial.label,
    location: serial.location,
    bin: serial.bin ?? "",
    purchaseDate: toDateInput(serial.purchaseDate),
    purchaseCost: serial.purchaseCost,
    nextInspection: toDateInput(serial.nextInspection),
    notes: serial.notes,
  });
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { data: locations = [] } = useLocations();
  const { showToast } = useToast();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset whenever the saved record changes
  useEffect(() => setDraft(initial()), [serial.updated]);
  const set = <K extends keyof ReturnType<typeof initial>>(key: K, value: ReturnType<typeof initial>[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  // Another unit with this serial number (a second is refused). Its own,
  // unchanged, is fine even where an import left two the same.
  const serialChanged = draft.serialNumber.trim().toLowerCase() !== serial.serialNumber.trim().toLowerCase();
  const taken = useSerialNumberTaken(serialChanged ? draft.serialNumber : "", serial.id);
  const costProblem = numberProblem(draft.purchaseCost, AMOUNT);

  async function save() {
    setSaving(true);
    try {
      const saved = await pb.collection("serials").update<Serial>(serial.id, {
        ...draft,
        purchaseDate: fromDateInput(draft.purchaseDate),
        nextInspection: fromDateInput(draft.nextInspection),
      });
      onSaved(saved);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Barcode / asset tag">
          <input value={draft.barcode} onChange={(e) => set("barcode", e.target.value)} disabled={readOnly} className="input py-2 font-mono" />
        </Field>
        <Field label="Manufacturer serial">
          <input
            value={draft.serialNumber}
            onChange={(e) => set("serialNumber", e.target.value)}
            disabled={readOnly}
            aria-invalid={taken ? true : undefined}
            className="input py-2"
          />
          {taken && (
            <Problem>
              Already on{" "}
              <Link to={`/assets/${taken.id}`} className="underline">
                {unitTitle(taken)}
              </Link>
            </Problem>
          )}
        </Field>
        <Field label="Name">
          <input value={draft.label} onChange={(e) => set("label", e.target.value)} disabled={readOnly} className="input py-2" />
        </Field>
        <Field label="Storage location">
          <select value={draft.location} onChange={(e) => set("location", e.target.value)} disabled={readOnly} className="input py-2">
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shelf / bin">
          <input value={draft.bin} onChange={(e) => set("bin", e.target.value)} disabled={readOnly} placeholder="e.g. Bay 3" className="input py-2" />
        </Field>
        <Field label="Purchase date">
          <input type="date" value={draft.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} disabled={readOnly} className="input py-2" />
        </Field>
        <Field label="Purchase cost" error={costProblem}>
          <NumberInput value={draft.purchaseCost} min={0} onChange={(n) => set("purchaseCost", n)} disabled={readOnly} className="input py-2" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} disabled={readOnly} rows={3} className="input py-2" />
        </Field>
      </div>
      {!readOnly && (
        <div>
          <button onClick={save} disabled={saving || !dirty || !!taken || !!costProblem} className="btn-primary py-2">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}
