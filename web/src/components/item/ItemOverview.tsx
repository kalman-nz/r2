import type { ReactNode } from "react";
import type { Item } from "../../lib/api";
import { displayPath } from "../../lib/catalog";
import { nzd } from "../../lib/format";

// An item's details to read, grouped the way people look for them. Editing
// happens in ItemForm, behind the Edit button.
export default function ItemOverview({ item, categoryPath }: { item: Item; categoryPath: string }) {
  const isKit = item.kind === "kit";
  const type = isKit ? "Kit, made of other items" : item.tracking === "serial" ? "Physical item, tracked unit by unit" : "Physical item, tracked as a quantity";
  const tags = item.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const amount = (n: number, unit: string) => (n > 0 ? `${n.toLocaleString()} ${unit}` : null);

  return (
    <div className="flex flex-col gap-5">
      <Group title="Identification">
        <Row label="Item code" value={item.code} mono />
        <Row label="Barcode" value={item.barcode} mono hint={!isKit && item.tracking === "serial" ? "For the item type; each unit has its own" : undefined} />
        <Row label="Category" value={categoryPath ? displayPath(categoryPath) : null} empty="Uncategorised" />
        <Row label="Type" value={type} />
        <Row
          label="Tags"
          value={
            tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                    {t}
                  </span>
                ))}
              </span>
            ) : null
          }
        />
      </Group>

      <Group title="Pricing">
        <Row label="Day rate" value={item.dayRate > 0 ? `${nzd(item.dayRate)} ex GST` : null} empty="No rate set" />
        <Row label="Replacement value" value={item.replacementValue > 0 ? nzd(item.replacementValue) : null} />
      </Group>

      {!isKit && (
        <Group title="Warehouse">
          {item.tracking === "bulk" && <Row label="Quantity owned" value={item.stockQty.toLocaleString()} />}
          <Row label="Location" value={item.locationInWarehouse || null} />
          <Row label="Extra turnaround" value={amount(item.bufferHours, item.bufferHours === 1 ? "hour" : "hours")} empty="None" hint="On top of the global buffer" />
          <Row label="Weight" value={amount(item.weightKg, "kg")} />
          <Row label="Power" value={amount(item.powerW, "W")} />
        </Group>
      )}

      <Group title="Quote & notes">
        <Row label="On quotes" value={item.description ? <span className="whitespace-pre-line">{item.description}</span> : null} empty="No description" />
        <Row label="Internal notes" value={item.notes ? <span className="whitespace-pre-line">{item.notes}</span> : null} />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="eyebrow text-gray-500 pb-1.5 border-b border-gray-100">{title}</h3>
      <dl className="divide-y divide-gray-100">{children}</dl>
    </section>
  );
}

function Row({ label, value, mono = false, hint, empty = "—" }: { label: string; value: ReactNode; mono?: boolean; hint?: string; empty?: string }) {
  const blank = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0">
        <span className={blank ? "text-gray-400" : `text-gray-900 ${mono ? "font-mono" : ""}`}>{blank ? empty : value}</span>
        {hint && !blank && <span className="block text-xs text-gray-500">{hint}</span>}
      </dd>
    </div>
  );
}
