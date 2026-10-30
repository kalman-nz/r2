import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminUser } from "../../lib/api";
import { useAuthRecord } from "../../lib/pocketbase";
import { useOrg } from "../../lib/org";
import { formatDate } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { useToast } from "../../components/ToastProvider";
import { useConfirm } from "../../components/ConfirmProvider";
import Modal from "../../components/Modal";

export default function AdminUsers() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: users = [], isLoading, error } = useQuery({ queryKey: ["admin", "users"], queryFn: adminApi.users });
  const selected = users.find((u) => u.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((u) => [u.name, u.email, ...u.memberships.map((m) => m.orgName)].some((v) => v.toLowerCase().includes(term)));
  }, [users, search]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email or organisation"
        className="input w-full sm:w-80"
      />
      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{errorText(error)}</p>}
      {!isLoading && !error && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 text-left border-b border-gray-200">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Organisations</th>
                <th className="px-3 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u) => (
                <tr key={u.id} onClick={() => setSelectedId(u.id)} className="cursor-pointer hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{u.name || u.email}</span>
                      {u.isPlatformAdmin && <span className="text-xs font-medium text-gray-500">Platform admin</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {u.email}
                      {!u.verified && <span className="text-amber-700"> · not verified</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.memberships.length === 0 ? (
                      <span className="text-gray-400">None</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {u.memberships.map((m) => (
                          <span key={m.orgId} className="text-xs text-gray-700 whitespace-nowrap">
                            {m.orgName} <span className="text-gray-400">· {m.roleName}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{formatDate(u.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">{users.length > 0 ? "Nothing matches." : "No accounts yet."}</p>}
        </div>
      )}
      {selected && <UserModal user={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const me = useAuthRecord();
  const self = user.id === me?.id;
  const queryClient = useQueryClient();
  const { refresh: refreshMe } = useOrg();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(user.name);

  async function update(patch: Parameters<typeof adminApi.updateUser>[1], done: string) {
    try {
      await adminApi.updateUser(user.id, patch);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      if (self) await refreshMe();
      showToast("success", done);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function markVerified() {
    const ok = await confirm({
      title: "Mark email as verified",
      message: `Only if you're sure ${user.email} is really theirs — say they can't get the verification email. Verified addresses can accept invitations.`,
      confirmLabel: "Mark verified",
    });
    if (ok) await update({ verified: true }, "Marked as verified");
  }

  async function togglePlatformAdmin() {
    const granting = !user.isPlatformAdmin;
    const ok = await confirm({
      title: granting ? "Make platform admin" : "Remove platform admin",
      message: granting
        ? `Let ${user.name || user.email} manage every organisation and account on this R2?`
        : `Take away ${user.name || user.email}'s platform admin access? Their organisations are unaffected.`,
      confirmLabel: granting ? "Make platform admin" : "Remove",
      danger: !granting,
    });
    if (ok) await update({ isPlatformAdmin: granting }, granting ? "Now a platform admin" : "No longer a platform admin");
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete account",
      message: `Delete ${user.name || user.email}'s account? They're removed from every organisation and can't sign in. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await adminApi.deleteUser(user.id);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      showToast("success", "Account deleted");
      onClose();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <Modal title={user.name || user.email} onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          update({ name: name.trim() }, "Saved");
        }}
        className="flex flex-col gap-1"
      >
        <label htmlFor="admin-user-name" className="text-sm text-gray-500">
          Name
        </label>
        <div className="flex gap-2">
          <input id="admin-user-name" value={name} onChange={(e) => setName(e.target.value)} className="input py-2 flex-1 min-w-0" />
          <button type="submit" disabled={name.trim() === user.name} className="btn-secondary">
            Save
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Email</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-900">{user.email}</span>
          {user.verified ? (
            <span className="text-xs font-medium text-green-700">Verified</span>
          ) : (
            <>
              <span className="text-xs font-medium text-amber-700">Not verified</span>
              <button onClick={markVerified} className="text-xs text-signal-ink hover:underline">
                Mark as verified
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Organisations</span>
        {user.memberships.length === 0 ? (
          <span className="text-gray-500">None yet</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {user.memberships.map((m) => (
              <li key={m.orgId}>
                <Link to={`/admin/orgs/${m.orgId}`} onClick={onClose} className="text-gray-900 hover:text-signal-ink">
                  {m.orgName}
                </Link>{" "}
                <span className="text-gray-500">· {m.roleName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
        <button
          onClick={togglePlatformAdmin}
          disabled={self}
          title={self ? "Another platform admin has to change your own access" : undefined}
          className="btn-secondary"
        >
          {user.isPlatformAdmin ? "Remove platform admin" : "Make platform admin"}
        </button>
        {!self && (
          <button onClick={remove} className="text-sm text-red-600 hover:text-red-700">
            Delete account
          </button>
        )}
      </div>
    </Modal>
  );
}
