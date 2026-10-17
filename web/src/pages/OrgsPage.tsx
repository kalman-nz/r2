import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Invitation, type Membership } from "../lib/api";
import { useOrg } from "../lib/org";
import { errorText } from "../lib/errors";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import RoleBadge from "../components/RoleBadge";
import VerifyEmailBanner from "../components/VerifyEmailBanner";

// Every organisation you're in, and the ones that have invited you. Where
// people land after signing up, and whenever they aren't in one yet.
export default function OrgsPage() {
  const { me, memberships, invitations, org, switchOrg, refresh, isPlatformAdmin } = useOrg();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const email = me?.user.email ?? "";
  const mustVerify = !!me && me.verificationRequired && !me.user.verified;

  function open(m: Membership) {
    switchOrg(m.org.id);
    navigate("/projects");
  }

  async function accept(invitation: Invitation) {
    setBusy(invitation.id);
    try {
      await api.acceptInvitation(invitation.id);
      await refresh();
      switchOrg(invitation.orgId);
      showToast("success", `You've joined ${invitation.orgName}`);
      navigate("/projects");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function decline(invitation: Invitation) {
    const ok = await confirm({
      title: "Decline invitation",
      message: `Decline the invitation to ${invitation.orgName}? They'd have to invite you again.`,
      confirmLabel: "Decline",
    });
    if (!ok) return;
    setBusy(invitation.id);
    try {
      await api.declineInvitation(invitation.id);
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function leave(m: Membership) {
    const ok = await confirm({
      title: "Leave organisation",
      message: `Leave ${m.org.name}? You'll lose access straight away, until someone invites you again.`,
      confirmLabel: "Leave",
      danger: true,
    });
    if (!ok) return;
    setBusy(m.org.id);
    try {
      await api.leaveOrg(m.org.id);
      await refresh();
      showToast("success", `You've left ${m.org.name}`);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Organisations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Signed in as {email}</p>
      </div>

      {mustVerify && <VerifyEmailBanner email={email} />}

      {invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-gray-500">Invitations</h2>
          <div className="card divide-y divide-gray-100">
            {invitations.map((invitation) => (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{invitation.orgName}</div>
                  <div className="text-xs text-gray-500">
                    {invitation.invitedBy ? `${invitation.invitedBy} invited you` : "You're invited"} with the {invitation.roleName} role
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => decline(invitation)} disabled={busy === invitation.id} className="btn-secondary">
                    Decline
                  </button>
                  <button
                    onClick={() => accept(invitation)}
                    disabled={mustVerify || busy === invitation.id}
                    title={mustVerify ? "Verify your email address first" : undefined}
                    className="btn-primary"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-500">Your organisations</h2>
        {memberships.length === 0 ? (
          <div className="card px-4 py-6 text-sm text-gray-600 flex flex-col gap-2">
            <p>You're not in an organisation yet.</p>
            <p>
              To join one, ask its admin to invite <strong>{email}</strong>. The invitation will show up here.
            </p>
            {isPlatformAdmin && (
              <p>
                As a platform admin you can also{" "}
                <Link to="/admin/orgs" className="text-[#167cfb] hover:underline">
                  create one in the admin panel
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {memberships.map((m) => (
              <div key={m.org.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  onClick={() => open(m)}
                  disabled={m.org.suspended}
                  className="text-left min-w-0 flex-1 disabled:cursor-not-allowed group"
                >
                  <div className="text-sm font-medium text-gray-900 truncate group-enabled:group-hover:text-[#167cfb]">{m.org.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <RoleBadge name={m.role.name} locked={m.role.locked} />
                    {m.org.id === org?.id && <span className="text-xs text-gray-500">Current</span>}
                    {m.org.suspended && <span className="text-xs font-medium text-amber-700">Suspended — contact R2 support</span>}
                  </div>
                </button>
                <button onClick={() => leave(m)} disabled={busy === m.org.id} className="text-sm text-gray-500 hover:text-red-600 shrink-0">
                  Leave
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
