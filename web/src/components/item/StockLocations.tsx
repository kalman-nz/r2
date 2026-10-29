import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Serial } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { unitPlaces, useItemStock } from "../../lib/stock";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";

// Where an item's stock is kept. Bulk stock is a quantity at each stock
// location, edited here (its total is the item's stock). Serialised units
// each have their own location, set on the unit, so this only counts them.

interface Line {
  key: number;
  location: string;
  bin: string;
  qty: number;
}

export default function StockLocations({ item, canEdit, onSaved }: { item: Item; canEdit: boolean; onSaved: (item: Item) => void }) {
  const serialised = item.tracking === "serial";
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: locations = [] } = useLocations();
  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const { data: stock = [], isLoading: stockLoading } = useItemStock(item.id, !serialised);
  // The same query as the Units tab (SerialsSection), so they share it.
  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ["serials", item.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item.id }), sort: "barcode" }),
    enabled: serialised,
  });
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(0);

  const places = serialised ? unitPlaces(units) : stock.map((s) => ({ location: s.location, bin: s.bin, qty: s.qty }));
  const total = places.reduce((n, p) => n + p.qty, 0);
  const loading = serialised ? unitsLoading : stockLoading;

  function start() {
    const from = stock.map((s, i) => ({ key: i, location: s.location, bin: s.bin, qty: s.qty }));
    setLines(from.length > 0 ? from : [{ key: 0, location: locations[0]?.id ?? "", bin: "", qty: 0 }]);
    setNextKey(from.length + 1);
    setEditing(true);
  }

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const unused = (key: number) => locations.filter((loc) => !lines.some((l) => l.key !== key && l.location === loc.id));

  function addLine() {
    const free = locations.find((loc) => !lines.some((l) => l.location === loc.id));
    setLines((ls) => [...ls, { key: nextKey, location: free?.id ?? "", bin: "", qty: 0 }]);
    setNextKey((k) => k + 1);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await api.setItemStock(
        item.id,
        lines.map((l) => ({ location: l.location, qty: l.qty, bin: l.bin.trim() })),
      );
      await queryClient.invalidateQueries({ queryKey: ["item_stock"] });
      onSaved(result.item);
      setEditing(false);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const editTotal = lines.reduce((n, l) => n + l.qty, 0);
  const duplicate = new Set(lines.map((l) => l.location)).size !== lines.length;
  const missing = lines.some((l) => !l.location);

  return (
    <section className={`card flex flex-col ${editing ? "ring-2 ring-signal/30 border-signal/50" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-gray-100">
        <h2 className="eyebrow text-gray-500">Storage locations</h2>
        {!serialised && canEdit && !editing && (
          <button onClick={start} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="px-4 pb-2 flex flex-col"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_1.5rem] gap-2 pt-2 pb-1 text-xs text-gray-500">
            <span>Location</span>
            <span>Shelf / bin</span>
            <span className="text-right">Qty</span>
            <span />
          </div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_1.5rem] gap-2 py-1 items-center">
              <select value={l.location} onChange={(e) => update(l.key, { location: e.target.value })} className="input py-1.5 min-w-0" aria-label="Location">
                {!l.location && <option value="">Choose…</option>}
                {unused(l.key).map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
              <input value={l.bin} onChange={(e) => update(l.key, { bin: e.target.value })} placeholder="e.g. Bay 3" className="input py-1.5 min-w-0" aria-label="Shelf or bin" />
              <NumberInput value={l.qty} min={0} onChange={(n) => update(l.key, { qty: Math.max(0, Math.round(n)) })} className="input py-1.5 w-full text-right" />
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                className="text-gray-400 hover:text-fault-ink text-lg leading-none"
                aria-label="Remove this location"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          {lines.length < locations.length && (
            <button type="button" onClick={addLine} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover w-fit py-2">
              + Add a location
            </button>
          )}
          {locations.length === 0 && (
            <p className="text-xs text-gray-500 py-2">
              No storage locations yet. Add them in <Link to="/settings/inventory" className="underline">Settings → Inventory</Link>.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 py-2.5 border-t border-gray-100 mt-1 flex-wrap">
            <div className="flex items-center gap-2">
              <button type="submit" disabled={saving || duplicate || missing} className="btn-primary py-1.5">
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary py-1.5">
                Cancel
              </button>
            </div>
            <span className="text-sm text-gray-600 tabular-nums">
              Total <span className="font-semibold text-gray-900">{editTotal.toLocaleString()}</span>
              {editTotal !== item.stockQty && <span className="text-gray-400"> (was {item.stockQty.toLocaleString()})</span>}
            </span>
          </div>
        </form>
      ) : (
        <div className="px-4 pb-2 text-sm">
          {loading ? (
            <p className="py-3 text-gray-400">Loading…</p>
          ) : places.length === 0 ? (
            <p className="py-3 text-gray-400">{serialised ? "No active units yet." : "None in stock yet."}</p>
          ) : (
            <table className="w-full">
              <tbody>
                {places.map((p, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 text-gray-900">{p.location ? (locationName.get(p.location) ?? "—") : <span className="text-gray-400">No location</span>}</td>
                    <td className="py-2 pr-3 text-gray-600">{p.bin || <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 text-right tabular-nums text-gray-900">{p.qty.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              {places.length > 1 && (
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="py-2 pr-3 text-gray-500" colSpan={2}>
                      Total
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-900">{total.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}
    </section>
  );
}
