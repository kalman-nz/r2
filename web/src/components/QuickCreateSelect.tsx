import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";
import { withOrg } from "../lib/currentOrg";

// A dropdown of contacts or venues with a "+ New" that creates one by name
// right there, so setting up a job never means leaving it half-filled.
// Fuller details can be added on the contact/venue's own page later.
export default function QuickCreateSelect({
  collection,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  canCreate = true,
}: {
  collection: "contacts" | "venues";
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string; archived?: boolean }[];
  disabled?: boolean;
  placeholder: string;
  canCreate?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const record = await pb.collection(collection).create(withOrg({ name: trimmed }));
      await queryClient.invalidateQueries({ queryKey: [collection] });
      onChange(record.id);
      setCreating(false);
      setName("");
    } catch (err) {
      showToast("error", `Couldn't create: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder={collection === "contacts" ? "New client name" : "New location name"}
          className="input flex-1 min-w-0"
        />
        <button type="button" onClick={create} disabled={saving || !name.trim()} className="btn-primary py-1.5">
          {saving ? "…" : "Add"}
        </button>
        <button type="button" onClick={() => setCreating(false)} className="btn-secondary py-1.5">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="input flex-1 min-w-0">
        <option value="">{placeholder}</option>
        {options
          .filter((o) => !o.archived || o.id === value)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
      </select>
      {canCreate && !disabled && (
        <button type="button" onClick={() => setCreating(true)} className="btn-secondary py-1.5 shrink-0" title="Create new">
          + New
        </button>
      )}
    </div>
  );
}
