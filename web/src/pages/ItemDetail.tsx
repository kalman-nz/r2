import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item } from "../lib/api";
import { displayPath, useCategoryPaths } from "../lib/catalog";
import { buildItemLabelContext } from "../lib/labelSpec";
import { errorText } from "../lib/errors";
import { useRole } from "../lib/roles";
import ItemForm from "../components/item/ItemForm";
import SerialsSection from "../components/item/SerialsSection";
import LinksSection, { UsedIn } from "../components/item/LinksSection";
import AvailabilityStrip from "../components/AvailabilityStrip";
import PrintButton from "../components/PrintButton";
import NumberInput from "../components/NumberInput";
import { useToast } from "../components/ToastProvider";
import { useFollowOrg } from "../lib/org";
import { TabBar, useTab, type TabDef } from "../components/Tabs";

type Tab = "general" | "units" | "contents" | "accessories";
// Every tab any item can have; each item shows the ones that fit it.
const ALL_TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "units", label: "Units" },
  { key: "contents", label: "Contents" },
  { key: "accessories", label: "Accessories" },
];

export default function ItemDetail() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const paths = useCategoryPaths();

  const { data: item, isLoading, error } = useQuery({
    queryKey: ["item", id],
    queryFn: () => pb.collection("items").getOne<Item>(id),
    enabled: !isNew,
  });
  useFollowOrg(item?.org);
  const { data: serialCount = 0 } = useQuery({
    queryKey: ["serials", id, "count"],
    queryFn: async () =>
      (await pb.collection("serials").getList(1, 1, { filter: pb.filter("item = {:item}", { item: id }), skipTotal: false })).totalItems,
    enabled: !isNew,
  });
  // For the tab counts. Same key prefix LinksSection refreshes.
  const { data: links = [] } = useQuery({
    queryKey: ["item_components", id, "counts"],
    queryFn: () => pb.collection("item_components").getFullList<{ kind: string }>({ filter: pb.filter("parent = {:id}", { id }), fields: "kind" }),
    enabled: !isNew,
  });
  const [requestedTab, openTab] = useTab(ALL_TABS);

  async function saved(next: Item) {
    queryClient.setQueryData(["item", next.id], next);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items"] }),
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
    ]);
    if (isNew) navigate(`/inventory/${next.id}`, { replace: true });
  }

  if (isNew) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <Link to="/inventory" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
          ← Inventory
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">New item</h1>
        <section className="card p-4">
          <ItemForm item={null} readOnly={false} hasSerials={false} onSaved={saved} />
        </section>
      </div>
    );
  }

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !item) return <p className="text-red-600 text-sm">Couldn't load this item: {error ? errorText(error) : "not found"}</p>;

  const categoryPath = paths.get(item.category) ?? "";
  const type = item.kind === "kit" ? "Kit" : item.tracking === "serial" ? "Serialised" : "Bulk";
  const serialised = item.kind === "item" && item.tracking === "serial";
  const tabs = ALL_TABS.filter((t) => t.key === "general" || t.key === "accessories" || (t.key === "units" ? serialised : item.kind === "kit")).map((t) => ({
    ...t,
    count:
      t.key === "units" ? serialCount : t.key === "contents" ? links.filter((l) => l.kind === "component").length : t.key === "accessories" ? links.filter((l) => l.kind === "accessory").length : undefined,
  }));
  // A kit's link from when it was a serialised item, say: back to General.
  const tab = tabs.some((t) => t.key === requestedTab) ? requestedTab : "general";

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <Link to="/inventory" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Inventory
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {item.photo && (
            <img src={pb.files.getURL(item, item.photo, { thumb: "100x100" })} alt="" className="w-12 h-12 rounded-md object-cover border border-gray-200" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">{item.name}</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{type}</span>
              {item.archived && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Archived</span>}
            </div>
            <p className="text-sm text-gray-500">{[item.code, displayPath(categoryPath)].filter(Boolean).join(" · ") || "Uncategorised"}</p>
          </div>
        </div>
        <PrintButton context={buildItemLabelContext(item, categoryPath)} label={item.tracking === "serial" ? "Print item label" : "Print label"} />
      </div>

      <TabBar label="Item sections" tabs={tabs} current={tab} onOpen={openTab} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
          {tab === "general" && (
            <>
              <section className="card p-4">
                <h2 className="text-sm font-semibold text-gray-500 mb-3">Details</h2>
                <ItemForm item={item} readOnly={!can("items.edit")} hasSerials={serialCount > 0} onSaved={saved} />
              </section>
              <section className="card p-4">
                <h2 className="text-sm font-semibold text-gray-500 mb-3">Availability, next 60 days</h2>
                <AvailabilityStrip itemId={item.id} />
              </section>
            </>
          )}
          {tab === "units" && <SerialsSection item={item} categoryPath={categoryPath} canAdd={can("units.create")} />}
          {tab === "contents" && <LinksSection item={item} kind="component" canEdit={can("items.kits")} />}
          {tab === "accessories" && <LinksSection item={item} kind="accessory" canEdit={can("items.kits")} />}
        </div>

        <div className="flex flex-col gap-4">
          {item.kind === "item" && item.tracking === "bulk" && can("units.flag") && <OutOfService item={item} onSaved={saved} />}
          <UsedIn item={item} />
          {item.kind === "item" && item.tracking === "serial" && (
            <section className="card p-4 text-xs text-gray-500">
              Flag a unit as broken or lost from its own page — open it from the list, or scan its barcode in the search box.
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// Bulk stock can't be flagged unit by unit, so anyone with units.flag can
// set how many are out of service. They stop counting as stock straight away.
function OutOfService({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  const [quantity, setQuantity] = useState(item.outOfServiceQty);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.setOutOfService(item.id, quantity, note));
      setNote("");
      showToast("success", "Updated");
    } catch (err) {
      showToast("error", `Couldn't update: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-3 text-sm">
      <div>
        <h2 className="text-sm font-semibold text-gray-500">Stock</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {item.stockQty - item.outOfServiceQty} of {item.stockQty} usable
        </p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-gray-500">Out of service (broken, away for repair)</span>
        <NumberInput value={quantity} min={0} max={item.stockQty} onChange={(n) => setQuantity(Math.round(n))} className="input py-1.5 w-24" />
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong? (optional)" className="input py-1.5" />
      <button onClick={save} disabled={saving || quantity === item.outOfServiceQty} className="btn-secondary w-fit">
        {saving ? "Saving…" : "Update"}
      </button>
    </section>
  );
}
