import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Repair, type Serial } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { fromDateInput } from "../../lib/format";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";

const SHOWN = 8;

// Opening a repair: pick the item (or arrive with it, and its units, from
// the units tab), then which units or how many, and what's wrong. Saving
// takes them out of service straight away.
export default function NewRepairModal({
  item: givenItem,
  serials: givenSerials = [],
  onClose,
  onCreated,
}: {
  item?: Item;
  serials?: string[];
  onClose: () => void;
  onCreated: (repair: Repair) => void;
}) {
  const { showToast } = useToast();
  const [item, setItem] = useState<Item | null>(givenItem ?? null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(givenSerials));
  const [quantity, setQuantity] = useState(1);
  const [fault, setFault] = useState("");
  const [repairer, setRepairer] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["items"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter(), sort: "name" }),
    enabled: !givenItem,
  });
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return items
      .filter((i) => i.kind === "item" && !i.archived && [i.name, i.code, i.barcode].some((v) => v.toLowerCase().includes(term)))
      .slice(0, SHOWN);
  }, [items, search]);

  const serialised = item?.tracking === "serial";
  const { data: units = [] } = useQuery({
    queryKey: ["serials", item?.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item!.id }), sort: "barcode" }),
    enabled: !!item && serialised,
  });
  // Lost and retired units aren't in service to begin with.
  const repairable = units.filter((u) => u.status === "active" || picked.has(u.id));
  const inService = item && !serialised ? item.stockQty - item.outOfServiceQty : 0;

  const ready = !!item && fault.trim() !== "" && (serialised ? picked.size > 0 : quantity >= 1 && quantity <= inService);

  async function save() {
    if (!item) return;
    setSaving(true);
    try {
      const repair = await api.openRepair({
        item: item.id,
        ...(serialised ? { serials: [...picked] } : { quantity }),
        fault: fault.trim(),
        repairer: repairer.trim(),
        dueAt: fromDateInput(dueAt),
      });
      onCreated(repair);
    } catch (err) {
      showToast("error", `Couldn't open the repair: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New repair" onClose={saving ? () => {} : onClose}>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Item</span>
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
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code or barcode…"
              className="input py-1.5"
            />
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

      {item && serialised && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Units</span>
          {repairable.length === 0 ? (
            <p className="text-gray-500">No units in service.</p>
          ) : (
            <div className="flex flex-col max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {repairable.map((u) => (
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
                  {(u.label || u.serialNumber) && (
                    <span className="text-xs text-gray-400">{[u.label, u.serialNumber].filter(Boolean).join(" · ")}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {item && !serialised && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">How many ({inService} in service)</span>
          <NumberInput value={quantity} min={1} max={inService} onChange={(n) => setQuantity(Math.round(n))} className="input py-1.5 w-24" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">What's wrong</span>
        <textarea
          value={fault}
          onChange={(e) => setFault(e.target.value)}
          rows={3}
          className="input py-1.5"
          placeholder="e.g. Crackles when the cable moves"
        />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Repaired by (optional)</span>
          <input value={repairer} onChange={(e) => setRepairer(e.target.value)} className="input py-1.5" placeholder="In house, or a supplier" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Expected back (optional)</span>
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input py-1.5" />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!ready || saving} className="btn-primary">
          {saving ? "Opening…" : "Open repair"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
        <span className="text-xs text-gray-500 ml-auto">Takes it out of service until it's fixed.</span>
      </div>
    </Modal>
  );
}
