import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type JobSummary } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDuration, fromLocalInput, parseDate, toLocalInput } from "../../lib/format";
import Field from "../Field";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

const ms = (value: string) => parseDate(fromLocalInput(value))?.getTime() ?? NaN;

// Starting a subproject: a name, when its kit is booked, and when it's
// charged (the same time unless said otherwise). More periods, pack in
// times and the like go on the Schedule tab afterwards.
export default function NewSubprojectModal({
  summary,
  onSaved,
  onClose,
}: {
  summary: JobSummary;
  onSaved: (summary: JobSummary) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { job } = summary;
  const [name, setName] = useState("");
  const [usageStart, setUsageStart] = useState(toLocalInput(job.prepAt));
  const [usageEnd, setUsageEnd] = useState(toLocalInput(job.returnAt));
  const [sameBilling, setSameBilling] = useState(true);
  const [billingStart, setBillingStart] = useState(toLocalInput(job.prepAt));
  const [billingEnd, setBillingEnd] = useState(toLocalInput(job.returnAt));
  const [saving, setSaving] = useState(false);

  const usageOk = ms(usageStart) < ms(usageEnd);
  const billingOk = sameBilling || ms(billingStart) < ms(billingEnd);

  async function save() {
    setSaving(true);
    try {
      const next = await api.addSubproject(job.id, {
        name: name.trim(),
        usageStart: fromLocalInput(usageStart),
        usageEnd: fromLocalInput(usageEnd),
        ...(sameBilling ? {} : { billingStart: fromLocalInput(billingStart), billingEnd: fromLocalInput(billingEnd) }),
      });
      onSaved(next);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["jobs"] }), queryClient.invalidateQueries({ queryKey: ["availability"] })]);
      showToast("success", "Subproject added");
      onClose();
    } catch (err) {
      showToast("error", `Couldn't add it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a subproject" onClose={saving ? () => {} : onClose}>
      <p className="text-xs text-gray-500 -mt-2">
        Part of the project with its own times: its equipment is booked and charged over these, and it's all on the one quote.
      </p>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="input py-2" placeholder="e.g. Finale stage" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Equipment booked from">
          <input type="datetime-local" value={usageStart} onChange={(e) => setUsageStart(e.target.value)} className="input py-2" />
        </Field>
        <Field
          label="Until"
          hint={usageOk ? formatDuration(ms(usageEnd) - ms(usageStart)) : <span className="text-fault-ink">Has to be after the start</span>}
        >
          <input type="datetime-local" value={usageEnd} onChange={(e) => setUsageEnd(e.target.value)} className="input py-2" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sameBilling} onChange={(e) => setSameBilling(e.target.checked)} />
        Charged for the same time
      </label>
      {!sameBilling && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Charged from">
            <input type="datetime-local" value={billingStart} onChange={(e) => setBillingStart(e.target.value)} className="input py-2" />
          </Field>
          <Field
            label="Until"
            hint={billingOk ? formatDuration(ms(billingEnd) - ms(billingStart)) : <span className="text-fault-ink">Has to be after the start</span>}
          >
            <input type="datetime-local" value={billingEnd} onChange={(e) => setBillingEnd(e.target.value)} className="input py-2" />
          </Field>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
        <button onClick={save} disabled={saving || !name.trim() || !usageOk || !billingOk} className="btn-primary">
          {saving ? "Adding…" : "Add subproject"}
        </button>
      </div>
    </Modal>
  );
}
