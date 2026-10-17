import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminOrg, type AdminOrgRow, type Invitation, type Member } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { formatDate } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { useToast } from "../../components/ToastProvider";
import { useConfirm } from "../../components/ConfirmProvider";
import Field from "../../components/Field";
import Modal from "../../components/Modal";
import InviteForm, { SignupLinkNotice } from "../../components/InviteForm";
import { InvitationList, MemberList } from "../../components/TeamLists";
import { StatusPill } from "./AdminOrgs";

export default function AdminOrgDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const unsentInvite = (location.state as { unsentInvite?: string } | null)?.unsentInvite;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  // Your own organisations list changes when you change one you're in.
  const { refresh: refreshMe } = useOrg();
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);

  const { data: org, isLoading, error } = useQuery({ queryKey: ["admin", "org", id], queryFn: () => adminApi.org(id) });
  useEffect(() => setName(org?.name ?? ""), [org?.name]);
  const reload = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["admin"] }), refreshMe()]);

  async function act(work: () => Promise<unknown>, done?: string) {
    try {
      await work();
      await reload();
      if (done) showToast("success", done);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !org) return <p className="text-red-600 text-sm">{errorText(error)}</p>;

  async function toggleSuspended() {
    const ok = await confirm(
      org!.suspended
        ? { title: "Lift suspension", message: `Let ${org!.name}'s members back in?`, confirmLabel: "Lift suspension" }
        : {
            title: "Suspend organisation",
            message: `Lock every member of ${org!.name} out until you lift it? Nothing is deleted.`,
            confirmLabel: "Suspend",
            danger: true,
          },
    );
    if (ok) await act(() => adminApi.updateOrg(id, { suspended: !org!.suspended }), org!.suspended ? "Suspension lifted" : "Suspended");
  }

  async function removeMember(member: Member) {
    const ok = await confirm({
      title: "Remove member",
      message: `Remove ${member.name || member.email} from ${org!.name}? Their account stays.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await act(() => adminApi.removeMember(id, member.id));
  }

  const hasAdmin = org.members.some((m) => m.isAdmin);
  const adminRole = org.roles.find((r) => r.locked);

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <Link to="/admin/orgs" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Organisations
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{org.name}</h2>
            <StatusPill suspended={org.suspended} />
          </div>
          <p className="text-xs text-gray-500">Created {formatDate(org.created)}</p>
        </div>
        <button onClick={toggleSuspended} className="btn-secondary">
          {org.suspended ? "Lift suspension" : "Suspend"}
        </button>
      </div>
      {org.suspended && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Suspended: members can't open it and invitations to it can't be accepted. Nothing has been deleted.
        </div>
      )}
      {!hasAdmin && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nobody can manage this organisation yet. Invite an admin{org.invitations.some((i) => i.roleId === adminRole?.id) ? ", or wait for the one you invited to accept" : ""}.
        </div>
      )}

      <section className="card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Invite someone</h3>
        {unsentInvite && <SignupLinkNotice email={unsentInvite} />}
        <InviteForm
          roles={org.roles}
          defaultRoleId={hasAdmin ? undefined : adminRole?.id}
          onInvite={(email, roleId) => adminApi.invite(id, email, roleId).finally(reload)}
        />
      </section>

      <InvitationList
        invitations={org.invitations}
        roles={org.roles}
        onCancel={(invitation: Invitation) => act(() => adminApi.revokeInvitation(id, invitation.id), `Invitation to ${invitation.email} cancelled`)}
      />
      <MemberList
        members={org.members}
        grantable={org.roles}
        editable={() => true}
        showVerified
        onRole={(member: Member, roleId: string) =>
          act(() => adminApi.setRole(id, member.id, roleId), `${member.name || member.email} is now ${org.roles.find((r) => r.id === roleId)?.name}`)
        }
        onRemove={removeMember}
      />

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          act(() => adminApi.updateOrg(id, { name: name.trim() }), "Renamed");
        }}
        className="card p-4 flex flex-col gap-1"
      >
        <label htmlFor="admin-org-name" className="text-sm text-gray-500">
          Name
        </label>
        <div className="flex gap-2">
          <input id="admin-org-name" required value={name} onChange={(e) => setName(e.target.value)} className="input py-2 flex-1 min-w-0" />
          <button type="submit" disabled={!name.trim() || name.trim() === org.name} className="btn-secondary">
            Rename
          </button>
        </div>
      </form>

      <section className="card p-4 flex flex-col gap-2 border-red-200">
        <h3 className="text-sm font-semibold text-red-700">Delete organisation</h3>
        <p className="text-sm text-gray-600">
          Erases {org.name} and everything in it: inventory, jobs, quotes, contacts and settings. People's accounts stay. This can't be
          undone.
        </p>
        <div>
          <button onClick={() => setDeleting(true)} className="btn-danger">
            Delete organisation…
          </button>
        </div>
      </section>
      {deleting && <DeleteOrgModal org={org} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function DeleteOrgModal({ org, onClose }: { org: AdminOrg; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refresh: refreshMe } = useOrg();
  const { showToast } = useToast();
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setWorking(true);
    try {
      await adminApi.deleteOrg(org.id, typed);
      // Off this page before anything asks for the organisation again.
      navigate("/admin/orgs", { replace: true });
      queryClient.removeQueries({ queryKey: ["admin", "org", org.id] });
      queryClient.setQueryData<AdminOrgRow[]>(["admin", "orgs"], (rows) => rows?.filter((r) => r.id !== org.id));
      showToast("success", `${org.name} deleted`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "orgs"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void refreshMe();
    } catch (err) {
      showToast("error", errorText(err));
      setWorking(false);
    }
  }

  return (
    <Modal title={`Delete ${org.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          {org.members.length} {org.members.length === 1 ? "person loses" : "people lose"} access, and everything in the organisation is
          erased for good.
        </p>
        <Field label={`Type ${org.name} to confirm`}>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="input py-2" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={working || typed !== org.name} className="btn-danger">
            {working ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
