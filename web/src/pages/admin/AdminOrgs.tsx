import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { useToast } from "../../components/ToastProvider";
import Field from "../../components/Field";
import Modal from "../../components/Modal";

export function StatusPill({ suspended }: { suspended: boolean }) {
  return suspended ? (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Suspended</span>
  ) : (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">Active</span>
  );
}

export default function AdminOrgs() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data: orgs = [], isLoading, error } = useQuery({ queryKey: ["admin", "orgs"], queryFn: adminApi.orgs });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? orgs.filter((o) => o.name.toLowerCase().includes(term)) : orgs;
  }, [orgs, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search organisations"
          className="input w-full sm:w-64"
        />
        <button onClick={() => setCreating(true)} className="btn-primary">
          New organisation
        </button>
      </div>
      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">{errorText(error)}</p>}
      {!isLoading && !error && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 text-left border-b border-gray-200">
                <th className="px-4 py-2 font-medium">Organisation</th>
                <th className="px-3 py-2 font-medium text-right">Members</th>
                <th className="px-3 py-2 font-medium text-right">Items</th>
                <th className="px-3 py-2 font-medium text-right">Projects</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} onClick={() => navigate(`/admin/orgs/${o.id}`)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link to={`/admin/orgs/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-900 hover:text-signal-ink">
                      {o.name}
                    </Link>
                    {o.admins === 0 && (
                      <div className="text-xs text-amber-700">{o.pendingInvitations > 0 ? "Invited, nobody's joined yet" : "No admin"}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {o.members}
                    {o.pendingInvitations > 0 && <span className="text-gray-400" title="Invitations waiting"> +{o.pendingInvitations}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.items}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.jobs}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{formatDate(o.created)}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill suspended={o.suspended} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">{orgs.length > 0 ? "Nothing matches." : "No organisations yet."}</p>
          )}
        </div>
      )}
      {creating && <CreateOrgModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await adminApi.createOrg(name.trim(), adminEmail.trim());
      // Its first admin might be you: pick up that invitation.
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      showToast("success", created.emailed && created.invitation ? `Created — invitation emailed to ${created.invitation.email}` : `Created ${created.name}`);
      navigate(`/admin/orgs/${created.id}`, {
        state: created.invitation && !created.emailed ? { unsentInvite: created.invitation.email } : undefined,
      });
    } catch (err) {
      showToast("error", errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal title="New organisation" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbour AV Hire" className="input py-2" />
        </Field>
        <Field label="First admin's email" hint="They're invited to sign up and run it. You can invite more people afterwards.">
          <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="input py-2" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
