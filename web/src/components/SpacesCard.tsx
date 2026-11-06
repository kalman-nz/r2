import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import { withOrg } from "../lib/currentOrg";
import { useVenueSpaces } from "../lib/catalog";
import { DetailCard } from "./DetailCard";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

// While editing: existing spaces keep their id, new ones have none yet.
type Draft = { key: string; id?: string; name: string };

// A location's spaces (Addison Theatre, Terrace Room...). Edit to rename,
// add, remove and drag them into order, then Save.
export default function SpacesCard({ venueId, canEdit }: { venueId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: all = [] } = useVenueSpaces();
  const spaces = all.filter((s) => s.venue === venueId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [newName, setNewName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  // Only the handle starts a drag, so the name boxes still select text.
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!canEdit && spaces.length === 0) return null;

  function startEditing() {
    setDraft(spaces.map((s) => ({ key: s.id, id: s.id, name: s.name })));
    setNewName("");
    setEditing(true);
  }

  function addToDraft() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setDraft((d) => [...d, { key: `new-${Date.now()}`, name: trimmed }]);
    setNewName("");
  }

  // Moves the dragged row to where the pointer is, as it goes.
  function dragOver(overKey: string) {
    if (!dragging || dragging === overKey) return;
    setDraft((d) => {
      const from = d.findIndex((r) => r.key === dragging);
      const to = d.findIndex((r) => r.key === overKey);
      if (from < 0 || to < 0) return d;
      const next = [...d];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function save() {
    const rows = draft.map((r) => ({ ...r, name: r.name.trim() })).filter((r) => r.name);
    if (newName.trim()) rows.push({ key: "new", name: newName.trim() });
    const kept = new Set(rows.map((r) => r.id).filter(Boolean));
    const removed = spaces.filter((s) => !kept.has(s.id));
    if (removed.length > 0) {
      const names = removed.map((s) => s.name).join(", ");
      const ok = await confirm({
        title: removed.length === 1 ? "Remove space" : "Remove spaces",
        message: `Remove ${names}? ${removed.length === 1 ? "It comes" : "They come"} off any projects and schedule items that use ${removed.length === 1 ? "it" : "them"}.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const col = pb.collection("venue_spaces");
      await Promise.all(removed.map((s) => col.delete(s.id)));
      await Promise.all(
        rows.map((r, i) => {
          const sortOrder = (i + 1) * 10;
          if (!r.id) return col.create(withOrg({ venue: venueId, name: r.name, sortOrder }));
          const was = spaces.find((s) => s.id === r.id);
          if (was && was.name === r.name && was.sortOrder === sortOrder) return null;
          return col.update(r.id, { name: r.name, sortOrder });
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["venue_spaces"] });
      await queryClient.invalidateQueries({ queryKey: ["job-summary"] });
      setEditing(false);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
      await queryClient.invalidateQueries({ queryKey: ["venue_spaces"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailCard
      title={spaces.length > 0 && !editing ? `Spaces · ${spaces.length}` : "Spaces"}
      editing={editing}
      canEdit={canEdit && !editing}
      saving={saving}
      onEdit={startEditing}
      onCancel={() => setEditing(false)}
      onSave={save}
    >
      {!editing ? (
        spaces.length > 0 ? (
          <div className="flex flex-col divide-y divide-gray-100 -mx-4">
            {spaces.map((s) => (
              <div key={s.id} className="px-4 py-2 text-sm text-gray-900">
                {s.name}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-2 text-sm text-gray-400">—</div>
        )
      ) : (
        <div className="flex flex-col gap-2 py-2">
          {draft.length > 0 && (
            <div className="flex flex-col divide-y divide-gray-100 -mx-4">
              {draft.map((r) => (
                <div
                  key={r.key}
                  draggable={grabbed === r.key}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(r.key);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    dragOver(r.key);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setGrabbed(null);
                  }}
                  onDrop={(e) => e.preventDefault()}
                  className={`flex items-center gap-2 px-4 py-1.5 text-sm bg-white ${dragging === r.key ? "opacity-40" : ""}`}
                >
                  <span
                    aria-hidden
                    onMouseDown={() => setGrabbed(r.key)}
                    onMouseUp={() => setGrabbed(null)}
                    className="cursor-grab active:cursor-grabbing select-none text-gray-400 hover:text-gray-700 px-1">
                    ⋮⋮
                  </span>
                  <input
                    value={r.name}
                    onChange={(e) => setDraft((d) => d.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                    maxLength={200}
                    className="input py-1 flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => setDraft((d) => d.filter((x) => x.key !== r.key))}
                    className="text-xs text-gray-500 hover:text-fault-ink px-1.5 py-1 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addToDraft();
                }
              }}
              placeholder="e.g. Terrace Room"
              maxLength={200}
              className="input py-1.5 flex-1 min-w-0"
            />
            <button type="button" onClick={addToDraft} disabled={!newName.trim()} className="btn-secondary">
              Add space
            </button>
          </div>
        </div>
      )}
    </DetailCard>
  );
}
