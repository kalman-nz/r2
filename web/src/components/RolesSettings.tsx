import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type OrgRole, type PermissionCatalogue } from "../lib/api";
import { useOrg } from "../lib/org";
import { FEATURES } from "../lib/workflow";
import { useRole } from "../lib/roles";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import Field from "./Field";
import Modal from "./Modal";
import RoleBadge from "./RoleBadge";

// Settings → Roles: this organisation's own roles, each a set of
// permissions (pocketbase/pb_hooks/lib/permissions.js). Admin is fixed and
// always has everything. You can only build roles out of permissions your
// own role has — the server refuses anything else.
export default function RolesSettings() {
  const { org } = useOrg();
  const { can, isAdmin } = useRole();
  const orgId = org?.id ?? "";
  const { data: roles = [], isLoading } = useQuery({ queryKey: ["roles"], queryFn: () => api.listRoles(orgId), enabled: !!orgId });
  const { data: catalogue } = useQuery({ queryKey: ["permissions"], queryFn: api.permissions, staleTime: Infinity });
  const [editing, setEditing] = useState<OrgRole | "new" | null>(null);
  const [copyFrom, setCopyFrom] = useState<OrgRole | null>(null);
  const manage = can("roles.manage");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Roles</h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
            What each role can do in {org?.name}. Everyone can look up inventory, projects, contacts and locations; everything else depends on
            their role. Give people roles under Team.
          </p>
        </div>
        {manage && (
          <button
            onClick={() => {
              setCopyFrom(null);
              setEditing("new");
            }}
            className="btn-primary"
          >
            New role
          </button>
        )}
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      <div className="card divide-y divide-gray-100">
        {roles.map((role) => (
          <button
            key={role.id}
            onClick={() => setEditing(role)}
            className="w-full text-left flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{role.name}</span>
                {role.locked && <RoleBadge name="Always everything" locked />}
              </div>
              {role.description && <div className="text-xs text-gray-500 mt-0.5">{role.description}</div>}
            </div>
            <div className="text-xs text-gray-500 shrink-0 text-right">
              <div>
                {role.members ?? 0} {role.members === 1 ? "person" : "people"}
                {role.invitations ? ` · ${role.invitations} invited` : ""}
              </div>
              <div>{role.locked ? "All" : role.permissions.length} permissions</div>
            </div>
          </button>
        ))}
      </div>

      {editing && catalogue && (
        <RoleEditor
          key={editing === "new" ? `new-${copyFrom?.id ?? ""}` : editing.id}
          role={editing === "new" ? null : editing}
          copyFrom={copyFrom}
          catalogue={catalogue}
          mine={{ isAdmin, can }}
          manage={manage}
          onClose={() => setEditing(null)}
          onDuplicate={(role) => {
            setCopyFrom(role);
            setEditing("new");
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({
  role,
  copyFrom,
  catalogue,
  mine,
  manage,
  onClose,
  onDuplicate,
}: {
  role: OrgRole | null;
  copyFrom: OrgRole | null;
  catalogue: PermissionCatalogue;
  mine: { isAdmin: boolean; can: (p: string) => boolean };
  manage: boolean;
  onClose: () => void;
  onDuplicate: (role: OrgRole) => void;
}) {
  const { org, feature } = useOrg();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(role?.name ?? (copyFrom ? `${copyFrom.name} (copy)` : ""));
  const [description, setDescription] = useState(role?.description ?? copyFrom?.description ?? "");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(role?.permissions ?? copyFrom?.permissions ?? []));
  const [saving, setSaving] = useState(false);

  // You can only give out what you have; and changing a role needs
  // everything it has now (the server checks both).
  const grantable = (p: string) => mine.isAdmin || mine.can(p);
  const beyondMe = role ? role.permissions.filter((p) => !grantable(p)) : [];
  const readOnly = !manage || !!role?.locked || beyondMe.length > 0;
  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of catalogue.groups) for (const p of g.permissions) map[p.key] = p.label;
    return map;
  }, [catalogue]);

  // Ticking a permission ticks what it needs; unticking one unticks what
  // needs it.
  function toggle(key: string, on: boolean) {
    const next = new Set(chosen);
    const add = (k: string) => {
      if (next.has(k)) return;
      next.add(k);
      for (const need of catalogue.requires[k] ?? []) add(need);
    };
    const remove = (k: string) => {
      if (!next.delete(k)) return;
      for (const [other, needs] of Object.entries(catalogue.requires)) if (needs.includes(k)) remove(other);
    };
    if (on) add(key);
    else remove(key);
    setChosen(next);
  }

  function toggleGroup(keys: string[], on: boolean) {
    const next = new Set(chosen);
    for (const k of keys.filter(grantable)) {
      if (on) {
        next.add(k);
        for (const need of catalogue.requires[k] ?? []) if (grantable(need)) next.add(need);
      } else next.delete(k);
    }
    if (!on) for (const [other, needs] of Object.entries(catalogue.requires)) if (needs.some((n) => !next.has(n))) next.delete(other);
    setChosen(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { name: name.trim(), description: description.trim(), permissions: [...chosen] };
      if (role) await api.updateRole(org!.id, role.id, data);
      else await api.createRole(org!.id, data);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["roles"] }), queryClient.invalidateQueries({ queryKey: ["me"] })]);
      showToast("success", role ? "Role saved" : `${data.name} created`);
      onClose();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!role) return;
    const ok = await confirm({ title: "Delete role", message: `Delete the ${role.name} role?`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.deleteRole(org!.id, role.id);
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      showToast("success", `${role.name} deleted`);
      onClose();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  const inUse = (role?.members ?? 0) + (role?.invitations ?? 0) > 0;
  const title = role ? (readOnly ? role.name : `Edit ${role.name}`) : "New role";

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={save} className="flex flex-col gap-4">
        {role?.locked && (
          <p className="rounded-md border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-gray-900">
            Admin always has every permission, including ones added to R2 later, and can't be changed. Every organisation keeps at least
            one admin.
          </p>
        )}
        {!role?.locked && beyondMe.length > 0 && manage && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This role can do things yours can't ({beyondMe.slice(0, 3).map((p) => labels[p]?.toLowerCase() ?? p).join(", ")}
            {beyondMe.length > 3 ? "…" : ""}), so only someone with those can change it.
          </p>
        )}
        {!role?.locked && (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name">
              <input required autoFocus={!role} disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)} className="input py-2" placeholder="e.g. Warehouse lead" />
            </Field>
            <Field label="Description">
              <input disabled={readOnly} value={description} onChange={(e) => setDescription(e.target.value)} className="input py-2" placeholder="What it's for" />
            </Field>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          {catalogue.groups.map((group) => {
            const keys = group.permissions.map((p) => p.key);
            const all = keys.every((k) => role?.locked || chosen.has(k));
            return (
              <fieldset key={group.name} className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1">
                  <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{group.name}</legend>
                  {!readOnly && (
                    <button type="button" onClick={() => toggleGroup(keys, !all)} className="text-xs text-signal-ink hover:underline">
                      {all ? "None" : "All"}
                    </button>
                  )}
                </div>
                {group.permissions.map((p) => {
                  const checked = !!role?.locked || chosen.has(p.key);
                  // Kept on the role, but nobody gets it while its feature's off.
                  const off = FEATURES.find((f) => !feature(f.key) && f.permissions.includes(p.key));
                  const mayTick = grantable(p.key) || !!off;
                  return (
                    <label
                      key={p.key}
                      className={`flex items-start gap-2 text-sm ${readOnly || !mayTick ? "text-gray-500" : "text-gray-800 cursor-pointer"}`}
                      title={!readOnly && !mayTick ? "Your own role doesn't have this, so you can't give it" : undefined}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={checked}
                        disabled={readOnly || (!mayTick && !checked)}
                        onChange={(e) => toggle(p.key, e.target.checked)}
                      />
                      <span>
                        {p.label}
                        {off && <span className="text-xs text-gray-400"> · {off.label} is off in Features</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3">
            {role && manage && !role.locked && !readOnly && (
              <button
                type="button"
                onClick={remove}
                disabled={inUse}
                title={inUse ? "Give its people (and invitations) another role first" : undefined}
                className="text-sm text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                Delete role
              </button>
            )}
            {role && manage && (
              <button type="button" onClick={() => onDuplicate(role)} className="text-sm text-gray-600 hover:text-gray-900">
                Duplicate
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
                {saving ? "Saving…" : role ? "Save" : "Create role"}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
