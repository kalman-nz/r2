import { useState, type FormEvent } from "react";
import type { InviteResult, OrgRole } from "../lib/api";
import { smallestRole } from "../lib/roles";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";
import { useOrg } from "../lib/org";
import Field from "./Field";

// Invite someone to an organisation by email (Settings → Team, and the
// platform admin panel). Without mail set up on the server nothing is sent,
// so show the sign-up link to pass on instead.
// roles: the ones the inviter may hand out (lib/roles.ts mayGrant).
export default function InviteForm({
  roles,
  onInvite,
  defaultRoleId,
}: {
  roles: OrgRole[];
  onInvite: (email: string, roleId: string) => Promise<InviteResult>;
  defaultRoleId?: string;
}) {
  const { showToast } = useToast();
  const { refresh: refreshMe } = useOrg();
  const [email, setEmail] = useState("");
  const [chosen, setChosen] = useState("");
  const roleId = chosen || defaultRoleId || smallestRole(roles)?.id || "";
  const role = roles.find((r) => r.id === roleId);
  const [sending, setSending] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setUnsent(null);
    try {
      const result = await onInvite(email.trim(), roleId);
      // You might have invited yourself.
      void refreshMe();
      if (result.emailed) showToast("success", `Invitation emailed to ${result.invitation.email}`);
      else setUnsent(result.invitation.email);
      setEmail("");
    } catch (err) {
      showToast("error", `Couldn't invite: ${errorText(err)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label="Email" className="flex-1 min-w-48">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="input py-2" />
        </Field>
        <Field label="Role">
          <select value={roleId} onChange={(e) => setChosen(e.target.value)} className="input py-2">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" disabled={sending || !roleId} className="btn-primary py-2">
          {sending ? "Inviting…" : "Invite"}
        </button>
      </form>
      {role?.description && (
        <p className="text-xs text-gray-500">
          {role.name}: {role.description}
        </p>
      )}
      {unsent && <SignupLinkNotice email={unsent} />}
    </div>
  );
}

// When an invitation couldn't be emailed: the link to pass on instead.
export function SignupLinkNotice({ email }: { email: string }) {
  const { showToast } = useToast();
  const link = `${window.location.origin}/signup?email=${encodeURIComponent(email)}`;
  function copy() {
    navigator.clipboard?.writeText(link).then(
      () => showToast("success", "Link copied"),
      () => showToast("error", "Couldn't copy — select the link instead"),
    );
  }
  return (
    <div className="rounded-md border border-signal/30 bg-signal-soft px-3 py-2.5 text-sm text-gray-900 flex flex-col gap-2">
      <span>
        Invitation saved for <strong>{email}</strong>, but this server can't send email yet. Send them this link to sign up and
        accept it:
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="flex-1 min-w-0 truncate bg-white border border-signal/30 rounded px-2 py-1 text-xs">{link}</code>
        <button type="button" onClick={copy} className="btn-secondary shrink-0">
          Copy
        </button>
      </div>
    </div>
  );
}
