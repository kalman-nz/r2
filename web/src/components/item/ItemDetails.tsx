import { createContext, useContext, useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import type { Item, PriceUnit } from "../../lib/api";
import { displayPath, useCategories, useCategoryPaths } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { nzd, priceLabel } from "../../lib/format";
import NumberInput from "../NumberInput";
import Segmented from "../Segmented";
import { useToast } from "../ToastProvider";

// An existing item's details, one card per section. Each card is read and
// edited in the same place: Edit turns its values into inputs where they
// sit, with Save right underneath, so nothing moves and nothing needs
// scrolling to. (New items use ItemForm.) The item code is never editable:
// the server assigns it.

type Section = "identification" | "pricing" | "warehouse" | "notes";

interface Draft {
  name: string;
  barcode: string;
  category: string;
  kind: "item" | "kit";
  tracking: "bulk" | "serial";
  price: number;
  priceUnit: PriceUnit;
  replacementValue: number;
  stockQty: number;
  locationInWarehouse: string;
  bufferHours: number;
  weightKg: number;
  powerW: number;
  description: string;
  notes: string;
}

// The fields each section saves.
const FIELDS: Record<Section, (keyof Draft)[]> = {
  identification: ["name", "barcode", "category", "kind", "tracking"],
  pricing: ["price", "priceUnit", "replacementValue"],
  warehouse: ["stockQty", "locationInWarehouse", "bufferHours", "weightKg", "powerW"],
  notes: ["description", "notes"],
};

// The same words when reading and editing.
const KIND_OPTIONS: { value: Draft["kind"]; label: string }[] = [
  { value: "item", label: "Physical item" },
  { value: "kit", label: "Kit" },
];
const TRACKING_OPTIONS: { value: Draft["tracking"]; label: string }[] = [
  { value: "bulk", label: "Bulk" },
  { value: "serial", label: "Serialised" },
];
// What a price is per: each (sold), hour, day or week.
const PER_OPTIONS: { value: PriceUnit; label: string }[] = [
  { value: "each", label: "/ea" },
  { value: "hour", label: "/hr" },
  { value: "day", label: "/day" },
  { value: "week", label: "/week" },
];
const labelOf = <T extends string>(options: { value: T; label: string }[], value: T) => options.find((o) => o.value === value)?.label ?? value;

function draftOf(item: Item): Draft {
  return {
    name: item.name,
    barcode: item.barcode,
    category: item.category,
    kind: item.kind,
    tracking: item.tracking === "serial" ? "serial" : "bulk",
    price: item.price,
    priceUnit: item.priceUnit || "day",
    replacementValue: item.replacementValue,
    stockQty: item.stockQty,
    locationInWarehouse: item.locationInWarehouse,
    bufferHours: item.bufferHours,
    weightKg: item.weightKg,
    powerW: item.powerW,
    description: item.description,
    notes: item.notes,
  };
}

export default function ItemDetails({
  item,
  categoryPath,
  canEdit,
  hasSerials,
  onSaved,
  children,
}: {
  item: Item;
  categoryPath: string;
  canEdit: boolean;
  hasSerials: boolean;
  onSaved: (item: Item) => void;
  // Places the cards: the item page decides the layout.
  children: (cards: Record<Section, ReactNode>) => ReactNode;
}) {
  const { showToast } = useToast();
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();
  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const isKit = (editing === "identification" ? draft.kind : item.kind) === "kit";

  function start(section: Section) {
    setDraft(draftOf(item));
    setEditing(section);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const key of FIELDS[editing]) body[key] = key === "name" ? draft.name.trim() : draft[key];
      const saved = await pb.collection("items").update<Item>(item.id, body);
      onSaved(saved);
      setEditing(null);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const sortedCategories = categories
    .map((c) => ({ id: c.id, path: paths.get(c.id) ?? c.name }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const amount = (n: number, unit: string) => (n > 0 ? `${n.toLocaleString()} ${unit}` : null);

  // Props every card shares.
  const card = (section: Section) => ({
    editing: editing === section,
    canEdit: canEdit && editing === null,
    saving,
    onEdit: () => start(section),
    onCancel: () => setEditing(null),
    onSave: save,
    saveDisabled: section === "identification" && !draft.name.trim(),
  });

  return children({
    identification: (
      <Card title="Identification" {...card("identification")}>
        <Row label="Name" value={item.name}>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} className="input py-1.5 w-full" autoFocus />
        </Row>
        <Row label="Item code" value={item.code} mono />
        <Row label="Barcode" value={item.barcode} mono>
          <input value={draft.barcode} onChange={(e) => set("barcode", e.target.value)} className="input py-1.5 w-full font-mono" />
        </Row>
        <Row label="Category" value={categoryPath ? displayPath(categoryPath) : null} empty="Uncategorised">
          <select value={draft.category} onChange={(e) => set("category", e.target.value)} className="input py-1.5 w-full">
            <option value="">Uncategorised</option>
            {sortedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {displayPath(c.path)}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="What is it?"
          value={labelOf(KIND_OPTIONS, item.kind)}
        >
          <Segmented label="What is it?" value={draft.kind} onChange={(v) => set("kind", v)} disabled={hasSerials} options={KIND_OPTIONS} />
        </Row>
        {!isKit && (
          <Row label="Tracking" value={labelOf(TRACKING_OPTIONS, item.tracking === "serial" ? "serial" : "bulk")}>
            <Segmented label="Tracking" value={draft.tracking} onChange={(v) => set("tracking", v)} disabled={hasSerials} options={TRACKING_OPTIONS} />
          </Row>
        )}
      </Card>
    ),
    pricing: (
      <Card title="Pricing" {...card("pricing")}>
        <Row label="Price" value={item.price > 0 ? `${priceLabel(item)} ex GST` : null} empty="No price set">
          <div className="flex items-center gap-2 flex-wrap">
            <NumberInput value={draft.price} min={0} onChange={(n) => set("price", n)} className="input py-1.5 w-24" />
            <Segmented compact label="Price per" value={draft.priceUnit} onChange={(v) => set("priceUnit", v)} options={PER_OPTIONS} />
          </div>
        </Row>
        <Row label="Replacement cost" value={item.replacementValue > 0 ? nzd(item.replacementValue) : null}>
          <NumberInput value={draft.replacementValue} min={0} onChange={(n) => set("replacementValue", n)} className="input py-1.5 w-full" />
        </Row>
      </Card>
    ),
    warehouse: item.kind === "kit" ? null : (
        <Card title="Warehouse" {...card("warehouse")}>
          {item.tracking === "bulk" && (
            <Row label="Quantity owned" value={item.stockQty.toLocaleString()}>
              <NumberInput value={draft.stockQty} min={0} onChange={(n) => set("stockQty", Math.round(n))} className="input py-1.5 w-full" />
            </Row>
          )}
          <Row label="Location" value={item.locationInWarehouse || null}>
            <input
              value={draft.locationInWarehouse}
              onChange={(e) => set("locationInWarehouse", e.target.value)}
              placeholder="e.g. Bay 3, top shelf"
              className="input py-1.5 w-full"
            />
          </Row>
          <Row
            label="Extra turnaround (h)"
            value={amount(item.bufferHours, item.bufferHours === 1 ? "hour" : "hours")}
            empty="None"
          >
            <NumberInput value={draft.bufferHours} min={0} onChange={(n) => set("bufferHours", n)} className="input py-1.5 w-full" />
          </Row>
          <Row label="Weight (kg)" value={amount(item.weightKg, "kg")}>
            <NumberInput value={draft.weightKg} min={0} onChange={(n) => set("weightKg", n)} className="input py-1.5 w-full" />
          </Row>
          <Row label="Power (W)" value={amount(item.powerW, "W")}>
            <NumberInput value={draft.powerW} min={0} onChange={(n) => set("powerW", n)} className="input py-1.5 w-full" />
          </Row>
        </Card>
    ),
    notes: (
      <Card title="Quote & notes" {...card("notes")}>
        <Row
          label="On quotes"
          value={item.description ? <span className="whitespace-pre-line">{item.description}</span> : null}
          empty="No description"
        >
          <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={3} className="input py-1.5 w-full" />
        </Row>
        <Row label="Internal notes" value={item.notes ? <span className="whitespace-pre-line">{item.notes}</span> : null}>
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input py-1.5 w-full" />
        </Row>
      </Card>
    ),
  });
}

function Card({
  title,
  editing,
  canEdit,
  saving,
  saveDisabled,
  onEdit,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  editing: boolean;
  canEdit: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`card flex flex-col ${editing ? "ring-2 ring-signal/30 border-signal/50" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-gray-100">
        <h2 className="eyebrow text-gray-500">{title}</h2>
        {canEdit && (
          <button onClick={onEdit} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
            Edit
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        className="px-4 pb-2"
      >
        <EditingContext editing={editing}>{children}</EditingContext>
        {editing && (
          <div className="flex items-center gap-2 py-2.5 border-t border-gray-100">
            <button type="submit" disabled={saving || saveDisabled} className="btn-primary py-1.5">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={onCancel} className="btn-secondary py-1.5">
              Cancel
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

// Rows read whether their card is being edited from here, so each Row can
// show its value or its input in the same spot.
const Editing = createContext(false);
function EditingContext({ editing, children }: { editing: boolean; children: ReactNode }) {
  return <Editing.Provider value={editing}>{children}</Editing.Provider>;
}

// label | value — or, while editing, label | input (children). A row with
// no input (the item code) stays as it is.
function Row({
  label,
  value,
  mono = false,
  empty = "—",
  children,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  empty?: string;
  children?: ReactNode;
}) {
  const editing = useContext(Editing) && children !== undefined;
  const blank = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2 text-sm items-start border-b border-gray-100 last:border-b-0 min-h-11">
      <dt className="text-gray-500 pt-1">{label}</dt>
      <dd className="min-w-0 flex flex-col gap-0.5">
        {editing ? (
          children
        ) : (
          <span className={`pt-1 ${blank ? "text-gray-400" : `text-gray-900 ${mono ? "font-mono" : ""}`}`}>{blank ? empty : value}</span>
        )}
      </dd>
    </div>
  );
}
