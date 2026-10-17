import type { Invitation, Member, OrgRole } from "../lib/api";
import { formatDate } from "../lib/format";
import RoleBadge from "./RoleBadge";

// An organisation's members and pending invitations, as listed for the
// people who manage its team (Settings → Team) and in the platform admin
// panel.

export function InvitationList({
  invitations,
  roles,
  onCancel,
}: {
  invitations: Invitation[];
  roles: OrgRole[];
  onCancel: (invitation: Invitation) => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-500">Waiting to accept</h3>
      <div className="card divide-y divide-gray-100">
        {invitations.map((invitation) => (
          <div key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="text-gray-900 truncate">{invitation.email}</div>
              <div className="text-xs text-gray-500">
                Invited {invitation.invitedBy ? `by ${invitation.invitedBy} ` : ""}on {formatDate(invitation.created)}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <RoleBadge name={invitation.roleName} locked={roles.find((r) => r.id === invitation.roleId)?.locked} />
              <button onClick={() => onCancel(invitation)} className="text-sm text-gray-500 hover:text-red-600">
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// grantable: the roles you may give people. editable(member) says whether
// you may change that person at all (not yourself; not an admin unless
// you're one) — the server enforces both.
export function MemberList({
  members,
  grantable,
  editable,
  selfId,
  onRole,
  onRemove,
  showVerified = false,
}: {
  members: Member[];
  grantable: OrgRole[];
  editable: (member: Member) => boolean;
  selfId?: string;
  onRole: (member: Member, roleId: string) => void;
  onRemove: (member: Member) => void;
  showVerified?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-gray-500">Members</h3>
      <div className="card divide-y divide-gray-100">
        {members.map((member) => {
          const canEdit = editable(member);
          const who = member.name || member.email;
          const options = grantable.some((r) => r.id === member.roleId)
            ? grantable
            : [{ id: member.roleId, name: member.roleName } as OrgRole, ...grantable];
          return (
            <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">
                  {who}
                  {member.userId === selfId && <span className="text-gray-500 font-normal"> (you)</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {member.email}
                  {showVerified && !member.verified && <span className="text-amber-700"> · not verified</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {canEdit ? (
                  <select
                    value={member.roleId}
                    onChange={(e) => onRole(member, e.target.value)}
                    className="input py-1"
                    aria-label={`Role for ${who}`}
                  >
                    {options.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <RoleBadge name={member.roleName} locked={member.isAdmin} />
                )}
                {canEdit && (
                  <button onClick={() => onRemove(member)} className="text-sm text-gray-500 hover:text-red-600">
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {members.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">Nobody yet.</p>}
      </div>
    </section>
  );
}
