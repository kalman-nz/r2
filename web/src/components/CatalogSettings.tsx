import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { useLocations } from "../lib/catalog";
import { errorText } from "../lib/errors";
import AddressInput from "./AddressInput";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { withOrg } from "../lib/currentOrg";
import { useCan } from "../lib/roles";

// Settings > Storage locations: where stock and units are kept.
// (Inventory folders are managed on the Inventory page itself.)
export default function CatalogSettings() {
  return <Locations />;
}

function Locations() {
  const can = useCan();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: locations = [] } = useLocations();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["locations"] });

  async function save(id: string | null, data: { name?: string; address?: string }) {
    try {
      if (id) await pb.collection("locations").update(id, data);
      else await pb.collection("locations").create(withOrg(data));
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    }
  }

  async function remove(id: string, locationName: string) {
    const ok = await confirm({
      title: "Delete location",
      message: `Delete "${locationName}"? Anything kept there has to be moved somewhere else first.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("locations").delete(id);
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Storage locations</h2>
      </div>
      <div className="card p-4 flex flex-col gap-2">
        {locations.map((l) => (
          <LocationRow key={l.id} location={l} canEdit={can("locations.edit")} canDelete={can("locations.delete")} onSave={(data) => save(l.id, data)} onRemove={() => remove(l.id, l.name)} />
        ))}
        {locations.length === 0 && <p className="text-sm text-gray-500">No locations yet.</p>}
        {can("locations.create") && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await save(null, { name: name.trim(), address: address.trim() });
              setName("");
              setAddress("");
            }}
            className="flex items-start gap-2 pt-3 mt-1 border-t border-gray-100 flex-wrap"
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Main warehouse" className="input py-1.5 w-48" />
            <div className="flex-1 min-w-48">
              <AddressInput value={address} onChange={setAddress} rows={2} />
            </div>
            <button type="submit" disabled={!name.trim()} className="btn-secondary py-1.5">
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// One storage location: its name and its address (looked up as you type),
// saved when you say.
function LocationRow({
  location,
  canEdit,
  canDelete,
  onSave,
  onRemove,
}: {
  location: { id: string; name: string; address: string };
  canEdit: boolean;
  canDelete: boolean;
  onSave: (data: { name: string; address: string }) => Promise<void>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(location.name);
    setAddress(location.address);
  }, [location.name, location.address]);
  const dirty = name.trim() !== location.name || address.trim() !== (location.address ?? "");
  return (
    <div className="flex items-start gap-2 flex-wrap py-1">
      <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="input py-1.5 w-48" aria-label="Name" />
      <div className="flex-1 min-w-48">
        <AddressInput value={address} onChange={setAddress} disabled={!canEdit} rows={2} />
      </div>
      {canEdit && dirty && (
        <button
          onClick={async () => {
            if (!name.trim()) return;
            setSaving(true);
            await onSave({ name: name.trim(), address: address.trim() });
            setSaving(false);
          }}
          disabled={saving || !name.trim()}
          className="btn-primary py-1.5"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      {canDelete && (
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500 text-base leading-none px-1 pt-2" title="Delete">
          ×
        </button>
      )}
    </div>
  );
}
