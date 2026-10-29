import { useState } from "react";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { today, type JobWithExpand } from "../../lib/maintenance";
import { useAuthRecord } from "../../lib/pocketbase";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

// Passing a batch in one go, after an inspection day. Each one's next is
// scheduled from the day it was done.
export default function PassModal({ jobs, onClose, onDone }: { jobs: JobWithExpand[]; onClose: () => void; onDone: () => void }) {
  const me = useAuthRecord();
  const { showToast } = useToast();
  const [doneOn, setDoneOn] = useState(today());
  const [doneBy, setDoneBy] = useState<string>(me?.name || me?.email || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await api.passJobs(
        jobs.map((j) => j.id),
        doneOn,
        doneBy.trim(),
      );
      const problems = Object.values(result.failed);
      if (result.done > 0) showToast("success", `${result.done} passed`);
      if (problems.length > 0) showToast("error", `${problems.length} couldn't be recorded: ${problems[0]}`);
      onDone();
    } catch (err) {
      showToast("error", `Couldn't record them: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Mark ${jobs.length} passed`} onClose={saving ? () => {} : onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">Done on</span>
          <input type="date" value={doneOn} max={today()} onChange={(e) => setDoneOn(e.target.value)} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">Done by</span>
          <input value={doneBy} onChange={(e) => setDoneBy(e.target.value)} className="input py-1.5" placeholder="Who did it" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !doneOn} className="btn-primary">
          {saving ? "Recording…" : `Mark ${jobs.length} passed`}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
