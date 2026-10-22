import { useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Serial, type SerialStatus } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { fromDateInput } from "../../lib/format";
import type { LabelUnit } from "../../lib/labelSpec";
import { renderUnitLabelImage, sendRenderedLabel } from "../../lib/print";
import { useCan } from "../../lib/roles";
import { SERIAL_STATUS_LABELS } from "../../lib/statuses";
import BatchPrintBar from "../BatchPrintBar";
import { useConfirm } from "../ConfirmProvider";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";
import { updateEach } from "./BulkEditModal";
import NewRepairModal from "../repair/NewRepairModal";
import NewJobModal from "../maintenance/NewJobModal";

// The units tab's selection bar: the same actions as the inventory list's,
// for units. Status goes through the status route (it logs the change and
// the note) rather than a plain update, like on a unit's own page.
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
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: locations = [] } = useLocations();
  const [open, setOpen] = useState<"edit" | "move" | "repair" | "schedule" | "status" | null>(null);
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

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm card px-4 py-2">
      <span className="font-medium text-gray-900 mr-1">{units.length} selected</span>
      {can("units.edit") && (
        <>
          <button onClick={() => setOpen("edit")} disabled={busy} className="btn-primary">
            Edit
          </button>
          {locations.length > 0 && (
            <button onClick={() => setOpen("move")} disabled={busy} className="btn-secondary">
              Move
            </button>
          )}
        </>
      )}
      <BatchPrintBar<Serial>
        bare
        items={units}
        getDisplayName={(s) => s.label || s.barcode}
        renderImage={(s, t) => renderUnitLabelImage(unitFor(s), t)}
        sendPrint={(image, t, s) => sendRenderedLabel(image, t, s.id)}
        onDone={onClear}
      />
      {can("units.flag") && (
        <>
          <button onClick={() => setOpen("repair")} disabled={busy} className="btn-secondary">
            Repair
          </button>
          <button onClick={() => setOpen("schedule")} disabled={busy} className="btn-secondary" title="Schedule one-off maintenance on these units">
            Schedule
          </button>
          <button onClick={() => setOpen("status")} disabled={busy} className="btn-secondary">
            Status
          </button>
        </>
      )}
      {can("units.delete") && (
        <button onClick={remove} disabled={busy} className="btn-secondary hover:text-fault-ink">
          Delete
        </button>
      )}
      <button onClick={onClear} className="text-gray-500 hover:text-gray-900 ml-auto">
        Clear selection
      </button>

      {open === "edit" && (
        <EditModal
          what={what}
          busy={busy}
          onClose={() => setOpen(null)}
          onApply={(body) => run(() => updateEach("serials", units, () => body), `Updated ${what}`)}
        />
      )}
      {open === "move" && (
        <MoveModal
          what={what}
          busy={busy}
          locations={locations}
          onClose={() => setOpen(null)}
          onApply={(location) =>
            run(
              () => updateEach("serials", units, () => ({ location })),
              `Moved ${what} to ${locations.find((l) => l.id === location)?.name ?? "no location"}`,
            )
          }
        />
      )}
      {open === "repair" && (
        <NewRepairModal
          item={item}
          serials={units.filter((u) => u.status === "active").map((u) => u.id)}
          onClose={() => setOpen(null)}
          onCreated={async (repair) => {
            setOpen(null);
            await onChanged();
            onClear();
            showToast("success", `Opened repair R${repair.number}`);
          }}
        />
      )}
      {open === "schedule" && (
        <NewJobModal
          item={item}
          serials={units.map((u) => u.id)}
          onClose={() => setOpen(null)}
          onCreated={async (jobs) => {
            setOpen(null);
            await onChanged();
            onClear();
            showToast("success", `Scheduled ${jobs.length} job${jobs.length === 1 ? "" : "s"}`);
          }}
        />
      )}
      {open === "status" && <StatusModal what={what} busy={busy} onClose={() => setOpen(null)} onApply={setStatus} />}
    </div>
  );
}

// Tick what to change, like the items' bulk edit. Editing a field ticks it.
function EditModal({
  what,
  busy,
  onClose,
  onApply,
}: {
  what: string;
  busy: boolean;
  onClose: () => void;
  onApply: (body: Record<string, unknown>) => void;
}) {
  const [nextInspection, setNextInspection] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState(0);
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
    if (on.has("nextInspection")) body.nextInspection = fromDateInput(nextInspection);
    if (on.has("purchaseDate")) body.purchaseDate = fromDateInput(purchaseDate);
    if (on.has("purchaseCost")) body.purchaseCost = purchaseCost;
    onApply(body);
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
      <p className="text-xs text-gray-500 -mt-2">Tick what to change. Leave a date empty to clear it.</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {row(
          "nextInspection",
          "Test & tag due",
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
        {row(
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
        {row(
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
      </div>
      <div className="flex items-center gap-2">
        <button onClick={apply} disabled={busy || on.size === 0} className="btn-primary">
          {busy ? "Saving…" : `Update ${what}`}
        </button>
        <button onClick={onClose} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function MoveModal({
  what,
  busy,
  locations,
  onClose,
  onApply,
}: {
  what: string;
  busy: boolean;
  locations: { id: string; name: string }[];
  onClose: () => void;
  onApply: (location: string) => void;
}) {
  const [location, setLocation] = useState(locations[0]?.id ?? "");
  return (
    <Modal title={`Move ${what} to…`} onClose={busy ? () => {} : onClose}>
      <select value={location} onChange={(e) => setLocation(e.target.value)} className="input py-1.5">
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
        <option value="">No location</option>
      </select>
      <div className="flex items-center gap-2">
        <button onClick={() => onApply(location)} disabled={busy} className="btn-primary">
          {busy ? "Moving…" : "Move here"}
        </button>
        <button onClick={onClose} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function StatusModal({
  what,
  busy,
  onClose,
  onApply,
}: {
  what: string;
  busy: boolean;
  onClose: () => void;
  onApply: (status: SerialStatus, note: string) => void;
}) {
  const [status, setStatus] = useState<SerialStatus>("lost");
  const [note, setNote] = useState("");
  return (
    <Modal title={`Set status of ${what}`} onClose={busy ? () => {} : onClose}>
      <select value={status} onChange={(e) => setStatus(e.target.value as SerialStatus)} className="input py-1.5">
        {/* In repair comes from opening a repair (the Repair button), so it's tracked. */}
        {(Object.keys(SERIAL_STATUS_LABELS) as SerialStatus[])
          .filter((s) => s !== "repair")
          .map((s) => (
            <option key={s} value={s}>
              {SERIAL_STATUS_LABELS[s]}
            </option>
          ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong? (optional)" className="input py-1.5" />
      <div className="flex items-center gap-2">
        <button onClick={() => onApply(status, note.trim())} disabled={busy} className="btn-primary">
          {busy ? "Saving…" : "Update status"}
        </button>
        <button onClick={onClose} disabled={busy} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
