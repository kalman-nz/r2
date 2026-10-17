import { useEffect, useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import type { Item, PriceUnit } from "../../lib/api";
import { displayPath, useCategories, useCategoryPaths } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import Field from "../Field";
import NumberInput from "../NumberInput";
import Segmented from "../Segmented";
import { useToast } from "../ToastProvider";
import { currentOrgId } from "../../lib/currentOrg";

interface ItemDraft {
  name: string;
  code: string;
  category: string;
  kind: "item" | "kit";
  tracking: "bulk" | "serial";
  stockQty: number;
  price: number;
  priceUnit: PriceUnit;
  replacementValue: number;
  weightKg: number;
  powerW: number;
  bufferHours: number;
  barcode: string;
  locationInWarehouse: string;
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
    price: item?.price ?? 0,
    priceUnit: item?.priceUnit || "day",
    replacementValue: item?.replacementValue ?? 0,
    weightKg: item?.weightKg ?? 0,
    powerW: item?.powerW ?? 0,
    bufferHours: item?.bufferHours ?? 0,
    barcode: item?.barcode ?? "",
    locationInWarehouse: item?.locationInWarehouse ?? "",
    description: item?.description ?? "",
    notes: item?.notes ?? "",
    archived: item?.archived ?? false,
  };
}

// Create or edit an item. hasSerials locks the bulk/serial choice: the
// server refuses to switch an item with units to bulk, so the form doesn't
// offer it. The item code is never edited here: the server assigns it.
// Used for new items; an existing item is edited section by section in
// place (ItemDetails). The Save bar sticks to the bottom of the screen so
// it's never a scroll away. footer goes next to Save.
export default function ItemForm({
  item,
  readOnly,
  hasSerials,
  onSaved,
  footer,
}: {
  item: Item | null;
  readOnly: boolean;
  hasSerials: boolean;
  onSaved: (item: Item) => void;
  footer?: ReactNode;
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
    <div className="flex flex-col gap-5">
      <Group title="Identification">
        <Field label="Name" className="sm:col-span-2">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={readOnly} className="input py-2" placeholder="e.g. Shure SM58" />
        </Field>
        <Field label="Category">
          <select value={draft.category} onChange={(e) => set("category", e.target.value)} disabled={readOnly} className="input py-2">
            <option value="">Uncategorised</option>
            {sortedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {displayPath(c.path)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is it?">
          <Segmented
            label="What is it?"
            value={draft.kind}
            onChange={(v) => set("kind", v)}
            disabled={readOnly || hasSerials}
            options={[
              { value: "item", label: "Physical item" },
              { value: "kit", label: "Kit" },
            ]}
          />
        </Field>
        {!isKit && (
          <Field label="Tracking">
            <Segmented
              label="Tracking"
              value={draft.tracking}
              onChange={(v) => set("tracking", v)}
              disabled={readOnly || hasSerials}
              options={[
                { value: "bulk", label: "Bulk" },
                { value: "serial", label: "Serialised" },
              ]}
            />
          </Field>
        )}
        <Field label="Barcode">
          <input
            value={draft.barcode}
            onChange={(e) => set("barcode", e.target.value)}
            disabled={readOnly}
            placeholder={item ? "" : "Generated when you save, or scan an existing tag"}
            className="input py-2 font-mono"
          />
        </Field>
      </Group>

      <Group title="Pricing">
        <Field label="Price (ex GST)" className="sm:col-span-2">
          <div className="flex items-center gap-2 flex-wrap">
            <NumberInput value={draft.price} min={0} onChange={(n) => set("price", n)} disabled={readOnly} className="input py-2 w-36" />
            <Segmented
              compact
              label="Price per"
              value={draft.priceUnit}
              onChange={(v) => set("priceUnit", v)}
              disabled={readOnly}
              options={[
                { value: "each", label: "/ea" },
                { value: "hour", label: "/hr" },
                { value: "day", label: "/day" },
                { value: "week", label: "/week" },
              ]}
            />
          </div>
        </Field>
        <Field label="Replacement cost">
          <NumberInput value={draft.replacementValue} min={0} onChange={(n) => set("replacementValue", n)} disabled={readOnly} className="input py-2" />
        </Field>
      </Group>

      {!isKit && (
        <Group title="Warehouse">
          {draft.tracking === "bulk" && (
            <Field label="Quantity owned">
              <NumberInput value={draft.stockQty} min={0} onChange={(n) => set("stockQty", Math.round(n))} disabled={readOnly} className="input py-2" />
            </Field>
          )}
          <Field label="Location in warehouse">
            <input
              value={draft.locationInWarehouse}
              onChange={(e) => set("locationInWarehouse", e.target.value)}
              disabled={readOnly}
              className="input py-2"
              placeholder="e.g. Bay 3, top shelf"
            />
          </Field>
          <Field label="Extra turnaround (h)">
            <NumberInput value={draft.bufferHours} min={0} onChange={(n) => set("bufferHours", n)} disabled={readOnly} className="input py-2" />
          </Field>
          <Field label="Weight (kg)">
            <NumberInput value={draft.weightKg} min={0} onChange={(n) => set("weightKg", n)} disabled={readOnly} className="input py-2" />
          </Field>
          <Field label="Power (W)">
            <NumberInput value={draft.powerW} min={0} onChange={(n) => set("powerW", n)} disabled={readOnly} className="input py-2" />
          </Field>
        </Group>
      )}

      <Group title="Quote & notes">
        <Field label="Description" className="sm:col-span-2">
          <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} disabled={readOnly} rows={2} className="input py-2" />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2">
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} disabled={readOnly} rows={2} className="input py-2" />
        </Field>
      </Group>

      <Group title="Photo">
        <div className="flex items-center gap-3 flex-wrap sm:col-span-2">
          {item?.photo && (
            <img src={pb.files.getURL(item, item.photo, { thumb: "100x100" })} alt="" className="w-16 h-16 rounded-md object-cover border border-gray-200" />
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
      </Group>
      {!readOnly && (
        <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 flex items-center gap-3 flex-wrap bg-white/95 backdrop-blur border-t border-gray-200 rounded-b-md">
          <button onClick={save} disabled={saving || !dirty || !draft.name.trim()} className="btn-primary py-2">
            {saving ? "Saving…" : item ? "Save changes" : "Create item"}
          </button>
          {footer}
        </div>
      )}
    </div>
  );
}

// The same groups as ItemOverview, so a field is in the same place whether
// you're reading or editing.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="eyebrow text-gray-500 pb-1.5 border-b border-gray-100">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </section>
  );
}
