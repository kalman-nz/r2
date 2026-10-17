import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type JobLineView } from "../lib/api";
import { formatDateTime, formatRange } from "../lib/format";
import { errorText } from "../lib/errors";
import { saveFile } from "../lib/download";
import { useToast } from "../components/ToastProvider";
import { JobStatusBadge } from "../components/StatusBadge";

// What the warehouse packs for a job, laid out to print on A4 and tick off
// by hand. Custom lines (delivery, labour) aren't packed, so they're left
// out; a kit's contents are listed under it.
export default function PackingList() {
  const { id = "" } = useParams();
  const { data: summary, isLoading, error } = useQuery({ queryKey: ["job-summary", id], queryFn: () => api.getJobSummary(id) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [downloading, setDownloading] = useState(false);
  const { showToast } = useToast();

  async function downloadPdf() {
    setDownloading(true);
    try {
      saveFile(await api.packingPdf(id));
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <p className="p-6 text-gray-500 text-sm">Loading…</p>;
  if (error || !summary) return <p className="p-6 text-red-600 text-sm">Couldn't load this job: {error ? errorText(error) : "not found"}</p>;

  const { job, packing } = summary;
  const lines = summary.lines.filter((l) => l.lineType !== "custom");
  const packed = new Map(packing.items.map((p) => [p.itemId, p]));

  const groups: { name: string; lines: JobLineView[] }[] = [];
  const parentGroup = new Map<string, string>();
  for (const line of lines) {
    const name = line.parentLine ? (parentGroup.get(line.parentLine) ?? line.group) : line.group;
    if (!line.parentLine) parentGroup.set(line.id, name);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, lines: [] }));
    group.lines.push(line);
  }

  return (
    <div className="min-h-screen bg-[#f3f6fb] print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
        <Link to={`/jobs/${job.id}`} className="text-sm text-gray-500 hover:text-gray-900">
          ← Job #{job.number}
        </Link>
        <div className="flex items-center gap-1.5">
          <button onClick={() => window.print()} className="btn-secondary">
            Print
          </button>
          <button onClick={downloadPdf} disabled={downloading} className="btn-primary">
            {downloading ? "Making PDF…" : "Download PDF"}
          </button>
        </div>
      </div>

      <article className="print-sheet max-w-[210mm] mx-auto my-6 bg-white shadow-sm border border-gray-200 p-[14mm] text-[12.5px] text-gray-800 flex flex-col gap-5">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Packing list{settings?.businessName ? ` · ${settings.businessName}` : ""}
            </p>
            <h1 className="text-xl font-bold text-gray-900">
              #{job.number} {job.name}
            </h1>
            <p>{[job.clientInfo?.name, job.venueInfo?.name].filter(Boolean).join(" · ")}</p>
            {job.venueInfo?.address && <p className="text-gray-600">{job.venueInfo.address}</p>}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
            <JobStatusBadge status={job.status} />
            <p>
              <span className="text-gray-500">Prep</span> {formatDateTime(job.prepAt)}
            </p>
            {job.showStart && (
              <p>
                <span className="text-gray-500">Show</span> {formatRange(job.showStart, job.showEnd)}
              </p>
            )}
            <p>
              <span className="text-gray-500">Back</span> {formatDateTime(job.returnAt)}
            </p>
          </div>
        </header>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800 text-left">
              <th className="py-1.5 w-8" />
              <th className="py-1.5 font-semibold text-right w-12 pr-3">Qty</th>
              <th className="py-1.5 font-semibold">Item</th>
              <th className="py-1.5 font-semibold w-28">Where</th>
              <th className="py-1.5 font-semibold text-right w-20">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <PackingGroup key={group.name || "(none)"} name={group.name} lines={group.lines} packed={packed} />
            ))}
          </tbody>
        </table>
        {lines.length === 0 && <p className="text-gray-500">Nothing to pack on this job.</p>}

        {job.notes && (
          <section className="break-inside-avoid">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</h2>
            <p className="whitespace-pre-line">{job.notes}</p>
          </section>
        )}

        <section className="grid grid-cols-3 gap-6 pt-6 break-inside-avoid">
          {["Packed by", "Checked by", "Returned by"].map((label) => (
            <div key={label} className="border-t border-gray-400 pt-1 text-[11px] text-gray-500">
              {label}
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}

function PackingGroup({
  name,
  lines,
  packed,
}: {
  name: string;
  lines: JobLineView[];
  packed: Map<string, { needed: number; scannedOut: number; serialsOut: { barcode: string; label: string }[] }>;
}) {
  return (
    <>
      {name && (
        <tr>
          <td colSpan={5} className="pt-4 pb-1 font-semibold text-gray-900">
            {name}
          </td>
        </tr>
      )}
      {lines.map((line) => {
        const child = Boolean(line.parentLine);
        const isKit = line.item?.kind === "kit";
        const p = line.item ? packed.get(line.item.id) : undefined;
        return (
          <tr key={line.id} className="border-b border-gray-100 break-inside-avoid align-top">
            <td className="py-1.5">{!isKit && <span className="inline-block w-3.5 h-3.5 border border-gray-500 rounded-sm" />}</td>
            <td className="py-1.5 text-right pr-3 font-semibold tabular-nums">{line.quantity}</td>
            <td className={`py-1.5 ${child ? "pl-4 text-gray-700" : ""}`}>
              {child && "– "}
              {line.name}
              {isKit && <span className="text-gray-500"> (kit — contents below)</span>}
              {line.item?.code && <span className="text-gray-400 font-mono text-[11px] ml-1.5">{line.item.code}</span>}
              {p && p.serialsOut.length > 0 && (
                <span className="block text-[11px] text-gray-500">Out: {p.serialsOut.map((s) => s.label || s.barcode).join(", ")}</span>
              )}
            </td>
            <td className="py-1.5 text-gray-600">{line.item?.locationInWarehouse}</td>
            <td className="py-1.5 text-right tabular-nums text-gray-600">{p && !isKit ? `${p.scannedOut}/${p.needed}` : ""}</td>
          </tr>
        );
      })}
    </>
  );
}
