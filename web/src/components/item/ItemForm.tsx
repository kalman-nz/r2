import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import type { Item } from "../../lib/api";
import { displayPath, useCategories, useCategoryPaths } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import Field from "../Field";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";
import { currentOrgId } from "../../lib/currentOrg";

interface ItemDraft {
  name: string;
  code: string;
  category: string;
  kind: "item" | "kit";
  tracking: "bulk" | "serial";
  stockQty: number;
  dayRate: number;
  replacementValue: number;
  weightKg: number;
  powerW: number;
  bufferHours: number;
  barcode: string;
  locationInWarehouse: string;
  tags: string;
  description: string;
  notes: string;
  archived: boolean;
}

function draftFrom(item: Item | null): ItemDraft {
  return {
    name: item?.name ?? "",
    code: item?.code ?? "",
    category: item?.category ?? "",
    kind: item?.kind ?? "item",
    tracking: item?.tracking === "serial" ? "serial" : "bulk",
    stockQty: item?.stockQty ?? 0,
    dayRate: item?.dayRate ?? 0,
    replacementValue: item?.replacementValue ?? 0,
    weightKg: item?.weightKg ?? 0,
    powerW: item?.powerW ?? 0,
    bufferHours: item?.bufferHours ?? 0,
    barcode: item?.barcode ?? "",
    locationInWarehouse: item?.locationInWarehouse ?? "",
    tags: item?.tags ?? "",
    description: item?.description ?? "",
    notes: item?.notes ?? "",
    archived: item?.archived ?? false,
  };
}

// Create or edit an item. hasSerials locks the bulk/serial choice: the
// server refuses to switch an item with units to bulk, so the form doesn't
// offer it.
export default function ItemForm({
  item,
  readOnly,
  hasSerials,
  onSaved,
}: {
  item: Item | null;
  readOnly: boolean;
  hasSerials: boolean;
  onSaved: (item: Item) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFrom(item));
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => setDraft(draftFrom(item)), [item]);

  const dirty = photo !== null || JSON.stringify(draft) !== JSON.stringify(draftFrom(item));
  const isKit = draft.kind === "kit";

  async function save() {
    setSaving(true);
    try {
      const data = new FormData();
      for (const [key, value] of Object.entries({ ...draft, name: draft.name.trim() })) data.append(key, String(value));
      if (photo) data.append("photo", photo);
      if (!item) data.append("org", currentOrgId());
      const saved = item
        ? await pb.collection("items").update<Item>(item.id, data)
        : await pb.collection("items").create<Item>(data);
      setPhoto(null);
      onSaved(saved);
      showToast("success", item ? "Saved" : "Item created");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    if (!item) return;
    try {
      onSaved(await pb.collection("items").update<Item>(item.id, { photo: null }));
    } catch (err) {
      showToast("error", `Couldn't remove the photo: ${errorText(err)}`);
    }
  }

  const sortedCategories = categories
    .map((c) => ({ id: c.id, path: paths.get(c.id) ?? c.name }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name" className="sm:col-span-2">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={readOnly} className="input py-2" placeholder="e.g. Shure SM58" />
        </Field>
        <Field label="Code" hint="Short internal code, optional">
          <input value={draft.code} onChange={(e) => set("code", e.target.value)} disabled={readOnly} className="input py-2 font-mono" />
        </Field>
        <Field label="Category" hint={readOnly ? undefined : "Manage categories in Settings > Inventory"}>
          <select value={draft.category} onChange={(e) => set("category", e.target.value)} disabled={readOnly} className="input py-2">
            <option value="">Uncategorised</option>
            {sortedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {displayPath(c.path)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is it?" hint={isKit ? "A bundle of other items, priced as one line" : undefined}>
          <select
            value={draft.kind}
            onChange={(e) => set("kind", e.target.value as "item" | "kit")}
            disabled={readOnly || hasSerials}
            className="input py-2"
          >
            <option value="item">Physical item</option>
            <option value="kit">Kit (made of other items)</option>
          </select>
        </Field>
        {!isKit && (
          <Field label="Tracked" hint={hasSerials ? "Has units, so it stays serialised" : undefined}>
            <select
              value={draft.tracking}
              onChange={(e) => set("tracking", e.target.value as "bulk" | "serial")}
              disabled={readOnly || hasSerials}
              className="input py-2"
            >
              <option value="bulk">As a quantity (cables, consumables)</option>
              <option value="serial">Unit by unit, each with its own barcode</option>
            </select>
          </Field>
        )}
        {!isKit && draft.tracking === "bulk" && (
          <Field label="Quantity owned">
            <NumberInput value={draft.stockQty} min={0} onChange={(n) => set("stockQty", Math.round(n))} disabled={readOnly} className="input py-2" />
          </Field>
        )}
        <Field label="Day rate (ex GST)">
          <NumberInput value={draft.dayRate} min={0} onChange={(n) => set("dayRate", n)} disabled={readOnly} className="input py-2" />
        </Field>
        <Field label="Replacement value">
          <NumberInput value={draft.replacementValue} min={0} onChange={(n) => set("replacementValue", n)} disabled={readOnly} className="input py-2" />
        </Field>
        {!isKit && (
          <>
            <Field label="Weight (kg)">
              <NumberInput value={draft.weightKg} min={0} onChange={(n) => set("weightKg", n)} disabled={readOnly} className="input py-2" />
            </Field>
            <Field label="Power (W)">
              <NumberInput value={draft.powerW} min={0} onChange={(n) => set("powerW", n)} disabled={readOnly} className="input py-2" />
            </Field>
            <Field label="Extra turnaround (hours)" hint="On top of the global buffer, e.g. time to test after a hire">
              <NumberInput value={draft.bufferHours} min={0} onChange={(n) => set("bufferHours", n)} disabled={readOnly} className="input py-2" />
            </Field>
            <Field label="Location in warehouse">
              <input
                value={draft.locationInWarehouse}
                onChange={(e) => set("locationInWarehouse", e.target.value)}
                disabled={readOnly}
                className="input py-2"
                placeholder="e.g. Bay 3, top shelf"
              />
            </Field>
          </>
        )}
        <Field label="Barcode" hint={draft.tracking === "serial" && !isKit ? "For the item type; each unit has its own too" : "What gets scanned for this item"}>
          <input value={draft.barcode} onChange={(e) => set("barcode", e.target.value)} disabled={readOnly} className="input py-2 font-mono" />
        </Field>
        <Field label="Tags">
          <input value={draft.tags} onChange={(e) => set("tags", e.target.value)} disabled={readOnly} className="input py-2" />
        </Field>
        <Field label="Description" hint="Printed on quotes under the item" className="sm:col-span-2">
          <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} rows={2} className="input py-2" />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2">
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} disabled={readOnly} rows={2} className="input py-2" />
        </Field>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-sm text-gray-500">Photo</span>
          <div className="flex items-center gap-3 flex-wrap">
            {item?.photo && (
              <img
                src={pb.files.getURL(item, item.photo, { thumb: "100x100" })}
                alt=""
                className="w-16 h-16 rounded-md object-cover border border-gray-200"
              />
            )}
            {!readOnly && (
              <>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  className="text-sm text-gray-600"
                />
                {item?.photo && (
                  <button type="button" onClick={removePhoto} className="text-sm text-red-600 hover:text-red-700">
                    Remove photo
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {item && !readOnly && (
          <label className="flex items-center gap-2 text-sm text-gray-600 sm:col-span-2">
            <input type="checkbox" checked={draft.archived} onChange={(e) => set("archived", e.target.checked)} />
            Archived — hidden from lists and can't be added to projects, history kept
          </label>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
          <button onClick={save} disabled={saving || !dirty || !draft.name.trim()} className="btn-primary py-2">
            {saving ? "Saving…" : item ? "Save changes" : "Create item"}
          </button>
        </div>
      )}
    </div>
  );
}
