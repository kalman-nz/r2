import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { useLocations } from "../lib/catalog";
import { errorText } from "../lib/errors";
import { InlineText } from "./InlineInput";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { withOrg } from "../lib/currentOrg";
import { useCan } from "../lib/roles";

// Settings > Storage locations: where units live in the warehouse.
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
      message: `Delete "${locationName}"? Units there will have no location set.`,
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
        <p className="text-xs text-gray-500 mt-0.5">Warehouses or stores where units live. With only one, new units go there automatically.</p>
      </div>
      <div className="card p-4 flex flex-col gap-2">
        {locations.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <InlineText value={l.name} onCommit={(v) => v && save(l.id, { name: v })} disabled={!can("locations.edit")} className="w-48" />
            <InlineText
              value={l.address}
              onCommit={(v) => save(l.id, { address: v })}
              disabled={!can("locations.edit")}
              placeholder="Address"
              className="flex-1"
            />
            {can("locations.delete") && (
              <button onClick={() => remove(l.id, l.name)} className="text-gray-400 hover:text-red-500 text-base leading-none px-1" title="Delete">
                ×
              </button>
            )}
          </div>
        ))}
        {locations.length === 0 && <p className="text-sm text-gray-500">No locations yet.</p>}
        {can("locations.create") && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await save(null, { name: name.trim() });
              setName("");
            }}
            className="flex items-center gap-2 pt-3 mt-1 border-t border-gray-100"
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main warehouse" className="input py-1.5 max-w-xs flex-1" />
            <button type="submit" disabled={!name.trim()} className="btn-secondary py-1.5">
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
