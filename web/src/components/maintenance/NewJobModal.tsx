import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type MaintenanceJob, type MaintenanceKind, type Serial } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { today } from "../../lib/maintenance";
import { MAINTENANCE_KINDS } from "../../lib/statuses";
import Modal from "../Modal";
import Segmented from "../Segmented";
import { useToast } from "../ToastProvider";

const SHOWN = 8;

// One-off maintenance, scheduled for a day: on some units of an item, a
// bulk item, or nothing in particular (the forklift's service). Repeating
// work is a plan instead.
export default function NewJobModal({
  item: givenItem,
  serials: givenSerials = [],
  onClose,
  onCreated,
}: {
  item?: Item;
  serials?: string[];
  onClose: () => void;
  onCreated: (jobs: MaintenanceJob[]) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MaintenanceKind>("service");
  const [dueOn, setDueOn] = useState(today());
  const [notes, setNotes] = useState("");
  const [item, setItem] = useState<Item | null>(givenItem ?? null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(givenSerials));
  const [saving, setSaving] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["items", "physical"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter("kind = 'item' && archived = false"), sort: "name" }),
    enabled: !givenItem,
  });
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return items.filter((i) => [i.name, i.code, i.barcode].some((v) => v.toLowerCase().includes(term))).slice(0, SHOWN);
  }, [items, search]);
  const serialised = item?.tracking === "serial";
  const { data: units = [] } = useQuery({
    queryKey: ["serials", item?.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item!.id }), sort: "barcode" }),
    enabled: !!item && serialised,
  });
  const usable = units.filter((u) => u.status === "active" || u.status === "repair" || picked.has(u.id));

  async function save() {
    setSaving(true);
    try {
      const jobs = await api.scheduleJobs({
        name: name.trim(),
        kind,
        dueOn,
        notes: notes.trim(),
        ...(item ? { item: item.id, serials: serialised ? [...picked] : [] } : {}),
      });
      onCreated(jobs);
    } catch (err) {
      showToast("error", `Couldn't schedule it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Schedule maintenance" onClose={saving ? () => {} : onClose}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">What needs doing</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input py-1.5" placeholder="e.g. Replace the fan, update firmware" />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Kind of work</span>
        <Segmented label="Kind of work" value={kind} onChange={setKind} options={MAINTENANCE_KINDS.map((x) => ({ value: x.value, label: x.label }))} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Due</span>
        <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="input py-1.5 w-44" />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">On (optional)</span>
        {item ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-gray-900">
              {item.code && <span className="font-mono text-gray-400 mr-1.5">{item.code}</span>}
              {item.name}
            </span>
            {!givenItem && (
              <button
                onClick={() => {
                  setItem(null);
                  setPicked(new Set());
                }}
                className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an item: name, code or barcode…" className="input py-1.5" />
            {matches.length > 0 && (
              <div className="flex flex-col border border-gray-200 rounded-md divide-y divide-gray-100">
                {matches.map((i) => (
                  <button key={i.id} onClick={() => setItem(i)} className="text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2">
                    {i.code && <span className="font-mono text-xs text-gray-400">{i.code}</span>}
                    <span className="truncate">{i.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {item && serialised && usable.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Units (none ticked: the item as a whole)</span>
          <div className="flex flex-col max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
            {usable.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={picked.has(u.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(u.id)) next.delete(u.id);
                      else next.add(u.id);
                      return next;
                    })
                  }
                />
                <span className="font-mono">{u.barcode || "(no barcode)"}</span>
                {(u.label || u.serialNumber) && <span className="text-xs text-gray-400">{[u.label, u.serialNumber].filter(Boolean).join(" · ")}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Notes (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input py-1.5" />
      </label>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !name.trim() || !dueOn} className="btn-primary">
          {saving ? "Scheduling…" : picked.size > 1 ? `Schedule ${picked.size} jobs` : "Schedule"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
