import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Invitation, type Member } from "../lib/api";
import { useOrg } from "../lib/org";
import { useAuthRecord } from "../lib/pocketbase";
import { mayGrant, useRole } from "../lib/roles";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import InviteForm from "./InviteForm";
import { InvitationList, MemberList } from "./TeamLists";

// Settings → Team (team.manage): who's in this organisation, their roles,
// and invitations. You can only hand out roles your own role covers. People join by signing up with the invited address and
// accepting on their Organisations page.
export default function MembersSettings() {
  const { org, refresh } = useOrg();
  const me = useAuthRecord();
  const { can, isAdmin } = useRole();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const orgId = org?.id ?? "";
  const [name, setName] = useState(org?.name ?? "");
  const [renaming, setRenaming] = useState(false);

  const { data: members = [], isLoading } = useQuery({ queryKey: ["members"], queryFn: () => api.listMembers(orgId), enabled: !!orgId });
  const { data: invitations = [] } = useQuery({ queryKey: ["invitations"], queryFn: () => api.listInvitations(orgId), enabled: !!orgId });
  const { data: roles = [] } = useQuery({ queryKey: ["roles"], queryFn: () => api.listRoles(orgId), enabled: !!orgId });
  const grantable = roles.filter((r) => mayGrant(r, { isAdmin, can }));
  const editable = (m: Member) => m.userId !== me?.id && (isAdmin || !m.isAdmin);
  const reload = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ["members"] }), queryClient.invalidateQueries({ queryKey: ["invitations"] })]);

  async function changeRole(member: Member, roleId: string) {
    try {
      await api.setMemberRole(orgId, member.id, roleId);
      await reload();
      showToast("success", `${member.name || member.email} is now ${roles.find((r) => r.id === roleId)?.name ?? "changed"}`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function remove(member: Member) {
    const ok = await confirm({
      title: "Remove from team",
      message: `Remove ${member.name || member.email} from ${org?.name}? They lose access straight away. Their account stays, and so does anything they did here.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeMember(orgId, member.id);
      await reload();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function cancelInvitation(invitation: Invitation) {
    try {
      await api.revokeInvitation(orgId, invitation.id);
      await reload();
      showToast("success", `Invitation to ${invitation.email} cancelled`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    setRenaming(true);
    try {
      await api.renameOrg(orgId, name.trim());
      await refresh();
      showToast("success", "Renamed");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Invite someone</h3>
        <InviteForm
          roles={grantable}
          onInvite={async (email, role) => {
            const result = await api.invite(orgId, email, role);
            await reload();
            return result;
          }}
        />
      </section>

      <InvitationList invitations={invitations} roles={roles} onCancel={cancelInvitation} />
      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : (
        <MemberList members={members} grantable={grantable} editable={editable} selfId={me?.id} onRole={changeRole} onRemove={remove} />
      )}

      {can("settings.edit") && (
        <form onSubmit={rename} className="card p-4 flex flex-col gap-1">
          <label htmlFor="org-name" className="text-sm text-gray-500">
            Organisation name
          </label>
          <div className="flex gap-2">
            <input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} className="input py-2 flex-1 min-w-0" />
            <button type="submit" disabled={renaming || !name.trim() || name.trim() === org?.name} className="btn-secondary">
              Rename
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
