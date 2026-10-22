import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type IntervalUnit, type Item, type MaintenanceKind, type MaintenancePlan } from "../../lib/api";
import { displayPath, useCategories, useCategoryPaths } from "../../lib/catalog";
import { orgFilter } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { today } from "../../lib/maintenance";
import { INTERVAL_UNITS, MAINTENANCE_KINDS } from "../../lib/statuses";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import Segmented from "../Segmented";
import { useToast } from "../ToastProvider";

const SHOWN = 60;

// Setting up (or changing) repeating maintenance: what it is, how often,
// and which items it covers — one by one, or a whole folder at once. Every
// unit of those items gets its own job, first due on the first due date.
export default function PlanModal({ plan, onClose, onSaved }: { plan?: MaintenancePlan; onClose: () => void; onSaved: (plan: MaintenancePlan) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState(plan?.name ?? "");
  const [kind, setKind] = useState<MaintenanceKind>(plan?.kind ?? "inspection");
  const [every, setEvery] = useState(plan?.every ?? 12);
  const [unit, setUnit] = useState<IntervalUnit>(plan?.unit ?? "month");
  const [firstDue, setFirstDue] = useState(plan ? plan.firstDue : today());
  const [instructions, setInstructions] = useState(plan?.instructions ?? "");
  const [picked, setPicked] = useState<string[]>(plan?.items ?? []);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();

  const { data: items = [] } = useQuery({
    queryKey: ["items", "physical"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter("kind = 'item' && archived = false"), sort: "name" }),
  });
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return items
      .filter((i) => !picked.includes(i.id) && [i.name, i.code, i.barcode, paths.get(i.category)].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)))
      .slice(0, SHOWN);
  }, [items, search, picked, paths]);

  // Everything in a folder and the folders under it.
  function addFolder(id: string) {
    const path = paths.get(id);
    if (!path) return;
    const inside = items.filter((i) => {
      const p = paths.get(i.category) ?? "";
      return p === path || p.startsWith(path + "/");
    });
    setPicked((prev) => [...prev, ...inside.map((i) => i.id).filter((i) => !prev.includes(i))]);
    showToast("success", inside.length === 0 ? "Nothing in that folder" : `Added ${inside.length} item${inside.length === 1 ? "" : "s"} from ${displayPath(path)}`);
  }

  async function save() {
    setSaving(true);
    try {
      const body = { name: name.trim(), kind, every, unit, items: picked, firstDue, instructions };
      const saved = plan ? await api.updatePlan(plan.id, body) : await api.createPlan(body);
      onSaved(saved);
    } catch (err) {
      showToast("error", `Couldn't save the plan: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const k = MAINTENANCE_KINDS.find((x) => x.value === kind)!;
  const folders = [...categories].sort((a, b) => (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? ""));

  return (
    <Modal title={plan ? "Change plan" : "New maintenance plan"} onClose={saving ? () => {} : onClose} wide>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input py-1.5" placeholder="e.g. Annual PPE inspection" />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Kind of work</span>
        <Segmented label="Kind of work" value={kind} onChange={setKind} options={MAINTENANCE_KINDS.map((x) => ({ value: x.value, label: x.label }))} />
        <span className="text-xs text-gray-500">{k.hint}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-gray-500">How often</span>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Every</span>
            <NumberInput value={every} min={1} max={1000} onChange={(n) => setEvery(Math.max(1, Math.round(n)))} className="input py-1.5 w-20" />
            <select value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)} className="input py-1.5 w-auto">
              {INTERVAL_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-500">Counted from the day each one's done.</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">First due</span>
          <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className="input py-1.5" />
          <span className="text-xs text-gray-500">
            For kit that's never been done{kind === "test_tag" ? ", unless a unit already has a Next test & tag date" : ""}.
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-gray-500">Covers {picked.length > 0 && `(${picked.length} item${picked.length === 1 ? "" : "s"})`}</span>
          {folders.length > 0 && (
            <select value="" onChange={(e) => addFolder(e.target.value)} className="input py-1 w-auto text-xs">
              <option value="">Add a whole folder…</option>
              {folders.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayPath(paths.get(c.id))}
                </option>
              ))}
            </select>
          )}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items to add: name, code, folder…" className="input py-1.5" />
        {matches.length > 0 && (
          <div className="flex flex-col max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
            {matches.map((i) => (
              <button key={i.id} onClick={() => setPicked((p) => [...p, i.id])} className="text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2">
                <span className="text-signal-ink font-medium">+</span>
                {i.code && <span className="font-mono text-xs text-gray-400">{i.code}</span>}
                <span className="truncate">{i.name}</span>
                <span className="ml-auto text-xs text-gray-400 truncate">{displayPath(paths.get(i.category))}</span>
              </button>
            ))}
          </div>
        )}
        {picked.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {picked.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700">
                {byId.get(id)?.name ?? "(archived or deleted item)"}
                {byId.get(id)?.tracking === "serial" && <span className="text-gray-400">· units</span>}
                <button onClick={() => setPicked((p) => p.filter((x) => x !== id))} className="w-4 h-4 rounded-full hover:bg-gray-300 leading-none" aria-label="Remove">
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-400">No items yet. Each unit of a serialised item gets its own job; a bulk item gets one for all of it.</span>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Instructions (optional)</span>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          className="input py-1.5"
          placeholder="What to check, and what fails it. Shown on every job."
        />
      </label>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !name.trim() || (!plan && !firstDue)} className="btn-primary">
          {saving ? "Saving…" : plan ? "Save plan" : "Create plan"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
