import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { useFeature } from "../../lib/roles";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";

const NAME = { rentman: "Rentman", momentus: "Momentus" } as const;

// On a project's page: which system it's synced with (Settings →
// Integrations), and, when the organisation allows it, sending an R2
// project to Rentman as a project request. Nothing shows for a project
// that isn't synced and can't be, or while its sync is off.
export default function SyncCard({ jobId }: { jobId: string }) {
  const feature = useFeature();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [sending, setSending] = useState(false);
  const { data } = useQuery({
    queryKey: ["sync-link", "jobs", jobId],
    queryFn: () => api.syncLink("jobs", jobId),
    enabled: feature("integrations"),
    staleTime: 30_000,
  });
  // Hidden while the sync's off or paused: there's nothing to do with it here.
  const link = data?.link?.active ? data.link : null;
  if (!data || (!link && !data.canSendToRentman && !data.sending)) return null;

  async function send() {
    const ok = await confirm({
      title: "Send to Rentman",
      message:
        "Send this project, with its dates, client, location and equipment, to Rentman as a project request? Once someone accepts it in Rentman, it links back up with this project.",
      confirmLabel: "Send",
    });
    if (!ok) return;
    setSending(true);
    try {
      await api.sendToRentman(jobId);
      await queryClient.invalidateQueries({ queryKey: ["sync-link", "jobs", jobId] });
      showToast("success", "Sending to Rentman: it goes within a minute");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setSending(false);
    }
  }

  let text = "";
  if (link) {
    const order = typeof link.extra.orderNumber === "string" || typeof link.extra.orderNumber === "number" ? String(link.extra.orderNumber) : "";
    if (link.remoteType === "projectrequests") text = `Sent to Rentman as project request ${link.remoteId}, waiting to be accepted there.`;
    else if (link.provider === "rentman") text = `From Rentman project ${link.remoteId}. Changes made in Rentman come in here; edits here stay in R2.`;
    else text = `From Momentus event ${link.remoteId}.${order ? ` Quotes go to Momentus as order ${order}.` : ""}`;
  }

  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <h2 className="text-sm font-semibold text-gray-500">{link ? `Synced with ${NAME[link.provider]}` : "Rentman"}</h2>
      {link && <p className="text-xs text-gray-600">{text}</p>}
      {link?.syncedAt && <p className="text-xs text-gray-400">Last synced {formatDateTime(link.syncedAt)}</p>}
      {!link && data.sending && <p className="text-xs text-gray-600">Sending to Rentman…</p>}
      {!link && data.canSendToRentman && !data.sending && (
        <button onClick={send} disabled={sending} className="btn-secondary py-1.5 w-fit">
          {sending ? "Sending…" : "Send to Rentman"}
        </button>
      )}
    </section>
  );
}
