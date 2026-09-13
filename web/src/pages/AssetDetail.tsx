import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { buildLabelContext } from "../lib/labelSpec";
import RecordFields from "../components/RecordFields";
import PrintButton from "../components/PrintButton";

export default function AssetDetail() {
  const { id = "" } = useParams();
  const { data: asset, isLoading, error } = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api.getAsset(id),
  });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Link
        to={asset?.equipment ? `/equipment/${asset.equipment.split("/").pop()}` : "/equipment"}
        className="text-sm text-gray-500 hover:text-gray-900 w-fit"
      >
        ← {asset ? ((asset._equipment?.displayname as string) ?? "Back") : "Assets"}
      </Link>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load this asset: {(error as Error).message}</p>}

      {asset && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {(asset._equipment?.displayname as string) ?? (asset._equipment?.name as string) ?? asset.displayname}
              </h1>
              <p className="text-gray-500 text-sm">
                {asset.displayname}
                {asset._equipment?.code ? ` · ${asset._equipment.code as string}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <PrintButton context={buildLabelContext(asset)} rentmanSerialNumberId={String(asset.id)} />
            </div>
          </div>

          <section className="card p-4 grid grid-cols-2 gap-4 text-sm text-gray-900">
            <div>
              <dt className="text-gray-500">Barcode / QR</dt>
              <dd className="font-mono">{asset.qrcodes || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Internal reference</dt>
              <dd className="font-mono">{asset.ref || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Stock location</dt>
              <dd>
                {(asset._location?.displayname as string) ?? "—"}
                {asset._equipment?.location_in_warehouse ? ` (${asset._equipment.location_in_warehouse as string})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Currently on project</dt>
              <dd>
                {asset._lastSubproject
                  ? ((asset._lastSubproject.displayname as string) ?? (asset._lastSubproject.name as string))
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Next inspection</dt>
              <dd>{asset.next_inspection ? new Date(asset.next_inspection).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Tags</dt>
              <dd>{asset.tags || "—"}</dd>
            </div>
            {asset.remark ? (
              <div className="col-span-2">
                <dt className="text-gray-500">Remark</dt>
                <dd>{asset.remark}</dd>
              </div>
            ) : null}
          </section>

          <details className="card p-4">
            <summary className="text-sm font-semibold text-gray-500 cursor-pointer">All Rentman fields</summary>
            <div className="mt-3">
              <RecordFields record={asset} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
