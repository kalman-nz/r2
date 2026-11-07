import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { CustomField, CustomFieldType } from "../lib/api";
import { useCustomFields, type CustomTarget } from "../lib/customFields";
import { errorText } from "../lib/errors";
import { withOrg } from "../lib/currentOrg";
import { InlineText } from "./InlineInput";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { DragHandle, moveItem, useDragReorder } from "./DragReorder";

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

const typeLabel = (type: CustomField["type"]) => TYPES.find((t) => t.value === (type || "text"))?.label ?? type;
// Dropdown choices are typed as one comma-separated line.
const splitOptions = (text: string) =>
  text
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

const SECTIONS: { appliesTo: CustomTarget; title: string; on: string }[] = [
  { appliesTo: "job", title: "Projects", on: "project" },
  { appliesTo: "contact", title: "Contacts", on: "contact" },
  { appliesTo: "venue", title: "Locations", on: "location" },
];

// Settings > Projects > Custom fields: the organisation's own fields on
// projects, contacts and locations, filled in on each one's Custom fields
// card and shown as list columns. Laid out like Custom item fields. The
// type is fixed once a field exists, so values already saved keep meaning
// the same thing.
export default function ProjectFieldsSettings() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-900">Custom fields</h2>
      {SECTIONS.map((s) => (
        <FieldList key={s.appliesTo} {...s} />
      ))}
    </div>
  );
}

function FieldList({ appliesTo, title, on }: { appliesTo: CustomTarget; title: string; on: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { fields, isLoading } = useCustomFields(appliesTo);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customFields", appliesTo] });

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
      return false;
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    const sortOrder = Math.max(0, ...fields.map((f) => f.sortOrder)) + 1;
    const ok = await run(() =>
      pb.collection("custom_fields").create(withOrg({ label: label.trim(), type, appliesTo, options: type === "select" ? splitOptions(options) : [], sortOrder })),
    );
    if (ok) {
      setLabel("");
      setOptions("");
    }
  }

  function move(from: number, to: number) {
    const order = moveItem(fields, from, to);
    return run(() => Promise.all(order.map((f, i) => (f.sortOrder === i + 1 ? null : pb.collection("custom_fields").update(f.id, { sortOrder: i + 1 })))));
  }

  async function remove(field: CustomField) {
    const ok = await confirm({
      title: "Delete field",
      message: `Delete "${field.label}"? It's taken off every ${on}; what's been filled in is kept.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await run(() => pb.collection("custom_fields").delete(field.id));
  }

  const drag = useDragReorder({ count: fields.length, onMove: move, gap: 8 });

  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {fields.map((f, i) => (
        <div key={f.id} {...drag.item(i)} className={`flex items-center gap-2 flex-wrap bg-white ${drag.cls(i)}`} style={drag.style}>
          <DragHandle {...drag.handle(i)} />
          <InlineText value={f.label} onCommit={(v) => v && run(() => pb.collection("custom_fields").update(f.id, { label: v }))} className="w-48" />
          <span className="text-xs text-gray-500 w-16">{typeLabel(f.type)}</span>
          {f.type === "select" ? (
            <InlineText
              value={(f.options ?? []).join(", ")}
              onCommit={(v) => run(() => pb.collection("custom_fields").update(f.id, { options: splitOptions(v) }))}
              placeholder="Choices, separated by commas"
              className="flex-1 min-w-40"
            />
          ) : (
            <span className="flex-1" />
          )}
          <button
            onClick={() => remove(f)}
            className="w-6 h-6 shrink-0 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100"
            aria-label={`Delete ${f.label}`}
            title={`Delete ${f.label}`}
          >
            ×
          </button>
        </div>
      ))}
      {!isLoading && fields.length === 0 && <p className="text-gray-500">None yet.</p>}
      <form onSubmit={add} className="flex items-center gap-2 pt-3 mt-1 border-t border-gray-100 flex-wrap">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" aria-label={`New ${on} field name`} className="input py-1.5 w-48" />
        <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className="input py-1.5 w-auto" aria-label={`New ${on} field type`}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {type === "select" && (
          <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Choices, separated by commas" className="input py-1.5 flex-1 min-w-40" />
        )}
        <button type="submit" disabled={!label.trim() || (type === "select" && splitOptions(options).length === 0)} className="btn-secondary py-1.5">
          Add
        </button>
      </form>
    </section>
  );
}
