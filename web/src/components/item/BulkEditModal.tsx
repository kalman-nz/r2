import { useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import type { Item, PriceUnit } from "../../lib/api";
import { useItemCustomFields } from "../../lib/catalog";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import Segmented from "../Segmented";
import { CustomInput, PER_OPTIONS } from "./ItemDetails";

// The same change to many items at once, from the inventory list's
// selection. Only the ticked fields are written; editing a field ticks it.
// Custom fields are merged into each item's own `custom`, so values for
// other fields stay as they are.

type Values = {
  price: number;
  priceUnit: PriceUnit;
  replacementValue: number;
  locationInWarehouse: string;
  bufferHours: number;
  weightKg: number;
  powerW: number;
};

const START: Values = { price: 0, priceUnit: "day", replacementValue: 0, locationInWarehouse: "", bufferHours: 0, weightKg: 0, powerW: 0 };

// Saved a few at a time: quicker than one by one, without flooding the server.
const CONCURRENCY = 8;

export async function updateEach<T extends { id: string }>(collection: "items" | "serials", records: T[], body: (record: T) => Record<string, unknown>) {
  const failed: { record: T; error: unknown }[] = [];
  for (let i = 0; i < records.length; i += CONCURRENCY) {
    const chunk = records.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map((record) => pb.collection(collection).update(record.id, body(record))));
    results.forEach((r, j) => r.status === "rejected" && failed.push({ record: chunk[j], error: r.reason }));
  }
  return failed;
}

export default function BulkEditModal({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: (failed: number) => void }) {
  const { data: customFields = [] } = useItemCustomFields();
  const [values, setValues] = useState<Values>(START);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  // Ticked fields: Values keys, or "custom:<key>".
  const [on, setOn] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");

  const tick = (key: string, value = true) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    tick(key);
  };

  async function apply() {
    const standard = (Object.keys(START) as (keyof Values)[]).filter((k) => on.has(k));
    const customKeys = customFields.map((f) => f.key).filter((k) => on.has(`custom:${k}`));
    setSaving(true);
    setProgress(`Saving ${items.length} item${items.length === 1 ? "" : "s"}…`);
    const failed = await updateEach("items", items, (item) => {
      const body: Record<string, unknown> = {};
      for (const k of standard) body[k] = k === "locationInWarehouse" ? values[k].trim() : values[k];
      if (customKeys.length > 0) {
        const next = { ...(item.custom ?? {}) };
        for (const k of customKeys) next[k] = custom[k] ?? null;
        body.custom = next;
      }
      return body;
    });
    setSaving(false);
    onDone(failed.length);
  }

  const row = (key: string, label: string, input: ReactNode) => (
    <div key={key} className="grid grid-cols-[1.25rem_8.5rem_minmax(0,1fr)] gap-2 items-center py-1.5 text-sm">
      <input type="checkbox" checked={on.has(key)} onChange={(e) => tick(key, e.target.checked)} aria-label={`Change ${label}`} />
      <span className={on.has(key) ? "text-gray-900" : "text-gray-500"}>{label}</span>
      <div className="min-w-0">{input}</div>
    </div>
  );

  return (
    <Modal title={`Edit ${items.length} item${items.length === 1 ? "" : "s"}`} onClose={saving ? () => {} : onClose}>
      <p className="text-xs text-gray-500 -mt-2">Tick what to change. Everything else stays as it is on each item.</p>
      <div className="flex flex-col divide-y divide-gray-100">
        {row("price", "Price", <NumberInput value={values.price} min={0} onChange={(n) => set("price", n)} className="input py-1.5 w-full" />)}
        {row(
          "priceUnit",
          "Priced per",
          <Segmented label="Priced per" compact value={values.priceUnit} options={PER_OPTIONS} onChange={(v) => set("priceUnit", v)} />,
        )}
        {row(
          "replacementValue",
          "Replacement value",
          <NumberInput value={values.replacementValue} min={0} onChange={(n) => set("replacementValue", n)} className="input py-1.5 w-full" />,
        )}
        {row(
          "locationInWarehouse",
          "Location",
          <input
            value={values.locationInWarehouse}
            onChange={(e) => set("locationInWarehouse", e.target.value)}
            placeholder="e.g. Bay 3, top shelf"
            className="input py-1.5 w-full"
          />,
        )}
        {row(
          "bufferHours",
          "Extra turnaround (h)",
          <NumberInput value={values.bufferHours} min={0} onChange={(n) => set("bufferHours", n)} className="input py-1.5 w-full" />,
        )}
        {row(
          "weightKg",
          "Weight (kg)",
          <NumberInput value={values.weightKg} min={0} onChange={(n) => set("weightKg", n)} className="input py-1.5 w-full" />,
        )}
        {row("powerW", "Power (W)", <NumberInput value={values.powerW} min={0} onChange={(n) => set("powerW", n)} className="input py-1.5 w-full" />)}
        {customFields.map((f) =>
          row(
            `custom:${f.key}`,
            f.label,
            <CustomInput
              field={f}
              value={custom[f.key]}
              onChange={(v) => {
                setCustom((c) => ({ ...c, [f.key]: v }));
                tick(`custom:${f.key}`);
              }}
            />,
          ),
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={apply} disabled={saving || on.size === 0} className="btn-primary">
          {saving ? progress : `Update ${items.length} item${items.length === 1 ? "" : "s"}`}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
        {on.size > 0 && !saving && (
          <span className="text-xs text-gray-500 ml-auto">
            Changing {on.size} field{on.size === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </Modal>
  );
}
