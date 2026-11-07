import { useState } from "react";
import { api, type Dashboard } from "../../lib/api";
import { errorText } from "../../lib/errors";
import {
  DEFAULT_SHORTCUTS,
  PANEL_BY_ID,
  PANELS,
  panelAllowed,
  SHORTCUT_BY_ID,
  SHORTCUTS,
  shortcutAllowed,
  shortcutIncluded,
  type PanelId,
  type ShortcutId,
} from "../../lib/home";
import { useOrg } from "../../lib/org";
import { DragHandle, moveItem, useDragReorder } from "../DragReorder";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

// Designing a dashboard: its name, which panels it shows in what order, and
// its shortcut buttons.
// A new one (no dashboard) starts from `start` — a copy of another, say.
export default function DashboardEditor({
  dashboard,
  start,
  onClose,
  onSaved,
}: {
  dashboard?: Dashboard;
  start?: { name: string; panels: PanelId[]; shortcuts?: ShortcutId[] };
  onClose: () => void;
  onSaved: (dashboard: Dashboard) => void;
}) {
  const { can, feature } = useOrg();
  const { showToast } = useToast();
  const [name, setName] = useState(dashboard?.name ?? start?.name ?? "");
  const [panels, setPanels] = useState<PanelId[]>(
    (dashboard?.panels.map((p) => p.id) ?? start?.panels ?? []).filter((id): id is PanelId => PANEL_BY_ID.has(id as PanelId)),
  );
  const [shortcuts, setShortcuts] = useState<ShortcutId[]>(
    ((dashboard ? (dashboard.shortcuts ?? DEFAULT_SHORTCUTS) : (start?.shortcuts ?? DEFAULT_SHORTCUTS)) as ShortcutId[]).filter((id) => SHORTCUT_BY_ID.has(id)),
  );
  const [saving, setSaving] = useState(false);
  // Dragging works on what's shown; panels and buttons for features the
  // organisation hasn't got stay on the end.
  const panelsShown = panels.filter((id) => {
    const f = PANEL_BY_ID.get(id)?.feature;
    return !f || feature(f);
  });
  const panelDrag = useDragReorder({
    count: panelsShown.length,
    handle: false,
    gap: 6,
    onMove: (from, to) => setPanels((prev) => [...moveItem(panelsShown, from, to), ...prev.filter((id) => !panelsShown.includes(id))]),
  });
  // Panels for what the organisation hasn't got don't show at all (they're
  // kept on the dashboard for when it has).
  const included = (id: PanelId) => {
    const f = PANEL_BY_ID.get(id)?.feature;
    return !f || feature(f);
  };
  const left = PANELS.filter((p) => !panels.includes(p.id) && included(p.id));


  async function save() {
    setSaving(true);
    try {
      const body = { name: name.trim(), panels: panels.map((id) => ({ id })), shortcuts };
      onSaved(dashboard ? await api.updateDashboard(dashboard.id, body) : await api.createDashboard(body));
    } catch (err) {
      showToast("error", `Couldn't save it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // Panels someone can't use don't show for them; say so for the ones you can't.
  const note = (id: PanelId) => {
    const p = PANEL_BY_ID.get(id)!;
    return panelAllowed(p, can, feature) ? "" : "Your role can't see it";
  };

  // Shortcuts for what the organisation hasn't got are kept but not shown.
  const shortcutsShown = shortcuts.filter((id) => shortcutIncluded(SHORTCUT_BY_ID.get(id)!, feature));
  const shortcutDrag = useDragReorder({
    count: shortcutsShown.length,
    axis: "x",
    handle: false,
    gap: 6,
    onMove: (from, to) => setShortcuts((prev) => [...moveItem(shortcutsShown, from, to), ...prev.filter((id) => !shortcutsShown.includes(id))]),
  });
  const shortcutsLeft = SHORTCUTS.filter((sc) => !shortcuts.includes(sc.id) && shortcutIncluded(sc, feature));

  return (
    <Modal title={dashboard ? "Edit dashboard" : "New dashboard"} onClose={saving ? () => {} : onClose} wide>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Workshop, My week, Sales" className="input py-1.5" />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-gray-500">Shows, in this order</span>
        {panels.length === 0 && <p className="text-xs text-gray-400">Nothing yet: add panels from the list below.</p>}
        {panelsShown.map((id, i) => {
          const p = PANEL_BY_ID.get(id)!;
          return (
            <div
              key={id}
              {...panelDrag.item(i)}
              style={panelDrag.style}
              className={`flex items-center gap-2 rounded-md border border-gray-200 bg-white pl-1.5 pr-3 py-2 cursor-grab active:cursor-grabbing ${panelDrag.cls(i)}`}
            >
              <DragHandle />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-900">{p.label}</span>
                <span className="block text-xs text-gray-500">
                  {p.hint}
                  {note(id) && <span className="text-amber-700"> · {note(id)}</span>}
                </span>
              </span>
              <button onClick={() => setPanels((prev) => prev.filter((x) => x !== id))} className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100" aria-label={`Remove ${p.label}`}>
                ×
              </button>
            </div>
          );
        })}
      </div>

      {left.length > 0 && (
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-gray-500">Add a panel</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {left.map((p) => (
              <button key={p.id} onClick={() => setPanels((prev) => [...prev, p.id])} className="text-left rounded-md border border-dashed border-gray-300 px-3 py-2 hover:border-gray-400 hover:bg-gray-50">
                <span className="block font-medium text-gray-900">
                  <span className="text-signal-ink mr-1">+</span>
                  {p.label}
                </span>
                <span className="block text-xs text-gray-500">
                  {p.hint}
                  {note(p.id) && <span className="text-amber-700"> · {note(p.id)}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-gray-500">Shortcut buttons</span>
        {shortcutsShown.length === 0 && <p className="text-xs text-gray-400">None.</p>}
        {shortcutsShown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shortcutsShown.map((id, i) => {
              const sc = SHORTCUT_BY_ID.get(id)!;
              const off = !shortcutAllowed(sc, can, feature);
              return (
                <span
                  key={id}
                  {...shortcutDrag.item(i)}
                  style={shortcutDrag.style}
                  className={`inline-flex items-center gap-1 h-8 rounded-md border pl-1.5 pr-1 cursor-grab active:cursor-grabbing ${
                    i === shortcutsShown.length - 1 ? "border-carbon bg-carbon text-white" : "border-gray-300 bg-white text-gray-700"
                  } ${shortcutDrag.cls(i)}`}
                  title={off ? "Your role can't use it" : undefined}
                >
                  <DragHandle className="w-4 text-current opacity-50 hover:text-current" />
                  <span className={`font-medium ${off ? "opacity-60" : ""}`}>{sc.label}</span>
                  <button onClick={() => setShortcuts((prev) => prev.filter((x) => x !== id))} className="w-5 h-6 rounded opacity-60 hover:opacity-100" aria-label={`Remove ${sc.label}`}>
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {shortcutsLeft.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shortcutsLeft.map((sc) => (
              <button
                key={sc.id}
                onClick={() => setShortcuts((prev) => [...prev, sc.id])}
                className="h-8 px-2.5 rounded-md border border-dashed border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              >
                <span className="text-signal-ink mr-1">+</span>
                {sc.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !name.trim()} className="btn-primary">
          {saving ? "Saving…" : dashboard ? "Save" : "Create dashboard"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
