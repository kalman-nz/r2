import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { Item, ItemComponent } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { InlineNumber } from "../InlineInput";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";
import { orgFilter, withOrg } from "../../lib/currentOrg";

type LinkRecord = ItemComponent & { expand?: { child?: Item; parent?: Item } };

const COPY = {
  component: {
    title: "Kit contents",
    hint: "Adding this kit to a job adds these lines with it. The kit is only as available as its scarcest part.",
    empty: "No contents yet — a kit with nothing in it can't go out.",
  },
  accessory: {
    title: "Accessories",
    hint: "Added automatically, per unit, whenever this goes on a job (e.g. a stand and cable with each speaker). Free unless marked chargeable.",
    empty: "No accessories.",
  },
};

// Kit contents ("component") and accessories share one table
// (item_components); the server checks the rules (no nested kits, only
// kits have contents).
export default function LinksSection({ item, kind, canEdit }: { item: Item; kind: "component" | "accessory"; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [childId, setChildId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [chargeable, setChargeable] = useState(false);
  const queryKey = ["item_components", item.id, kind];

  const { data: links = [] } = useQuery({
    queryKey,
    queryFn: () =>
      pb.collection("item_components").getFullList<LinkRecord>({
        filter: pb.filter("parent = {:parent} && kind = {:kind}", { parent: item.id, kind }),
        sort: "sortOrder,created",
        expand: "child",
      }),
  });
  const { data: candidates = [] } = useQuery({
    queryKey: ["items", "active"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter("archived = false"), sort: "name" }),
    enabled: canEdit,
  });

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term || childId) return [];
    const taken = new Set(links.map((l) => l.child));
    return candidates
      .filter((c) => c.kind === "item" && c.id !== item.id && !taken.has(c.id))
      .filter((c) => [c.name, c.code].some((v) => v.toLowerCase().includes(term)))
      .slice(0, 8);
  }, [search, childId, candidates, links, item.id]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["item_components", item.id] }),
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
    ]);

  async function add() {
    try {
      await pb.collection("item_components").create(
        withOrg({
          parent: item.id,
          child: childId,
          kind,
          quantity,
          chargeable: kind === "accessory" && chargeable,
          sortOrder: (links.length + 1) * 10,
        }),
      );
      await refresh();
      setSearch("");
      setChildId("");
      setQuantity(1);
      setChargeable(false);
    } catch (err) {
      showToast("error", `Couldn't add: ${errorText(err)}`);
    }
  }

  async function update(link: LinkRecord, data: Partial<ItemComponent>) {
    try {
      await pb.collection("item_components").update(link.id, data);
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    }
  }

  async function remove(link: LinkRecord) {
    try {
      await pb.collection("item_components").delete(link.id);
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't remove: ${errorText(err)}`);
    }
  }

  const copy = COPY[kind];

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-500">{copy.title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{copy.hint}</p>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-gray-500">{copy.empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-md">
          {links.map((link) => (
            <div key={link.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <Link to={`/inventory/${link.child}`} className="flex-1 min-w-0 truncate hover:underline">
                {link.expand?.child?.name ?? "(deleted item)"}
              </Link>
              {kind === "accessory" && (
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={link.chargeable}
                    disabled={!canEdit}
                    onChange={(e) => update(link, { chargeable: e.target.checked })}
                  />
                  Chargeable
                </label>
              )}
              <span className="text-gray-400 text-xs">×</span>
              {canEdit ? (
                <InlineNumber value={link.quantity} min={1} step={1} onCommit={(q) => update(link, { quantity: Math.round(q) })} className="w-16" />
              ) : (
                <span className="tabular-nums">{link.quantity}</span>
              )}
              {canEdit && (
                <button onClick={() => remove(link)} className="text-gray-400 hover:text-red-500 text-base leading-none px-1" title="Remove">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex items-start gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setChildId("");
              }}
              placeholder={kind === "component" ? "Add an item to the kit…" : "Add an accessory…"}
              className="input py-1.5 w-full"
            />
            {matches.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 card shadow-lg z-20 py-1">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setChildId(m.id);
                      setSearch(m.name);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {m.name}
                    {m.code && <span className="text-gray-400 font-mono text-xs ml-1.5">{m.code}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <NumberInput value={quantity} min={1} onChange={(n) => setQuantity(Math.max(1, Math.round(n)))} className="input w-16 py-1.5" />
          {kind === "accessory" && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 py-2">
              <input type="checkbox" checked={chargeable} onChange={(e) => setChargeable(e.target.checked)} />
              Chargeable
            </label>
          )}
          <button onClick={add} disabled={!childId} className="btn-secondary py-1.5">
            Add
          </button>
        </div>
      )}
    </section>
  );
}

// Where this item is used: inside kits, or as another item's accessory.
export function UsedIn({ item }: { item: Item }) {
  const { data: links = [] } = useQuery({
    queryKey: ["item_components", "child", item.id],
    queryFn: () =>
      pb.collection("item_components").getFullList<LinkRecord>({
        filter: pb.filter("child = {:child}", { child: item.id }),
        expand: "parent",
      }),
  });
  if (links.length === 0) return null;
  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <h2 className="text-sm font-semibold text-gray-500">Used in</h2>
      {links.map((l) => (
        <Link key={l.id} to={`/inventory/${l.parent}`} className="flex items-center justify-between gap-2 hover:underline">
          <span className="truncate">{l.expand?.parent?.name ?? "(deleted item)"}</span>
          <span className="text-xs text-gray-500 shrink-0">
            {l.kind === "component" ? "kit contents" : "accessory"} × {l.quantity}
          </span>
        </Link>
      ))}
    </section>
  );
}
