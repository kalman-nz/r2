import { useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Serial, type SerialStatus } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { fromDateInput } from "../../lib/format";
import { buildLabelContext, type LabelUnit } from "../../lib/labelSpec";
import { useCan, useFeature } from "../../lib/roles";
import { SERIAL_STATUS_LABELS } from "../../lib/statuses";
import BatchPrintBar from "../BatchPrintBar";
import SelectionBar from "../SelectionBar";
import { useConfirm } from "../ConfirmProvider";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import { AMOUNT, numberProblem } from "../../lib/numbers";
import { useToast } from "../ToastProvider";
import { updateEach } from "./BulkEditModal";
import NewRepairModal from "../repair/NewRepairModal";

// The units tab's selection bar: the same actions as the inventory list's,
// for units. Edit covers every field, status and location included; status
// goes through the status route (it logs the change and the note) rather
// than a plain update, like on a unit's own page.
export default function UnitBulkBar({
  item,
  units,
  unitFor,
  onClear,
  onChanged,
  setSelected,
}: {
  item: Item;
  units: Serial[];
  unitFor: (serial: Serial) => LabelUnit;
  onClear: () => void;
  onChanged: () => Promise<unknown>;
  setSelected: (ids: Set<string>) => void;
}) {
  const can = useCan();
  const feature = useFeature();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: locations = [] } = useLocations();
  const [open, setOpen] = useState<"edit" | "repair" | null>(null);
  const [busy, setBusy] = useState(false);
  const what = `${units.length} unit${units.length === 1 ? "" : "s"}`;

  // Runs a bulk change, then refreshes and reports. Failures stay selected.
  async function run(action: () => Promise<{ record: Serial; error: unknown }[]>, done: string) {
    setBusy(true);
    const failed = await action();
    setBusy(false);
    setOpen(null);
    await onChanged();
    if (failed.length === 0) {
      showToast("success", done);
      onClear();
    } else {
      setSelected(new Set(failed.map((f) => f.record.id)));
      showToast("error", `${failed.length} of ${units.length} couldn't be changed: ${errorText(failed[0].error)}. They're still selected.`);
    }
  }

  async function setStatus(status: SerialStatus, note: string) {
    await run(async () => {
      const failed: { record: Serial; error: unknown }[] = [];
      for (const unit of units) {
        if (unit.status === status && !note) continue;
        try {
          await api.setSerialStatus(unit.id, status, note);
        } catch (error) {
          failed.push({ record: unit, error });
        }
      }
      return failed;
    }, `Marked ${what} ${SERIAL_STATUS_LABELS[status].toLowerCase()}`);
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${what}`,
      message: `Delete ${what}? This can't be undone. Units that have been scanned on a project are skipped: mark those retired instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const failed: { record: Serial; error: unknown }[] = [];
      for (const unit of units) {
        try {
          await pb.collection("serials").delete(unit.id);
        } catch (error) {
          failed.push({ record: unit, error });
        }
      }
      return failed;
    }, `Deleted ${what}`);
  }

  // Retired units stay on record but can't go out. Restore puts them back.
  const allRetired = units.every((u) => u.status === "retired");
  async function retire() {
    if (allRetired) return setStatus("active", "");
    const ok = await confirm({
      title: `Retire ${what}`,
      message: `Retire ${what}? They stay on record but can't go out on projects. You can restore them any time.`,
      confirmLabel: "Retire",
    });
    if (ok) await setStatus("retired", "");
  }

  // One save for everything ticked in Edit: plain fields first, then the
  // status through its own route so the change and note are logged.
  async function applyEdit(body: Record<string, unknown>, status: { status: SerialStatus; note: string } | null) {
    await run(async () => {
      const failed = Object.keys(body).length > 0 ? await updateEach("serials", units, () => body) : [];
      if (status) {
        const failedIds = new Set(failed.map((f) => f.record.id));
        for (const unit of units) {
          if (failedIds.has(unit.id) || (unit.status === status.status && !status.note)) continue;
          try {
            await api.setSerialStatus(unit.id, status.status, status.note);
          } catch (error) {
            failed.push({ record: unit, error });
          }
        }
      }
      return failed;
    }, `Updated ${what}`);
  }

  return (
    <SelectionBar count={units.length} onClear={onClear}>
      {(can("units.edit") || can("units.flag")) && (
        <button onClick={() => setOpen("edit")} disabled={busy} className="btn-primary">
          Edit
        </button>
      )}
      <BatchPrintBar<Serial>
        items={units}
        getDisplayName={(s) => s.label || s.barcode}
        getContext={(s) => buildLabelContext(unitFor(s))}
        getSerialId={(s) => s.id}
        onDone={onClear}
      />
      {can("units.flag") && (
        <>
          {feature("repairs") && (
            <button onClick={() => setOpen("repair")} disabled={busy} className="btn-secondary">
              Repair
            </button>
          )}
          <button onClick={retire} disabled={busy} className="btn-secondary">
            {allRetired ? "Restore" : "Retire"}
          </button>
        </>
      )}
      {can("units.delete") && (
        <button onClick={remove} disabled={busy} className="btn-secondary hover:text-fault-ink">
          Delete
        </button>
      )}

      {open === "edit" && (
        <EditModal
          what={what}
          busy={busy}
          locations={locations}
          canEdit={can("units.edit")}
          canStatus={can("units.flag")}
          onClose={() => setOpen(null)}
          onApply={applyEdit}
        />
      )}
      {open === "repair" && (
        <NewRepairModal
          item={item}
          serials={units.filter((u) => u.status === "active").map((u) => u.id)}
          onClose={async () => {
            setOpen(null);
            await onChanged();
          }}
          onCreated={async (repair) => {
            setOpen(null);
            await onChanged();
            onClear();
            showToast("success", `Opened repair R${repair.number}`);
          }}
        />
      )}
    </SelectionBar>
  );
}

// Tick what to change, like the items' bulk edit. Editing a field ticks it.
function EditModal({
  what,
  busy,
  locations,
  canEdit,
  canStatus,
  onClose,
  onApply,
}: {
  what: string;
  busy: boolean;
  locations: { id: string; name: string }[];
  canEdit: boolean;
  canStatus: boolean;
  onClose: () => void;
  onApply: (body: Record<string, unknown>, status: { status: SerialStatus; note: string } | null) => void;
}) {
  const [status, setStatusValue] = useState<SerialStatus>("active");
  const [note, setNote] = useState("");
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  const [bin, setBin] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState(0);
  const [nextInspection, setNextInspection] = useState("");
  const [notes, setNotes] = useState("");
  const [on, setOn] = useState<Set<string>>(new Set());
  const tick = (key: string, value = true) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });

  function apply() {
    const body: Record<string, unknown> = {};
    if (on.has("location")) body.location = location;
    if (on.has("bin")) body.bin = bin.trim();
    if (on.has("purchaseDate")) body.purchaseDate = fromDateInput(purchaseDate);
    if (on.has("purchaseCost")) body.purchaseCost = purchaseCost;
    if (on.has("nextInspection")) body.nextInspection = fromDateInput(nextInspection);
    if (on.has("notes")) body.notes = notes;
    onApply(body, on.has("status") ? { status, note: note.trim() } : null);
  }

  const row = (key: string, label: string, input: ReactNode) => (
    <div className="grid grid-cols-[1.25rem_8.5rem_minmax(0,1fr)] gap-2 items-center py-1.5 text-sm">
      <input type="checkbox" checked={on.has(key)} onChange={(e) => tick(key, e.target.checked)} aria-label={`Change ${label}`} />
      <span className={on.has(key) ? "text-gray-900" : "text-gray-500"}>{label}</span>
      <div className="min-w-0">{input}</div>
    </div>
  );

  return (
    <Modal title={`Edit ${what}`} onClose={busy ? () => {} : onClose}>
      <p className="text-xs text-gray-500 -mt-2">Tick what to change. Everything else stays as it is on each unit. Leave a date empty to clear it.</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {canStatus &&
          row(
            "status",
            "Status",
            <div className="flex flex-col gap-1.5">
              <select
                value={status}
                onChange={(e) => {
                  setStatusValue(e.target.value as SerialStatus);
                  tick("status");
                }}
                className="input py-1.5 w-full"
              >
                {/* In repair comes from opening a repair (the Repair button), so it's tracked. */}
                {(Object.keys(SERIAL_STATUS_LABELS) as SerialStatus[])
                  .filter((s) => s !== "repair")
                  .map((s) => (
                    <option key={s} value={s}>
                      {SERIAL_STATUS_LABELS[s]}
                    </option>
                  ))}
              </select>
              {on.has("status") && (
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional, logged)" className="input py-1.5 w-full" />
              )}
            </div>,
          )}
        {canEdit && locations.length > 0 &&
          row(
            "location",
            "Location",
            <select
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                tick("location");
              }}
              className="input py-1.5 w-full"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="">No location</option>
            </select>,
          )}
        {canEdit &&
          row(
            "bin",
            "Shelf / bin",
            <input
              value={bin}
              onChange={(e) => {
                setBin(e.target.value);
                tick("bin");
              }}
              className="input py-1.5 w-full"
            />,
          )}
        {canEdit &&
          row(
            "purchaseDate",
            "Purchase date",
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => {
                setPurchaseDate(e.target.value);
                tick("purchaseDate");
              }}
              className="input py-1.5 w-full"
            />,
          )}
        {canEdit &&
          row(
            "purchaseCost",
            "Purchase cost",
            <NumberInput
              value={purchaseCost}
              min={0}
              onChange={(n) => {
                setPurchaseCost(n);
                tick("purchaseCost");
              }}
              className="input py-1.5 w-full"
            />,
          )}
        {canEdit &&
          row(
            "nextInspection",
            "Next inspection",
            <input
              type="date"
              value={nextInspection}
              onChange={(e) => {
                setNextInspection(e.target.value);
                tick("nextInspection");
              }}
              className="input py-1.5 w-full"
            />,
          )}
        {canEdit &&
          row(
            "notes",
            "Notes",
            <textarea
              value={notes}
              rows={2}
              placeholder="Replaces each unit's notes"
              onChange={(e) => {
                setNotes(e.target.value);
                tick("notes");
              }}
              className="input py-1.5 w-full"
            />,
          )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={apply} disabled={busy || on.size === 0 || (on.has("purchaseCost") && !!numberProblem(purchaseCost, AMOUNT))} className="btn-primary">
          {busy ? "Saving…" : `Update ${what}`}
        </button>
        <button onClick={onClose} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
