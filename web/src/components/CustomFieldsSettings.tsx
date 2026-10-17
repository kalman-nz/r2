import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { CustomField, CustomFieldType } from "../lib/api";
import { useItemCustomFields } from "../lib/catalog";
import { errorText } from "../lib/errors";
import { withOrg } from "../lib/currentOrg";
import { InlineText } from "./InlineInput";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
];

const typeLabel = (type: CustomField["type"]) => CUSTOM_FIELD_TYPES.find((t) => t.value === (type || "text"))?.label ?? type;
// Dropdown choices are typed as one comma-separated line.
const splitOptions = (text: string) =>
  text
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

// Settings > Custom fields: the organisation's own fields on every item,
// filled in on the item page's Custom fields card. Fields the Rentman import
// brought in are here too. The type is fixed once a field exists, so values
// already saved keep meaning the same thing.
export default function CustomFieldsSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: fields = [], isLoading } = useItemCustomFields();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customFields"] });

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    const sortOrder = Math.max(0, ...fields.map((f) => f.sortOrder)) + 1;
    const ok = await run(() =>
      pb
        .collection("custom_fields")
        .create(withOrg({ label: label.trim(), type, appliesTo: "item", options: type === "select" ? splitOptions(options) : [], sortOrder })),
    );
    if (ok) {
      setLabel("");
      setOptions("");
    }
  }

  // Renumbers the whole list, since imported fields all start at 0.
  function move(index: number, by: -1 | 1) {
    const order = [...fields];
    const [field] = order.splice(index, 1);
    order.splice(index + by, 0, field);
    return run(() =>
      Promise.all(order.map((f, i) => (f.sortOrder === i + 1 ? null : pb.collection("custom_fields").update(f.id, { sortOrder: i + 1 })))),
    );
  }

  async function remove(field: CustomField) {
    const ok = await confirm({
      title: "Delete field",
      message: `Delete "${field.label}"? It disappears from every item. Values already filled in are kept, and come back if you add a field with the same key.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await run(() => pb.collection("custom_fields").delete(field.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Custom fields</h2>
        <p className="text-xs text-gray-500 mt-0.5">Your own details on every item, filled in on the item's Custom fields card.</p>
      </div>
      <div className="card p-4 flex flex-col gap-2">
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-col -my-1">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-gray-400 hover:text-gray-900 disabled:opacity-30 text-xs leading-none px-1"
                title="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === fields.length - 1}
                className="text-gray-400 hover:text-gray-900 disabled:opacity-30 text-xs leading-none px-1"
                title="Move down"
              >
                ▼
              </button>
            </div>
            <InlineText
              value={f.label}
              onCommit={(v) => v && run(() => pb.collection("custom_fields").update(f.id, { label: v }))}
              className="w-48"
            />
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{typeLabel(f.type)}</span>
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
            {f.source === "rentman" && <span className="text-xs text-gray-400">From Rentman</span>}
            <button onClick={() => remove(f)} className="text-gray-400 hover:text-red-500 text-base leading-none px-1" title="Delete">
              ×
            </button>
          </div>
        ))}
        {!isLoading && fields.length === 0 && <p className="text-sm text-gray-500">No custom fields yet.</p>}
        <form onSubmit={add} className="flex items-center gap-2 pt-3 mt-1 border-t border-gray-100 flex-wrap">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Test tag due" className="input py-1.5 w-48" />
          <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className="input py-1.5 w-auto">
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {type === "select" && (
            <input
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="Choices, separated by commas"
              className="input py-1.5 flex-1 min-w-40"
            />
          )}
          <button
            type="submit"
            disabled={!label.trim() || (type === "select" && splitOptions(options).length === 0)}
            className="btn-secondary py-1.5"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
