import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, type JobSummary } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { fromLocalInput, parseDate, toLocalInput } from "../../lib/format";
import { useCan, useFeature } from "../../lib/roles";
import Field from "../Field";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

const WEEK = 7 * 24 * 60 * 60 * 1000;

// Copying a project for a repeat event: a name and when the copy starts.
// The schedule moves with the start, and its equipment and crew needs come
// too unless they're unticked (pb_hooks/lib/jobs.js copyJob).
export default function CopyProjectModal({ summary, onClose }: { summary: JobSummary; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const feature = useFeature();
  const can = useCan();
  const { job } = summary;
  const [name, setName] = useState(job.name);
  // A week on, to start with: quicker to change than to type.
  const [start, setStart] = useState(() => {
    const from = parseDate(job.startAt || job.prepAt)?.getTime() ?? Date.now();
    return toLocalInput(new Date(from + WEEK).toISOString());
  });
  const [equipment, setEquipment] = useState(true);
  const [crew, setCrew] = useState(true);
  const [saving, setSaving] = useState(false);
  // Only what their role could add by hand (the server refuses the rest).
  const lines = can("jobs.lines") ? summary.lines.filter((l) => !l.parentLine).length : 0;
  const crewOn = feature("crew");

  async function copy() {
    setSaving(true);
    try {
      const result = await api.copyJob(job.id, { name: name.trim(), start: fromLocalInput(start), equipment: equipment && lines > 0, crew: crew && crewOn });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (result.skipped > 0) showToast("error", `${result.skipped} line${result.skipped === 1 ? " was" : "s were"} left off: archived items`);
      else showToast("success", `Copied ${job.name}`);
      onClose();
      navigate(`/projects/${result.id}`);
    } catch (err) {
      showToast("error", `Couldn't copy it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Copy #${job.number} ${job.name}`} onClose={saving ? () => {} : onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          copy();
        }}
        className="flex flex-col gap-3"
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} className="input py-2" autoFocus />
        </Field>
        <Field label="Starts">
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required className="input py-2" />
        </Field>
        <div className="flex flex-col gap-1.5 text-sm text-gray-700">
          {lines > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={equipment} onChange={(e) => setEquipment(e.target.checked)} />
              Equipment ({lines} line{lines === 1 ? "" : "s"})
            </label>
          )}
          {crewOn && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={crew} onChange={(e) => setCrew(e.target.checked)} />
              Crew needs
            </label>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving || !name.trim() || !start} className="btn-primary">
            {saving ? "Copying…" : "Copy project"}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
