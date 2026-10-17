import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { Category } from "../lib/api";
import { useCategories, useCategoryPaths, useLocations } from "../lib/catalog";
import { errorText } from "../lib/errors";
import { InlineText } from "./InlineInput";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";
import { withOrg } from "../lib/currentOrg";
import { useCan } from "../lib/roles";

// Settings > Inventory: the category tree items are filed under (and that
// job lines take their default quote heading from — the top level), and
// the stock locations units live in.
export default function CatalogSettings() {
  return (
    <div className="flex flex-col gap-8">
      <Categories />
      <Locations />
    </div>
  );
}

function Categories() {
  const can = useCan();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: categories = [], isLoading } = useCategories();
  const paths = useCategoryPaths();
  const [newName, setNewName] = useState("");
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [childName, setChildName] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories"] });

  async function create(name: string, parent: string) {
    if (!name.trim()) return;
    try {
      await pb.collection("categories").create(withOrg({ name: name.trim(), parent }));
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't add: ${errorText(err)}`);
    }
  }

  async function rename(category: Category, name: string) {
    if (!name) return;
    try {
      await pb.collection("categories").update(category.id, { name });
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't rename: ${errorText(err)}`);
    }
  }

  async function remove(category: Category) {
    const children = categories.filter((c) => c.parent === category.id).length;
    const ok = await confirm({
      title: "Delete category",
      message: `Delete "${category.name}"? Items in it become uncategorised${
        children ? `, and its ${children} sub-categor${children === 1 ? "y moves" : "ies move"} to the top level` : ""
      }.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("categories").delete(category.id);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["items"] })]);
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  const ordered = categories
    .map((c) => ({ category: c, path: paths.get(c.id) ?? c.name }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Categories</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          A tree, e.g. Audio → Speakers. The top level is the heading equipment sits under on quotes.
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-1">
        {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
        {ordered.map(({ category, path }) => {
          const depth = path.split("/").length - 1;
          return (
            <div key={category.id} className="flex flex-col">
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
                {depth > 0 && <span className="text-gray-300">↳</span>}
                <InlineText
                  value={category.name}
                  onCommit={(name) => rename(category, name)}
                  disabled={!can("categories.edit")}
                  className="flex-1 max-w-xs"
                />
                {can("categories.create") && (
                  <button
                    onClick={() => {
                      setAddingUnder(category.id);
                      setChildName("");
                    }}
                    className="text-xs text-[#167cfb] hover:text-[#0f6ae0]"
                  >
                    + Sub-category
                  </button>
                )}
                {can("categories.delete") && (
                  <button onClick={() => remove(category)} className="text-gray-400 hover:text-red-500 text-base leading-none px-1" title="Delete">
                    ×
                  </button>
                )}
              </div>
              {addingUnder === category.id && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await create(childName, category.id);
                    setAddingUnder(null);
                  }}
                  className="flex items-center gap-2 mt-1"
                  style={{ paddingLeft: (depth + 1) * 20 }}
                >
                  <input autoFocus value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="Name" className="input py-1 max-w-xs" />
                  <button type="submit" className="btn-secondary py-1">
                    Add
                  </button>
                  <button type="button" onClick={() => setAddingUnder(null)} className="text-xs text-gray-500">
                    Cancel
                  </button>
                </form>
              )}
            </div>
          );
        })}
        {!isLoading && categories.length === 0 && <p className="text-sm text-gray-500">No categories yet.</p>}
        {can("categories.create") && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await create(newName, "");
              setNewName("");
            }}
            className="flex items-center gap-2 pt-3 mt-2 border-t border-gray-100"
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New top-level category, e.g. Lighting" className="input py-1.5 max-w-xs flex-1" />
            <button type="submit" disabled={!newName.trim()} className="btn-secondary py-1.5">
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
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
        <h2 className="text-sm font-semibold text-gray-900">Stock locations</h2>
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
