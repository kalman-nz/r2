import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type SerialNumber } from "../lib/api";
import { money, num } from "../lib/format";
import { buildEquipmentLabelContext } from "../lib/labelSpec";
import { renderAssetLabelImage, sendRenderedLabel } from "../lib/print";
import BatchPrintBar from "../components/BatchPrintBar";
import PrintButton from "../components/PrintButton";
import RefreshButton from "../components/RefreshButton";

type SortKey = "name" | "location" | "status" | "inspection";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export default function EquipmentDetail() {
  const { id = "" } = useParams();
  const { data: equipment, isLoading, error } = useQuery({
    queryKey: ["equipment", id],
    queryFn: () => api.getEquipment(id),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggle(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  }

  const serials = useMemo(() => equipment?.serialNumbers ?? [], [equipment]);

  const filteredSerials = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = serials.filter((sn) => !term || JSON.stringify(sn).toLowerCase().includes(term));

    const dir = sortDir === "asc" ? 1 : -1;
    const sortValue = (sn: SerialNumber): string | number => {
      switch (sortKey) {
        case "location":
          return ((sn._location?.displayname as string) ?? sn.asset_location ?? "").toLowerCase();
        case "status":
          return sn.active ? 1 : 0;
        case "inspection":
          return sn.next_inspection ? new Date(sn.next_inspection).getTime() : 0;
        default:
          return (sn.displayname ?? "").toLowerCase();
      }
    };
    result = [...result].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return result;
  }, [serials, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filteredSerials.length ? new Set() : new Set(filteredSerials.map((sn) => String(sn.id))),
    );
  }

  const selectedAssets = filteredSerials.filter((sn) => selected.has(String(sn.id)));

  const lowStock =
    !!equipment && equipment.critical_stock_level > 0 && (equipment.current_quantity ?? 0) <= equipment.critical_stock_level;

  const details = equipment
    ? [
        { label: "Code", value: equipment.code || "—" },
        { label: "Type", value: equipment.type || "—" },
        { label: "Location", value: equipment.location_in_warehouse || "—" },
        { label: "Tags", value: equipment.tags || "—" },
        {
          label: "In stock",
          value: (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <span className={`status-dot ${lowStock ? "bg-[#fc3465]" : "bg-[#16d590]"}`} />
              <span className={lowStock ? "text-[#fc3465] font-medium" : ""}>{num(equipment.current_quantity)}</span>
            </span>
          ),
        },
        { label: "Qty (excl. cases)", value: num(equipment.current_quantity_excl_cases) },
        { label: "Critical stock", value: num(equipment.critical_stock_level) },
        { label: "Price", value: money(equipment.price) },
        { label: "List price", value: money(equipment.list_price) },
        { label: "Weight", value: equipment.weight ? `${num(equipment.weight)} kg` : "—" },
        { label: "Power", value: equipment.power ? `${num(equipment.power)} W` : "—" },
        { label: "Country of origin", value: equipment.country_of_origin || "—" },
        { label: "Rental / sales", value: equipment.rental_sales || "—" },
      ]
    : [];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Link to="/equipment" className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← Assets
      </Link>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load this equipment: {(error as Error).message}</p>}

      {equipment && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">{equipment.displayname ?? equipment.name}</h1>
              {equipment.in_archive && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Archived</span>
              )}
            </div>
            <PrintButton context={buildEquipmentLabelContext(equipment)} label="Print bulk label" />
          </div>

          <section className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <h2 className="text-sm font-semibold text-gray-500">Details</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 px-4 py-3 text-[13px]">
              {details.map((d) => (
                <div key={d.label} className="flex flex-col min-w-0">
                  <span className="text-gray-400 text-xs">{d.label}</span>
                  <span className="text-gray-800 truncate">{d.value}</span>
                </div>
              ))}
            </div>
            {(equipment.internal_remark || equipment.external_remark) && (
              <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-2 text-[13px]">
                {equipment.external_remark && (
                  <div>
                    <span className="text-gray-400 text-xs">External remark</span>
                    <p className="text-gray-800 whitespace-pre-wrap">{equipment.external_remark}</p>
                  </div>
                )}
                {equipment.internal_remark && (
                  <div>
                    <span className="text-gray-400 text-xs">Internal remark</span>
                    <p className="text-gray-800 whitespace-pre-wrap">{equipment.internal_remark}</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {selectedAssets.length > 0 && (
            <BatchPrintBar<SerialNumber>
              items={selectedAssets}
              getDisplayName={(a) => a.displayname ?? String(a.id)}
              renderImage={(a, t) => renderAssetLabelImage(a, t)}
              sendPrint={(image, t, a) => sendRenderedLabel(image, t, String(a.id))}
              onDone={() => setSelected(new Set())}
            />
          )}

          <section className="card overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-500 shrink-0">
                Serial numbers ({filteredSerials.length}
                {filteredSerials.length !== serials.length ? ` of ${serials.length}` : ""})
              </h2>
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search serial, ref, location…"
                  className="input w-56"
                />
                <RefreshButton queryKeys={[["equipment", id]]} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="px-4 py-2 w-8">
                      {filteredSerials.length > 0 && (
                        <input
                          type="checkbox"
                          checked={selected.size > 0 && selected.size === filteredSerials.length}
                          ref={(el) => {
                            if (el) el.indeterminate = selected.size > 0 && selected.size < filteredSerials.length;
                          }}
                          onChange={toggleAll}
                        />
                      )}
                    </th>
                    <th
                      onClick={() => toggleSort("name")}
                      className="px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    >
                      Serial{arrow("name")}
                    </th>
                    <th
                      onClick={() => toggleSort("location")}
                      className="px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    >
                      Location{arrow("location")}
                    </th>
                    <th
                      onClick={() => toggleSort("status")}
                      className="px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    >
                      Status{arrow("status")}
                    </th>
                    <th
                      onClick={() => toggleSort("inspection")}
                      className="px-3 py-2 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    >
                      Next inspection{arrow("inspection")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSerials.map((sn) => (
                    <tr key={sn.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(String(sn.id))}
                          onChange={() => toggle(String(sn.id))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/assets/${sn.id}`} className="flex flex-col min-w-0 hover:underline w-fit">
                          <span className="font-medium text-gray-900 truncate">{sn.displayname}</span>
                          {(sn.serial || sn.ref) && (
                            <span className="text-gray-400 font-mono text-xs truncate">
                              {[sn.serial, sn.ref].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {(sn._location?.displayname as string) ?? sn.asset_location ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`status-dot ${sn.active ? "bg-[#16d590]" : "bg-gray-300"}`} />
                          <span className={sn.active ? "text-gray-700" : "text-gray-400"}>
                            {sn.active ? "Active" : "Inactive"}
                          </span>
                        </span>
                      </td>
                      <td className={isOverdue(sn.next_inspection) ? "px-3 py-2 text-[#fc3465] font-medium" : "px-3 py-2 text-gray-600"}>
                        {formatDate(sn.next_inspection)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSerials.length === 0 && (
                <p className="px-4 py-6 text-gray-500 text-sm text-center">
                  {serials.length === 0
                    ? "No serialized units for this equipment (may be tracked as bulk stock instead)."
                    : "No serial numbers match your search."}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
