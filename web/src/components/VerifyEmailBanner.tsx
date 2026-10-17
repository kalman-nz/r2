import { useState } from "react";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";

// Shown until the account's email is verified: invitations can't be accepted
// before then (otherwise anyone could sign up with someone else's address
// and take the seat they were invited to).
export default function VerifyEmailBanner({ email }: { email: string }) {
  const { showToast } = useToast();
  const [sending, setSending] = useState(false);

  async function resend() {
    setSending(true);
    try {
      await pb.collection("users").requestVerification(email);
      showToast("success", `Sent — check ${email} for the link`);
    } catch (err) {
      showToast("error", `Couldn't send it: ${errorText(err)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
      <span className="flex-1 min-w-64">
        Verify your email address to accept invitations. We sent a link to <strong>{email}</strong>.
      </span>
      <button onClick={resend} disabled={sending} className="btn-secondary shrink-0">
        {sending ? "Sending…" : "Send it again"}
      </button>
    </div>
  );
}
