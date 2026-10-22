import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type JobSummary } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useJobStatuses } from "../../lib/workflow";
import { useToast } from "../ToastProvider";

// When everything on a project has reached a step that names a status
// (Settings → Equipment tracking), offer it: "Everything's Loaded: set the
// project to Out?". Project status is never changed by tracking itself.
export default function TrackingSuggestion({ summary }: { summary: JobSummary }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { byId } = useJobStatuses();
  const [dismissed, setDismissed] = useState("");
  const [busy, setBusy] = useState(false);
  const offer = summary.trackingSuggestion;
  if (!offer || dismissed === offer.status) return null;
  const current = byId.get(summary.job.jobStatus)?.name;

  async function accept() {
    if (!offer) return;
    setBusy(true);
    try {
      queryClient.setQueryData(["job-summary", summary.job.id], await api.acceptTrackingStatus(summary.job.id, offer.status));
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      showToast("success", `Project set to ${offer.statusName}`);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-signal/40 bg-signal-soft/40 text-sm" role="status">
      <span className="text-gray-800">
        Everything's <span className="font-semibold">{offer.stepName}</span>. Set the project to <span className="font-semibold">{offer.statusName}</span>
        {current ? <span className="text-gray-500"> (it's {current} now)</span> : null}?
      </span>
      <span className="flex items-center gap-2">
        <button onClick={accept} disabled={busy} className="btn-primary !py-1">
          {busy ? "Setting…" : `Set to ${offer.statusName}`}
        </button>
        <button onClick={() => setDismissed(offer.status)} disabled={busy} className="text-xs text-gray-500 hover:text-gray-900">
          Not now
        </button>
      </span>
    </div>
  );
}
