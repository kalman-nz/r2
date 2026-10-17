import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type Item } from "../lib/api";
import { displayPath, useCategories, useCategoryPaths } from "../lib/catalog";
import { nzd } from "../lib/format";
import { errorText } from "../lib/errors";
import Modal from "./Modal";
import NumberInput from "./NumberInput";
import { useToast } from "./ToastProvider";
import { orgFilter } from "../lib/currentOrg";

const SHOWN = 80;

// Adding inventory to a job. Availability comes from the server for the
// job's own prep→return window, excluding the job itself, so "free" means
// "free for this job" and kits show how many complete kits their
// components allow.
export default function ItemPicker({
  jobId,
  start,
  end,
  onAdd,
  onClose,
}: {
  jobId: string;
  start: string;
  end: string;
  onAdd: (itemId: string, quantity: number) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { data: categories = [] } = useCategories();
  const paths = useCategoryPaths();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["items", "active"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter("archived = false"), sort: "name" }),
  });
  const { data: availability } = useQuery({
    queryKey: ["availability", jobId, start, end],
    queryFn: () => api.availability(start, end, jobId),
    enabled: Boolean(start && end),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Picking a category includes everything underneath it.
    const categoryPath = categoryId ? paths.get(categoryId) : null;
    return items.filter((item) => {
      if (categoryPath) {
        const path = paths.get(item.category) ?? "";
        if (path !== categoryPath && !path.startsWith(categoryPath + "/")) return false;
      }
      if (!term) return true;
      return [item.name, item.code, item.barcode, paths.get(item.category)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, search, categoryId, paths]);

  async function add(item: Item) {
    const quantity = quantities[item.id] ?? 1;
    setBusyId(item.id);
    try {
      await onAdd(item.id, quantity);
      showToast("success", `Added ${quantity} × ${item.name}`);
      setQuantities((prev) => ({ ...prev, [item.id]: 1 }));
    } catch (err) {
      showToast("error", `Couldn't add ${item.name}: ${errorText(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Add equipment" onClose={onClose} wide>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) add(filtered[0]);
          }}
          placeholder="Search name, code, barcode, tag…"
          className="input flex-1 min-w-48"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input w-auto max-w-56">
          <option value="">All categories</option>
          {categories
            .map((c) => ({ id: c.id, path: paths.get(c.id) ?? c.name }))
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {displayPath(c.path)}
              </option>
            ))}
        </select>
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        "Free" is for this project's dates, with this project's own kit left out. Enter adds the top result.
      </p>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}

      <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-md">
        {filtered.slice(0, SHOWN).map((item) => {
          const a = availability?.[item.id];
          const qty = quantities[item.id] ?? 1;
          const short = a ? a.free < qty : false;
          return (
            <div key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-gray-900 truncate">{item.name}</span>
                  {item.kind === "kit" && (
                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Kit</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {[item.code, displayPath(paths.get(item.category)), item.dayRate ? `${nzd(item.dayRate)}/day` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className={`text-xs tabular-nums text-right w-28 shrink-0 ${short ? "text-fault-ink font-medium" : "text-gray-600"}`}>
                {a ? (
                  <>
                    {a.free} free
                    {a.stock !== null && <span className="text-gray-400 font-normal"> of {a.stock}</span>}
                  </>
                ) : (
                  "…"
                )}
              </div>
              <NumberInput
                value={qty}
                min={1}
                onChange={(n) => setQuantities((prev) => ({ ...prev, [item.id]: n }))}
                className="input w-16 py-1 text-right"
              />
              <button onClick={() => add(item)} disabled={busyId !== null} className="btn-secondary py-1 shrink-0">
                {busyId === item.id ? "Adding…" : "Add"}
              </button>
            </div>
          );
        })}
        {!isLoading && filtered.length === 0 && <p className="px-3 py-6 text-sm text-gray-500 text-center">Nothing matches.</p>}
      </div>
      {filtered.length > SHOWN && (
        <p className="text-xs text-gray-500">Showing the first {SHOWN} of {filtered.length} — search to narrow it down.</p>
      )}
      <div className="flex justify-end">
        <button onClick={onClose} className="btn-secondary">
          Done
        </button>
      </div>
    </Modal>
  );
}
