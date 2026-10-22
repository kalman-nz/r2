import { useState } from "react";
import { api, type Dashboard } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { PANEL_BY_ID, PANELS, panelAllowed, type PanelId } from "../../lib/home";
import { useOrg } from "../../lib/org";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";

// Designing a dashboard: its name, and which panels it shows in what order.
// A new one (no dashboard) starts from `start` — a copy of another, say.
export default function DashboardEditor({
  dashboard,
  start,
  onClose,
  onSaved,
}: {
  dashboard?: Dashboard;
  start?: { name: string; panels: PanelId[] };
  onClose: () => void;
  onSaved: (dashboard: Dashboard) => void;
}) {
  const { can, feature } = useOrg();
  const { showToast } = useToast();
  const [name, setName] = useState(dashboard?.name ?? start?.name ?? "");
  const [panels, setPanels] = useState<PanelId[]>(
    (dashboard?.panels.map((p) => p.id) ?? start?.panels ?? []).filter((id): id is PanelId => PANEL_BY_ID.has(id as PanelId)),
  );
  const [saving, setSaving] = useState(false);
  const left = PANELS.filter((p) => !panels.includes(p.id));

  const move = (i: number, by: number) =>
    setPanels((prev) => {
      const next = [...prev];
      const [p] = next.splice(i, 1);
      next.splice(i + by, 0, p);
      return next;
    });

  async function save() {
    setSaving(true);
    try {
      const body = { name: name.trim(), panels: panels.map((id) => ({ id })) };
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
    return panelAllowed(p, can, feature) ? "" : p.feature && !feature(p.feature) ? "Turned off in Features" : "Your role can't see it";
  };

  return (
    <Modal title={dashboard ? "Edit dashboard" : "New dashboard"} onClose={saving ? () => {} : onClose} wide>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Workshop, My week, Sales" className="input py-1.5" />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-gray-500">Shows, in this order</span>
        {panels.length === 0 && <p className="text-xs text-gray-400">Nothing yet: add panels from the list below.</p>}
        {panels.map((id, i) => {
          const p = PANEL_BY_ID.get(id)!;
          return (
            <div key={id} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2">
              <span className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs" aria-label={`Move ${p.label} up`}>
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === panels.length - 1}
                  className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs"
                  aria-label={`Move ${p.label} down`}
                >
                  ▼
                </button>
              </span>
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
