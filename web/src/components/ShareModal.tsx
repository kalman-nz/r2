import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Shared, type SharingInput } from "../lib/api";
import { errorText } from "../lib/errors";
import { useOrg } from "../lib/org";
import { useAuthRecord } from "../lib/pocketbase";
import Modal from "./Modal";
import Switch from "./Switch";
import { useToast } from "./ToastProvider";

// Sharing a dashboard or saved view (pb_hooks/lib/sharing.js): with the
// people you pick, or with everyone in the organisation, which only people
// allowed to publish (admins, to start with) can turn on or off.
export default function ShareModal({
  name,
  value,
  onSave,
  onClose,
}: {
  name: string;
  value: Pick<Shared, "public" | "sharedWith">;
  onSave: (sharing: SharingInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const { org, can } = useOrg();
  const me = useAuthRecord();
  const { showToast } = useToast();
  const [people, setPeople] = useState<string[]>(value.sharedWith.map((p) => p.id));
  const [everyone, setEveryone] = useState(value.public);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const mayPublish = can("views.publish");

  const { data: members = [] } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api.listMembers(org!.id),
    enabled: !!org,
  });
  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.userId, m.name || m.email]));
    for (const p of value.sharedWith) if (!map.has(p.id)) map.set(p.id, p.name);
    return map;
  }, [members, value.sharedWith]);
  const others = members.filter((m) => m.userId !== me?.id && !people.includes(m.userId));

  async function save() {
    setSaving(true);
    try {
      await onSave({ sharedWith: people, ...(everyone !== value.public ? { public: everyone } : {}) });
      showToast("success", everyone ? "Shared with everyone" : people.length > 0 ? `Shared with ${people.length} ${people.length === 1 ? "person" : "people"}` : "Only you can see it");
      onClose();
    } catch (err) {
      showToast("error", `Couldn't share it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Share “${name}”`} onClose={saving ? () => {} : onClose}>
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-gray-500">People</span>
        {people.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {people.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700">
                {nameOf.get(id) || "Someone"}
                <button onClick={() => setPeople((p) => p.filter((x) => x !== id))} className="w-4 h-4 rounded-full hover:bg-gray-300 leading-none" aria-label={`Stop sharing with ${nameOf.get(id)}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">{everyone ? "Everyone can see it." : "Only you can see it."}</p>
        )}
        {others.length > 0 && (
          <select
            value={adding}
            onChange={(e) => {
              if (e.target.value) setPeople((p) => [...p, e.target.value]);
              setAdding("");
            }}
            className="input py-1.5 w-auto"
          >
            <option value="">Add someone…</option>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-1 text-sm border-t border-gray-100 pt-3">
        <Switch label={`Everyone in ${org?.name ?? "the organisation"}`} checked={everyone} disabled={!mayPublish} onChange={setEveryone} />
        <span className="text-xs text-gray-500">
          {mayPublish ? "They can use it and copy it; only you can change it." : "Only people who can share with everyone (admins, to start with) can turn this on."}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
