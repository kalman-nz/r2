import { createContext, useContext, useState, type ReactNode } from "react";
import { pb } from "../../lib/pocketbase";
import type { CustomField, Item, PriceUnit } from "../../lib/api";
import { displayPath, useCategories, useCategoryPaths, useItemCustomFields } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { nzd, priceLabel } from "../../lib/format";
import NumberInput from "../NumberInput";
import Segmented from "../Segmented";
import { useToast } from "../ToastProvider";
import { useFeature } from "../../lib/roles";

// An existing item's details, one card per section. Each card is read and
// edited in the same place: Edit turns its values into inputs where they
// sit, with Save right underneath, so nothing moves and nothing needs
// scrolling to. (New items use ItemForm.) The item code is never editable:
// the server assigns it.

type Section = "identification" | "pricing" | "warehouse" | "notes" | "custom";

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
  notes: string;
  custom: Record<string, unknown>;
}

// The fields each section saves.
const FIELDS: Record<Section, (keyof Draft)[]> = {
  identification: ["name", "barcode", "category", "kind", "tracking"],
  pricing: ["price", "priceUnit", "replacementValue"],
  warehouse: ["stockQty", "locationInWarehouse", "bufferHours", "weightKg", "powerW"],
  notes: ["notes"],
  custom: ["custom"],
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
export const PER_OPTIONS: { value: PriceUnit; label: string }[] = [
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
    notes: item.notes,
    custom: { ...(item.custom ?? {}) },
  };
}

// A custom field's value as read on the card. Imported values can be any
// JSON type whatever the field says, so anything unexpected shows as text.
function customValue(field: CustomField, value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "boolean" || typeof value === "boolean") return value === true || value === "true" ? "Yes" : "No";
  if (field.type === "number" && typeof value === "number") return value.toLocaleString();
  if (field.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  return <span className="whitespace-pre-line">{String(value)}</span>;
}

// Its input while editing. Dates are kept as plain YYYY-MM-DD, with no time
// or timezone to drift.
export function CustomInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (value: unknown) => void }) {
  const text = value === null || value === undefined ? "" : String(value);
  switch (field.type) {
    case "number":
      return (
        <input
          type="number"
          value={text}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="input py-1.5 w-full"
        />
      );
    case "boolean":
      return (
        <Segmented
          label={field.label}
          value={value === true || value === "true" ? "yes" : value === false || value === "false" ? "no" : ""}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          onChange={(v) => onChange(v === "yes")}
        />
      );
    case "date":
      return <input type="date" value={text.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} className="input py-1.5 w-full" />;
    case "select": {
      // A value from before the choices changed stays pickable.
      const options = field.options ?? [];
      return (
        <select value={text} onChange={(e) => onChange(e.target.value || null)} className="input py-1.5 w-full">
          <option value="">—</option>
          {[...options, ...(text && !options.includes(text) ? [text] : [])].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <input value={text} onChange={(e) => onChange(e.target.value)} className="input py-1.5 w-full" />;
  }
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
  const { data: customFields = [] } = useItemCustomFields();
  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  // Hire prices only while the organisation uses prices and quotes; what
  // it's worth is still worth keeping.
  const pricing = useFeature()("pricing");
  // Turnaround between bookings, with projects.
  const projectsOn = useFeature()("projects");
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
        <Row label="Folder" value={categoryPath ? displayPath(categoryPath) : null} empty="Inventory (top level)">
          <select value={draft.category} onChange={(e) => set("category", e.target.value)} className="input py-1.5 w-full">
            <option value="">Inventory (top level)</option>
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
      <Card title={pricing ? "Pricing" : "Value"} {...card("pricing")}>
        {pricing && (
          <Row label="Price" value={item.price > 0 ? `${priceLabel(item)} ex GST` : null} empty="No price set">
            <div className="flex items-center gap-2 flex-wrap">
              <NumberInput value={draft.price} min={0} onChange={(n) => set("price", n)} className="input py-1.5 w-24" />
              <Segmented compact label="Price per" value={draft.priceUnit} onChange={(v) => set("priceUnit", v)} options={PER_OPTIONS} />
            </div>
          </Row>
        )}
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
          {projectsOn && (
            <Row
              label="Extra turnaround (h)"
              value={amount(item.bufferHours, item.bufferHours === 1 ? "hour" : "hours")}
              empty="None"
            >
              <NumberInput value={draft.bufferHours} min={0} onChange={(n) => set("bufferHours", n)} className="input py-1.5 w-full" />
            </Row>
          )}
          <Row label="Weight (kg)" value={amount(item.weightKg, "kg")}>
            <NumberInput value={draft.weightKg} min={0} onChange={(n) => set("weightKg", n)} className="input py-1.5 w-full" />
          </Row>
          <Row label="Power (W)" value={amount(item.powerW, "W")}>
            <NumberInput value={draft.powerW} min={0} onChange={(n) => set("powerW", n)} className="input py-1.5 w-full" />
          </Row>
        </Card>
    ),
    notes: (
      <Card title="Notes" {...card("notes")}>
        <Row label="Internal notes" value={item.notes ? <span className="whitespace-pre-line">{item.notes}</span> : null}>
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input py-1.5 w-full" />
        </Row>
      </Card>
    ),
    // Settings → Custom fields. Nothing to show until there are some.
    custom:
      customFields.length > 0 ? (
        <Card title="Custom fields" {...card("custom")}>
          {customFields.map((f) => (
            <Row key={f.id} label={f.label} value={customValue(f, item.custom?.[f.key])}>
              <CustomInput field={f} value={draft.custom[f.key]} onChange={(v) => set("custom", { ...draft.custom, [f.key]: v })} />
            </Row>
          ))}
        </Card>
      ) : null,
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
