import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { FeatureSwitches } from "../../components/FeaturesSettings";
import Breadcrumbs from "../../components/Breadcrumbs";
import { TabBar, useTab, type TabDef } from "../../components/Tabs";
import { useDropdown } from "../../lib/dropdown";

type OrgTab = "people" | "features";

export default function AdminOrgDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const unsentInvite = (location.state as { unsentInvite?: string } | null)?.unsentInvite;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  // Your own organisations list changes when you change one you're in.
  const { org: currentOrg, memberships, switchOrg, refresh: refreshMe } = useOrg();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: org, isLoading, error } = useQuery({ queryKey: ["admin", "org", id], queryFn: () => adminApi.org(id) });
  // The list's counts (items, projects) for the header.
  const { data: rows } = useQuery({ queryKey: ["admin", "orgs"], queryFn: adminApi.orgs });
  const row = rows?.find((r) => r.id === id);
  const tabs: TabDef<OrgTab>[] = [
    { key: "people", label: "People", count: org?.members.length },
    { key: "features", label: "Features" },
  ];
  const [tab, openTab] = useTab(tabs);
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
  // You can only step into organisations you're a member of.
  const canOpen = !org.suspended && memberships.some((m) => m.org.id === id);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const facts = [
    `Created ${formatDate(org.created)}`,
    plural(org.members.length, "member"),
    row && plural(row.items, "item"),
    row && plural(row.jobs, "project"),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Organisations", to: "/admin/orgs" }, { label: org.name }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{org.name}</h2>
          <p className="text-xs text-gray-500">
            {org.suspended && <span className="font-semibold text-amber-700">Suspended · </span>}
            {facts.join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canOpen && (
            <button
              onClick={() => {
                if (currentOrg?.id !== id) switchOrg(id);
                navigate("/");
              }}
              className="btn-secondary"
            >
              Open
            </button>
          )}
          <ManageMenu
            suspended={org.suspended}
            onRename={() => setRenaming(true)}
            onSuspend={toggleSuspended}
            onDelete={() => setDeleting(true)}
          />
        </div>
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

      <TabBar tabs={tabs} current={tab} onOpen={openTab} label="Organisation" />

      {tab === "people" && (
        <div className="flex flex-col gap-5 max-w-3xl">
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
        </div>
      )}

      {tab === "features" && (
        <section className="card p-4 flex flex-col gap-3 max-w-3xl">
          <p className="text-sm text-gray-500">What {org.name} has. Its own admins can't change these.</p>
          <FeatureSwitches orgId={id} orgName={org.name} features={org.features} onChanged={reload} />
        </section>
      )}

      {renaming && (
        <RenameOrgModal
          name={org.name}
          onClose={() => setRenaming(false)}
          onSave={(name) => act(() => adminApi.updateOrg(id, { name }), "Renamed").then(() => setRenaming(false))}
        />
      )}
      {deleting && <DeleteOrgModal org={org} onClose={() => setDeleting(false)} />}
    </div>
  );
}

// Rare, organisation-wide actions, kept out of the way.
function ManageMenu({ suspended, onRename, onSuspend, onDelete }: { suspended: boolean; onRename: () => void; onSuspend: () => void; onDelete: () => void }) {
  const { open, setOpen, ref } = useDropdown();
  const item = "w-full text-left px-3 py-2 hover:bg-gray-50";
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary flex items-center gap-1.5" aria-haspopup="menu" aria-expanded={open}>
        Manage
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-gray-400" aria-hidden>
          <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-56 max-w-[calc(100vw-1.5rem)] card shadow-lg py-1 z-40 text-sm text-gray-700">
          <button role="menuitem" onClick={pick(onRename)} className={item}>
            Rename…
          </button>
          <button role="menuitem" onClick={pick(onSuspend)} className={item}>
            {suspended ? "Lift suspension" : "Suspend…"}
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button role="menuitem" onClick={pick(onDelete)} className={`${item} text-red-700`}>
            Delete organisation…
          </button>
        </div>
      )}
    </div>
  );
}

function RenameOrgModal({ name: current, onClose, onSave }: { name: string; onClose: () => void; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  return (
    <Modal title="Rename organisation" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setSaving(true);
          void onSave(trimmed).finally(() => setSaving(false));
        }}
        className="flex flex-col gap-3"
      >
        <Field label="Name">
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className="input py-2" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving || !trimmed || trimmed === current} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
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
