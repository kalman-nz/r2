import { useState } from "react";
import type { CustomField } from "../lib/api";
import { customText } from "../lib/customFields";
import { errorText } from "../lib/errors";
import { DetailCard, DetailRow } from "./DetailCard";
import { CustomInput } from "./item/ItemDetails";
import { useToast } from "./ToastProvider";

// A project's, contact's or location's custom fields as a card that edits
// in place, like an item's. Nothing shows until the organisation has some.
export default function CustomFieldsCard({
  fields,
  values,
  canEdit,
  onSave,
}: {
  fields: CustomField[];
  values: Record<string, unknown> | null | undefined;
  canEdit: boolean;
  // Saves the whole `custom` object (other keys kept).
  onSave: (custom: Record<string, unknown>) => Promise<unknown>;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  if (fields.length === 0) return null;
  const current = values && typeof values === "object" ? values : {};

  async function save() {
    setSaving(true);
    try {
      await onSave({ ...current, ...draft });
      setEditing(false);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailCard
      title="Custom fields"
      editing={editing}
      canEdit={canEdit && !editing}
      saving={saving}
      onEdit={() => {
        setDraft({ ...current });
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={save}
    >
      {fields.map((f) => (
        <DetailRow key={f.id} label={f.label} value={customText(f, current[f.key]) || null}>
          <CustomInput field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        </DetailRow>
      ))}
    </DetailCard>
  );
}
