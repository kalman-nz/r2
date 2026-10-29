import { useState } from "react";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDay, today, type JobWithExpand } from "../../lib/maintenance";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

// Moving a batch's due date: the inspection day's moved, or the kit's away
// on a job until next week.
export default function RescheduleModal({ jobs, onClose, onDone }: { jobs: JobWithExpand[]; onClose: () => void; onDone: () => void }) {
  const { showToast } = useToast();
  const [dueOn, setDueOn] = useState(() => [...jobs].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]?.dueOn || today());
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    let moved = 0;
    const problems: string[] = [];
    for (const job of jobs) {
      try {
        await api.updateJob(job.id, { dueOn });
        moved++;
      } catch (err) {
        problems.push(errorText(err));
      }
    }
    if (moved > 0) showToast("success", `${moved === 1 ? "Moved" : `Moved ${moved}`} to ${formatDay(dueOn)}`);
    if (problems.length > 0) showToast("error", `${problems.length} couldn't be moved: ${problems[0]}`);
    setSaving(false);
    onDone();
  }

  return (
    <Modal title={jobs.length === 1 ? "Move due date" : `Move ${jobs.length} due dates`} onClose={saving ? () => {} : onClose}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Due on</span>
        <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="input py-1.5 w-48" autoFocus />
      </label>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !dueOn} className="btn-primary">
          {saving ? "Moving…" : "Move"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
