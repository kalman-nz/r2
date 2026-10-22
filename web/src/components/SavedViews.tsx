import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ListView } from "../lib/api";
import { errorText } from "../lib/errors";
import { useOrg } from "../lib/org";
import { byLabel, sameConfig } from "../lib/views";
import { useConfirm } from "./ConfirmProvider";
import ManageViews from "./ManageViews";
import Modal from "./Modal";
import ShareModal from "./ShareModal";
import { useToast } from "./ToastProvider";
import ViewMenu from "./ViewMenu";

// Saved views of a list (list_views): its filters under a name. Everyone
// keeps their own and can share them with people, or (with views.publish)
// with everyone, the same as dashboards and the Inventory's views.
export default function SavedViews({
  page,
  config,
  onApply,
}: {
  page: ListView["page"];
  // The list's filters as they are now, to save.
  config: Record<string, string>;
  onApply: (config: Record<string, string>) => void;
}) {
  const queryClient = useQueryClient();
  const { org } = useOrg();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [activeId, setActiveId] = useState("");
  const [naming, setNaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [sharing, setSharing] = useState<ListView | null>(null);
  const { data: views = [] } = useQuery({ queryKey: ["list-views", page], queryFn: () => api.listViews(page) });
  const active = views.find((v) => v.id === activeId) ?? null;
  const edited = !!active && !sameConfig(active.config, config);

  async function run(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["list-views", page] });
      if (done) showToast("success", done);
      return true;
    } catch (err) {
      showToast("error", errorText(err));
      return false;
    }
  }

  function pick(view: ListView) {
    setActiveId(view.id);
    onApply(view.config);
  }

  async function remove(view: ListView) {
    const ok = await confirm({ title: "Delete view", message: `Delete ${view.name}? Anyone it's shared with loses it too.`, confirmLabel: "Delete", danger: true });
    if (ok && (await run(() => api.deleteView(view.id), `Deleted ${view.name}`)) && view.id === activeId) setActiveId("");
  }

  return (
    <>
      <ViewMenu
        label="Saved views"
        views={views}
        currentId={activeId}
        placeholder="Saved views"
        prefix="View"
        edited={edited}
        note={(v) => byLabel(v)}
        onPick={(v) => v && pick(v)}
        actions={[
          active?.canEdit && edited && { label: `Save changes to ${active.name}`, onClick: () => run(() => api.updateView(active.id, { config }), `Saved ${active.name}`) },
          { label: "Save as a new view…", onClick: () => setNaming(true) },
          views.length > 0 && { label: "Manage views…", onClick: () => setManaging(true) },
        ]}
        align="right"
      />
      {naming && (
        <NameView
          onClose={() => setNaming(false)}
          onSave={(name) =>
            run(async () => {
              const view = await api.createView({ page, name, config });
              setActiveId(view.id);
            }, `Saved ${name}`)
          }
        />
      )}
      {sharing && (
        <ShareModal
          name={sharing.name}
          value={sharing}
          onSave={async (shared) => {
            await api.updateView(sharing.id, shared);
            await queryClient.invalidateQueries({ queryKey: ["list-views", page] });
          }}
          onClose={() => setSharing(null)}
        />
      )}
      {managing && !sharing && (
        <ManageViews
          title="Saved views"
          views={views}
          currentId={activeId}
          orgName={org?.name}
          onPick={(v) => {
            setManaging(false);
            pick(v);
          }}
          onShare={setSharing}
          onRename={(v, name) => run(() => api.updateView(v.id, { name }))}
          actions={(v) => [v.canEdit && { label: "Delete", onClick: () => remove(v), danger: true }]}
          onClose={() => setManaging(false)}
        />
      )}
    </>
  );
}

function NameView({ onSave, onClose }: { onSave: (name: string) => Promise<boolean>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    if (await onSave(trimmed)) onClose();
    else setSaving(false);
  }

  return (
    <Modal title="Save view" onClose={saving ? () => {} : onClose}>
      <p className="text-sm text-gray-500">The filters and search you have now, under a name. It's only yours until you share it.</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        maxLength={60}
        placeholder="e.g. Hire desk, Sound dept"
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
