import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item } from "../lib/api";
import { useCategories, useCategoryPaths } from "../lib/catalog";
import { indexFolders, trail } from "../lib/folders";
import { buildItemLabelContext } from "../lib/labelSpec";
import { errorText } from "../lib/errors";
import { priceLabel } from "../lib/format";
import { useRole } from "../lib/roles";
import ItemForm from "../components/item/ItemForm";
import ItemDetails from "../components/item/ItemDetails";
import { useConfirm } from "../components/ConfirmProvider";
import SerialsSection from "../components/item/SerialsSection";
import LinksSection, { UsedIn } from "../components/item/LinksSection";
import HistorySection, { useItemHistory } from "../components/item/HistorySection";
import AvailabilityStrip, { freeNow, useItemTimeline } from "../components/AvailabilityStrip";
import ItemPhoto from "../components/item/ItemPhoto";
import PrintButton from "../components/PrintButton";
import NumberInput from "../components/NumberInput";
import { useToast } from "../components/ToastProvider";
import { useFollowOrg } from "../lib/org";
import { TabBar, useTab, type TabDef } from "../components/Tabs";

type Tab = "general" | "units" | "contents" | "accessories" | "history";
// Every tab any item can have; each item shows the ones that fit it.
const ALL_TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "units", label: "Units" },
  { key: "contents", label: "Contents" },
  { key: "accessories", label: "Accessories" },
  { key: "history", label: "History" },
];

export default function ItemDetail() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const paths = useCategoryPaths();
  const { data: categories = [] } = useCategories();
  const folders = useMemo(() => indexFolders(categories), [categories]);
  const [searchParams] = useSearchParams();
  const newInFolder = isNew ? (searchParams.get("folder") ?? "") : "";

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
  const { data: projects } = useItemHistory(isNew ? "" : id);
  const [requestedTab, openTab] = useTab(ALL_TABS);
  const [archiving, setArchiving] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();

  async function saved(next: Item) {
    queryClient.setQueryData(["item", next.id], next);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["items"] }),
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
    ]);
    if (isNew) navigate(`/inventory/${next.id}`, { replace: true });
  }

  // Deleting is only for items with no project history (never on a project,
  // never scanned): anything else is archived instead. The server refuses
  // it too; this just says so up front.
  const { data: history } = useQuery({
    queryKey: ["item-history", id],
    queryFn: async () => {
      const count = async (collection: string) =>
        (await pb.collection(collection).getList(1, 1, { filter: pb.filter("item = {:item}", { item: id }), skipTotal: false })).totalItems;
      const [lines, scans] = await Promise.all([count("job_lines"), count("scans")]);
      return { lines, scans };
    },
    enabled: !isNew,
  });
  const hasHistory = !!history && history.lines + history.scans > 0;

  async function remove() {
    if (!item) return;
    const kits = links.length;
    const parts = [
      serialCount > 0 && `its ${serialCount} unit${serialCount === 1 ? "" : "s"}`,
      kits > 0 && `its ${kits} kit or accessory link${kits === 1 ? "" : "s"}`,
    ].filter(Boolean);
    const ok = await confirm({
      title: "Delete item",
      message: `Delete ${item.name}${parts.length ? ` and ${parts.join(" and ")}` : ""}? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("items").delete(item.id);
      await queryClient.invalidateQueries({ queryKey: ["items"] });
      showToast("success", `Deleted ${item.name}`);
      navigate(item.category ? `/inventory?folder=${item.category}` : "/inventory", { replace: true });
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  // Archived items are hidden and can't go on new projects; restoring puts
  // them straight back. History and units are untouched either way.
  async function setArchived(archived: boolean) {
    if (!item) return;
    if (archived) {
      const ok = await confirm({
        title: "Archive item",
        message: `Archive ${item.name}? It's hidden from lists and can't be added to projects. Anything already booked keeps it, and you can restore it any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    setArchiving(true);
    try {
      await saved(await pb.collection("items").update<Item>(item.id, { archived }));
      showToast("success", archived ? "Archived" : "Restored");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setArchiving(false);
    }
  }

  if (isNew) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <Link to={newInFolder ? `/inventory?folder=${newInFolder}` : "/inventory"} className="text-sm text-gray-500 hover:text-gray-900 w-fit">
          ← {folders.byId.get(newInFolder)?.name ?? "Inventory"}
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">New item</h1>
        <section className="card p-4">
          <ItemForm item={null} defaultFolder={newInFolder} readOnly={false} hasSerials={false} onSaved={saved} />
        </section>
      </div>
    );
  }

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !item) return <p className="text-red-600 text-sm">Couldn't load this item: {error ? errorText(error) : "not found"}</p>;

  const categoryPath = paths.get(item.category) ?? "";
  const type = item.kind === "kit" ? "Kit" : item.tracking === "serial" ? "Serialised" : "Bulk";
  const serialised = item.kind === "item" && item.tracking === "serial";
  const tabs = ALL_TABS.filter((t) => t.key === "general" || t.key === "accessories" || t.key === "history" || (t.key === "units" ? serialised : item.kind === "kit")).map((t) => ({
    ...t,
    count:
      t.key === "units" ? serialCount : t.key === "contents" ? links.filter((l) => l.kind === "component").length : t.key === "accessories"
            ? links.filter((l) => l.kind === "accessory").length
            : t.key === "history"
              ? projects?.length
              : undefined,
  }));
  // A kit's link from when it was a serialised item, say: back to General.
  const tab = tabs.some((t) => t.key === requestedTab) ? requestedTab : "general";

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <Link to={item.category ? `/inventory?folder=${item.category}` : "/inventory"} className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← {folders.byId.get(item.category)?.name ?? "Inventory"}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <ItemPhoto item={item} canEdit={can("items.edit")} onSaved={saved} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {item.code && <span className="text-xl text-gray-400 font-mono">{item.code}</span>}
              <h1 className="text-xl font-semibold text-gray-900">{item.name}</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{type}</span>
            </div>
            <nav className="flex items-center gap-1 text-sm text-gray-500 flex-wrap" aria-label="Folder">
              <Link to="/inventory" className="hover:text-gray-900">
                Inventory
              </Link>
              {trail(folders, item.category).map((f) => (
                <span key={f.id} className="flex items-center gap-1">
                  <span className="text-gray-300">›</span>
                  <Link to={`/inventory?folder=${f.id}`} className="hover:text-gray-900">
                    {f.name}
                  </Link>
                </span>
              ))}
            </nav>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {can("items.edit") && !item.archived && (
            <button onClick={() => setArchived(true)} disabled={archiving} className="btn-secondary">
              Archive
            </button>
          )}
          {can("items.delete") && (
            <span
              title={
                hasHistory
                  ? `Used on ${history!.lines > 0 ? `${history!.lines} project line${history!.lines === 1 ? "" : "s"}` : "a project"}${history!.scans > 0 ? ` and scanned ${history!.scans} time${history!.scans === 1 ? "" : "s"}` : ""}, so it can't be deleted. Archive it instead`
                  : undefined
              }
            >
              <button onClick={remove} disabled={!history || hasHistory} className="btn-secondary hover:text-fault-ink disabled:opacity-40">
                Delete
              </button>
            </span>
          )}
          <PrintButton context={buildItemLabelContext(item, categoryPath)} label={item.tracking === "serial" ? "Print item label" : "Print label"} />
        </div>
      </div>

      {item.archived && (
        <div className="card bg-gray-50 px-4 py-2.5 text-sm text-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <span>Archived: hidden from lists and can't be added to projects.</span>
          {can("items.edit") && (
            <button onClick={() => setArchived(false)} disabled={archiving} className="btn-secondary py-1">
              Restore
            </button>
          )}
        </div>
      )}

      <TabBar label="Item sections" tabs={tabs} current={tab} onOpen={openTab} />

      {tab === "general" ? (
        // What people look for first across the top, then two stacked
        // columns (no gaps between cards of different heights). Each card
        // edits in place.
        <div className="flex flex-col gap-4">
          <KeyFacts item={item} />
          <ItemDetails item={item} categoryPath={categoryPath} canEdit={can("items.edit")} hasSerials={serialCount > 0} onSaved={saved}>
            {(cards) => (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
                <div className="flex flex-col gap-4 min-w-0">
                  <section className="card p-4">
                    <h2 className="eyebrow text-gray-500 mb-3">Availability, next 60 days</h2>
                    <AvailabilityStrip itemId={item.id} />
                  </section>
                  {cards.identification}
                </div>
                <div className="flex flex-col gap-4 min-w-0">
                  {cards.pricing}
                  {cards.warehouse}
                  {item.kind === "item" && item.tracking === "bulk" && can("units.flag") && <OutOfService item={item} onSaved={saved} />}
                  {cards.notes}
                  <UsedIn item={item} />
                </div>
              </div>
            )}
          </ItemDetails>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
            {tab === "units" && <SerialsSection item={item} categoryPath={categoryPath} canAdd={can("units.create")} />}
            {tab === "contents" && <LinksSection item={item} kind="component" canEdit={can("items.kits")} />}
            {tab === "accessories" && <LinksSection item={item} kind="accessory" canEdit={can("items.kits")} />}
            {tab === "history" && <HistorySection item={item} />}
          </div>
          <div className="flex flex-col gap-4">
            {item.kind === "item" && item.tracking === "bulk" && can("units.flag") && <OutOfService item={item} onSaved={saved} />}
            <UsedIn item={item} />
          </div>
        </div>
      )}
    </div>
  );
}

// The four things people open an item to check, before anything else.
function KeyFacts({ item }: { item: Item }) {
  const { data } = useItemTimeline(item.id);
  const free = freeNow(data);
  const stock = data?.stock ?? null;
  const booked = data?.bookings.length ?? null;
  const tile = (label: string, value: string, tone = "text-gray-900") => (
    <div className="card px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="eyebrow text-gray-500">{label}</span>
      <span className={`text-lg font-semibold truncate ${tone}`}>{value}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tile("Price", item.price > 0 ? priceLabel(item) : "—")}
      {tile("Free now", free === null ? "…" : stock !== null ? `${free} of ${stock}` : String(free), free !== null && free <= 0 ? "text-fault-ink" : "text-gray-900")}
      {tile("Booked, next 60 days", booked === null ? "…" : booked === 0 ? "Nothing" : `${booked} project${booked === 1 ? "" : "s"}`)}
      {tile("Location", item.kind === "kit" ? "Kit" : item.locationInWarehouse || "—")}
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
