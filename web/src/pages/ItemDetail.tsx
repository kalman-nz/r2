import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item, type Serial } from "../lib/api";
import { useCategoryPaths, useLocations } from "../lib/catalog";
import { buildItemLabelContext } from "../lib/labelSpec";
import { errorText } from "../lib/errors";
import { priceLabel } from "../lib/format";
import { useFeature, useRole } from "../lib/roles";
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
import NewRepairModal from "../components/repair/NewRepairModal";
import MaintenanceSection from "../components/item/MaintenanceSection";
import StockLocations from "../components/item/StockLocations";
import { placesText, unitPlaces, useItemStock } from "../lib/stock";
import { invalidateMaintenance } from "../lib/maintenance";
import Breadcrumbs, { useFolderCrumbs } from "../components/Breadcrumbs";

type Tab = "general" | "units" | "contents" | "accessories" | "maintenance" | "history";
// Every tab any item can have; each item shows the ones that fit it.
const ALL_TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "units", label: "Units" },
  { key: "contents", label: "Contents" },
  // Accessories (LinksSection kind="accessory") are hidden until they're ready.
  { key: "maintenance", label: "Maintenance" },
  { key: "history", label: "History" },
];

export default function ItemDetail() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const feature = useFeature();
  const paths = useCategoryPaths();
  const [searchParams] = useSearchParams();
  const newInFolder = isNew ? (searchParams.get("folder") ?? "") : "";

  const { data: item, isLoading, error } = useQuery({
    queryKey: ["item", id],
    queryFn: () => pb.collection("items").getOne<Item>(id),
    enabled: !isNew,
  });
  useFollowOrg(item?.org);
  const folderCrumbs = useFolderCrumbs(isNew ? newInFolder : (item?.category ?? ""));
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
  const { data: projects } = useItemHistory(isNew || !feature("projects") ? "" : id);
  // For a bulk label: the shelf its stock is on, when there's just one.
  const { data: stockRows = [] } = useItemStock(id, !isNew);
  const bins = [...new Set(stockRows.filter((r) => r.qty > 0).map((r) => r.bin).filter(Boolean))];
  const [requestedTab, openTab] = useTab(ALL_TABS);
  const [archiving, setArchiving] = useState(false);
  const [repairing, setRepairing] = useState(false);
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
      const count = async (collection: string, extra = "") =>
        (await pb.collection(collection).getList(1, 1, { filter: pb.filter("item = {:item}", { item: id }) + extra, skipTotal: false })).totalItems;
      const [lines, scans, repairs, maintenance] = await Promise.all([
        count("job_lines"),
        count("scans"),
        count("repairs"),
        count("maintenance_jobs", " && status = 'done'"),
      ]);
      return { lines, scans, repairs, maintenance };
    },
    enabled: !isNew,
  });
  const hasHistory = !!history && history.lines + history.scans + history.repairs + history.maintenance > 0;

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
        <Breadcrumbs crumbs={[...folderCrumbs, { label: "New item" }]} />
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
  const serialised = item.kind === "item" && item.tracking === "serial";
  const tabs = ALL_TABS.filter(
    (t) =>
      t.key === "general" ||
      // Which projects it's been on.
      (t.key === "history" && feature("projects")) ||
      (t.key === "maintenance"
        ? item.kind === "item" && (feature("repairs") || feature("maintenance"))
        : t.key === "units"
          ? serialised
          : item.kind === "kit"),
  ).map((t) => ({
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
      <Breadcrumbs crumbs={[...folderCrumbs, { label: item.name }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <ItemPhoto item={item} canEdit={can("items.edit")} onSaved={saved} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {item.code && <span className="text-xl text-gray-400 font-mono">{item.code}</span>}
              <h1 className="text-xl font-semibold text-gray-900">{item.name}</h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {item.kind === "item" && can("units.flag") && feature("repairs") && (
            <button onClick={() => setRepairing(true)} className="btn-secondary">
              Create repair
            </button>
          )}
          <PrintButton context={buildItemLabelContext(item, categoryPath, bins.length === 1 ? bins[0] : "")} label="Print bulk label" />
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

      {repairing && (
        <NewRepairModal
          item={item}
          onClose={() => setRepairing(false)}
          onCreated={async (repair) => {
            setRepairing(false);
            await invalidateMaintenance(queryClient);
            showToast("success", `Opened repair R${repair.number}`);
          }}
        />
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
                  {feature("projects") && (
                    <section className="card p-4">
                      <h2 className="eyebrow text-gray-500 mb-3">Availability, next 60 days</h2>
                      <AvailabilityStrip itemId={item.id} />
                    </section>
                  )}
                  {cards.identification}
                </div>
                <div className="flex flex-col gap-4 min-w-0">
                  {item.kind === "item" && <StockLocations item={item} canEdit={can("items.edit")} onSaved={saved} />}
                  {cards.pricing}
                  {cards.warehouse}
                  {item.kind === "item" && item.tracking === "bulk" && can("units.flag") && <OutOfService item={item} onSaved={saved} />}
                  {cards.notes}
                  {cards.custom}
                  <UsedIn item={item} />
                </div>
              </div>
            )}
          </ItemDetails>
          {(can("items.edit") || can("items.delete")) && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              {can("items.edit") && !item.archived && (
                <button onClick={() => setArchived(true)} disabled={archiving} className="btn-secondary">
                  Archive
                </button>
              )}
              {can("items.delete") && (
                <span
                  title={
                    hasHistory
                      ? history!.lines + history!.scans > 0
                        ? `Used on ${history!.lines > 0 ? `${history!.lines} project line${history!.lines === 1 ? "" : "s"}` : "a project"}${history!.scans > 0 ? ` and scanned ${history!.scans} time${history!.scans === 1 ? "" : "s"}` : ""}, so it can't be deleted. Archive it instead`
                        : "It has repairs or maintenance on record, so it can't be deleted. Archive it instead"
                      : undefined
                  }
                >
                  <button onClick={remove} disabled={!history || hasHistory} className="btn-secondary hover:text-fault-ink disabled:opacity-40 disabled:pointer-events-none">
                    Delete
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        // Full width: the side cards (stock, used in) live on General.
        <div className="flex flex-col gap-4 min-w-0">
          {tab === "units" && <SerialsSection item={item} categoryPath={categoryPath} canAdd={can("units.create")} />}
          {tab === "contents" && <LinksSection item={item} kind="component" canEdit={can("items.kits")} />}
          {tab === "accessories" && <LinksSection item={item} kind="accessory" canEdit={can("items.kits")} />}
          {tab === "history" && <HistorySection item={item} />}
          {tab === "maintenance" && <MaintenanceSection item={item} canRecord={can("units.flag")} />}
        </div>
      )}
    </div>
  );
}

// The four things people open an item to check, before anything else.
function KeyFacts({ item }: { item: Item }) {
  const feature = useFeature();
  const { data } = useItemTimeline(item.id);
  const free = freeNow(data);
  const stock = data?.stock ?? null;
  const booked = data?.bookings.length ?? null;
  const where = useWhere(item);
  const tile = (label: string, value: string, tone = "text-gray-900") => (
    <div className="card px-4 py-3 flex flex-col gap-0.5 min-w-0">
      <span className="eyebrow text-gray-500">{label}</span>
      <span className={`text-lg font-semibold truncate ${tone}`}>{value}</span>
    </div>
  );
  return (
    <div className={`grid grid-cols-2 gap-4 ${["lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"][Number(feature("pricing")) + Number(feature("projects"))]}`}>
      {feature("pricing") && tile("Price", item.price > 0 ? priceLabel(item) : "—")}
      {/* Without projects nothing's booked: what's free is what's in service. */}
      {tile(
        feature("projects") ? "Free now" : "In service",
        free === null ? "…" : stock !== null ? `${free} of ${stock}` : String(free),
        free !== null && free <= 0 ? "text-fault-ink" : "text-gray-900",
      )}
      {feature("projects") &&
        tile("Booked, next 60 days", booked === null ? "…" : booked === 0 ? "Nothing" : `${booked} project${booked === 1 ? "" : "s"}`)}
      {tile("Location", item.kind === "kit" ? "Kit" : where || "—")}
    </div>
  );
}

// Where it's kept, in a few words: one place, or how many places.
function useWhere(item: Item): string {
  const { data: locations = [] } = useLocations();
  const serialised = item.kind === "item" && item.tracking === "serial";
  const { data: stock = [] } = useItemStock(item.id, item.kind === "item" && !serialised);
  const { data: units = [] } = useQuery({
    queryKey: ["serials", item.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item.id }), sort: "barcode" }),
    enabled: serialised,
  });
  const places = (serialised ? unitPlaces(units) : stock.map((s) => ({ location: s.location, bin: s.bin, qty: s.qty }))).filter((p) => p.qty > 0);
  const located = new Set(places.map((p) => p.location).filter(Boolean));
  if (located.size > 1) return `${located.size} locations`;
  return placesText(places, (id) => locations.find((l) => l.id === id)?.name ?? "");
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
