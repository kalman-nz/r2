import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type SerialNumber } from "../lib/api";
import { buildEquipmentLabelContext } from "../lib/labelSpec";
import { renderAssetLabelImage, sendRenderedLabel } from "../lib/print";
import BatchPrintBar from "../components/BatchPrintBar";
import PrintButton from "../components/PrintButton";
import RefreshButton from "../components/RefreshButton";

export default function EquipmentDetail() {
  const { id = "" } = useParams();
  const { data: equipment, isLoading, error } = useQuery({
    queryKey: ["equipment", id],
    queryFn: () => api.getEquipment(id),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(assetId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(assetId) ? next.delete(assetId) : next.add(assetId);
      return next;
    });
  }

  function toggleAll() {
    if (!equipment) return;
    setSelected((prev) =>
      prev.size === equipment.serialNumbers.length ? new Set() : new Set(equipment.serialNumbers.map((sn) => String(sn.id))),
    );
  }

  const selectedAssets = equipment?.serialNumbers.filter((sn) => selected.has(String(sn.id))) ?? [];

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
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{equipment.displayname ?? equipment.name}</h1>
              <p className="text-gray-500 text-sm">
                {equipment.code}
                {equipment.location_in_warehouse ? ` · ${equipment.location_in_warehouse}` : ""}
                {equipment.tags ? ` · ${equipment.tags}` : ""}
              </p>
            </div>
            <PrintButton context={buildEquipmentLabelContext(equipment)} label="Print bulk label" />
          </div>

          {selectedAssets.length > 0 && (
            <BatchPrintBar<SerialNumber>
              items={selectedAssets}
              getDisplayName={(a) => a.displayname ?? String(a.id)}
              renderImage={(a, t) => renderAssetLabelImage(a, t)}
              sendPrint={(image, t, a) => sendRenderedLabel(image, t, String(a.id))}
              onDone={() => setSelected(new Set())}
            />
          )}

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
              <div className="flex items-center gap-3">
                {equipment.serialNumbers.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selected.size === equipment.serialNumbers.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && selected.size < equipment.serialNumbers.length;
                    }}
                    onChange={toggleAll}
                  />
                )}
                <h2 className="text-sm font-semibold text-gray-500">
                  Serial numbers ({equipment.serialNumbers.length})
                </h2>
              </div>
              <RefreshButton queryKeys={[["equipment", id]]} />
            </div>
            <div className="divide-y divide-gray-100">
              {equipment.serialNumbers.map((sn) => (
                <div key={sn.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(String(sn.id))}
                    onChange={() => toggle(String(sn.id))}
                  />
                  <Link to={`/assets/${sn.id}`} className="flex-1 flex flex-col min-w-0">
                    <span className="font-medium text-gray-900 truncate">{sn.displayname}</span>
                    <span className="text-gray-500 text-xs truncate">
                      {(sn._location?.displayname as string) ?? "no location"}
                      {sn.qrcodes ? ` · ${sn.qrcodes}` : ""}
                    </span>
                  </Link>
                </div>
              ))}
              {equipment.serialNumbers.length === 0 && (
                <p className="px-4 py-6 text-gray-500 text-sm">
                  No serialized units for this equipment (may be tracked as bulk stock instead).
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
