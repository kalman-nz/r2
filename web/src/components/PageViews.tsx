import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ListView, type PageViewsData, type ViewConfig, type ViewPage } from "../lib/api";
import { errorText } from "../lib/errors";
import { useOrg } from "../lib/org";
import { byLabel, sameSettings, viewSettings } from "../lib/views";
import { useConfirm } from "./ConfirmProvider";
import ManageViews from "./ManageViews";
import Modal from "./Modal";
import ShareModal from "./ShareModal";
import { useToast } from "./ToastProvider";
import ViewMenu from "./ViewMenu";

type Naming = { title: string; name: string; settings: ViewConfig };

// A list page's saved views, the way dashboards work: one dropdown to pick
// a view (yours, shared with you, everyone's, or the page as it comes) with
// edit, save, new, copy, share and manage at its foot. A view keeps the
// page's filters and column settings (the page says which: `settings`,
// with `defaults` for the page as it comes). Your pick per page is kept on
// your account; people who can publish set the organisation's default.
export default function PageViews({
  page,
  settings,
  defaults,
  onApply,
  applyOnLoad = true,
}: {
  page: ViewPage;
  // The page's filters and columns as they are now.
  settings: ViewConfig;
  defaults: ViewConfig;
  onApply: (settings: ViewConfig) => void;
  // Put the picked view on the page when it opens (not when the page opened
  // with its own filters, from a link).
  applyOnLoad?: boolean;
}) {
  const queryClient = useQueryClient();
  const { can } = useOrg();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const key = ["list-views", page];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.listViews(page) });
  const views = data?.views ?? [];
  const currentId = !data || data.pick === "standard" ? "" : data.pick || data.defaultId;
  const current = views.find((v) => v.id === currentId) ?? null;
  const edited = !!current && !sameSettings(viewSettings(defaults, current.config), settings);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [editing, setEditing] = useState<ListView | null>(null);
  const [sharing, setSharing] = useState<ListView | null>(null);
  const [managing, setManaging] = useState(false);

  // The picked view goes on the page once, when it opens.
  const applied = useRef(false);
  const onApplyRef = useRef(onApply);
  useEffect(() => {
    onApplyRef.current = onApply;
  });
  useEffect(() => {
    if (applied.current || !data) return;
    applied.current = true;
    if (applyOnLoad && current) onApplyRef.current(viewSettings(defaults, current.config));
  }, [data, current, defaults, applyOnLoad]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  async function run(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    try {
      await action();
      await refresh();
      if (done) showToast("success", done);
      return true;
    } catch (err) {
      showToast("error", errorText(err));
      return false;
    }
  }

  // Picking is remembered (the page as it comes is "standard").
  async function pick(view: ListView | null) {
    onApply(view ? viewSettings(defaults, view.config) : defaults);
    const value = view ? view.id : "standard";
    queryClient.setQueryData<PageViewsData>(key, (prev) => (prev ? { ...prev, pick: value } : prev));
    try {
      await api.setPageView(page, value);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function remove(view: ListView) {
    const ok = await confirm({ title: "Delete view", message: `Delete ${view.name}? Anyone it's shared with loses it too.`, confirmLabel: "Delete", danger: true });
    if (ok) await run(() => api.deleteView(view.id), `Deleted ${view.name}`);
  }

  const copy = (view: ListView) => setNaming({ title: "Copy view", name: `${view.name} (mine)`, settings: viewSettings(defaults, view.config) });

  return (
    <>
      <ViewMenu
        label="View"
        views={views}
        currentId={currentId}
        placeholder="Standard"
        none="Standard"
        edited={edited}
        note={(v) => (v.isDefault ? "Default" : byLabel(v))}
        onPick={pick}
        actions={[
          current?.canEdit && { label: "Edit view…", onClick: () => setEditing(current) },
          current?.canEdit && edited && { label: `Save changes to ${current.name}`, onClick: () => run(() => api.updateView(current.id, { config: settings }), `Saved ${current.name}`) },
          { label: "New view…", onClick: () => setNaming({ title: "New view", name: "", settings }) },
          current && { label: "Copy this view…", onClick: () => copy(current) },
          current?.isOwner && { label: "Share…", onClick: () => setSharing(current) },
          views.length > 0 && { label: "Manage views…", onClick: () => setManaging(true) },
        ]}
      />
      {naming && (
        <NameView
          title={naming.title}
          initial={naming.name}
          onClose={() => setNaming(null)}
          onSave={(name) =>
            run(async () => {
              const view = await api.createView({ page, name, config: naming.settings });
              await api.setPageView(page, view.id);
              onApply(viewSettings(defaults, view.config));
            }, `Saved ${name}`)
          }
        />
      )}
      {editing && (
        <EditView
          view={editing}
          edited={editing.id === currentId && edited}
          onClose={() => setEditing(null)}
          onSave={(name, update) => run(() => api.updateView(editing.id, { name, ...(update ? { config: settings } : {}) }), `Saved ${name}`)}
        />
      )}
      {sharing && (
        <ShareModal
          name={sharing.name}
          value={sharing}
          onSave={async (shared) => {
            await api.updateView(sharing.id, shared);
            await refresh();
          }}
          onClose={() => setSharing(null)}
        />
      )}
      {/* Out of the way while sharing or naming one, back after. */}
      {managing && !sharing && !naming && (
        <ManageViews
          title="Views"
          views={views}
          currentId={currentId}
          note={(v) => (v.isDefault ? "everyone's view of this page until they pick their own" : "")}
          onPick={(v) => {
            setManaging(false);
            pick(v);
          }}
          onShare={setSharing}
          onRename={(v, name) => run(() => api.updateView(v.id, { name }))}
          actions={(v) => [
            { label: "Copy", onClick: () => copy(v) },
            can("views.publish") && v.public && !v.isDefault && { label: "Make default", onClick: () => run(() => api.updateView(v.id, { isDefault: true }), `${v.name} is the default now`) },
            v.canEdit && !v.isDefault && { label: "Delete", onClick: () => remove(v), danger: true },
          ]}
          onClose={() => setManaging(false)}
        >
          <button onClick={() => setNaming({ title: "New view", name: "", settings })} className="btn-secondary self-start">
            New view
          </button>
        </ManageViews>
      )}
    </>
  );
}

function NameView({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    if (await onSave(trimmed)) onClose();
    else setSaving(false);
  }

  return (
    <Modal title={title} onClose={saving ? () => {} : onClose}>
      <p className="text-sm text-gray-500">Keeps the filters and columns under a name, and switches to it. It's only yours until you share it.</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        maxLength={60}
        placeholder="e.g. Hire desk, Audio, Overdue"
        className="input"
      />
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !name.trim()} className="btn-primary">
          {saving ? "Saving…" : "Save view"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// Renaming a view, and (when the page has changed since it was picked)
// keeping what's on screen in it.
function EditView({ view, edited, onSave, onClose }: { view: ListView; edited: boolean; onSave: (name: string, update: boolean) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState(view.name);
  const [update, setUpdate] = useState(edited);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    if (await onSave(trimmed, update)) onClose();
    else setSaving(false);
  }

  return (
    <Modal title="Edit view" onClose={saving ? () => {} : onClose}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} maxLength={60} className="input" />
      </label>
      {edited ? (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
          Keep the filters and columns on screen now in it
        </label>
      ) : (
        <p className="text-xs text-gray-500">To change its filters or columns, change them on the page, then save the changes from this menu.</p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !name.trim()} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
