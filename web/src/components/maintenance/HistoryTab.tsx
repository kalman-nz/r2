import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { localDateInput, nzd } from "../../lib/format";
import { assetLabel, formatDay, kindOf, resultLabel, useMaintenanceJobs, type JobWithExpand } from "../../lib/maintenance";
import { saveFile } from "../../lib/download";
import { ResultBadge } from "./ResultBadge";

type Since = "3" | "12" | "all";

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return localDateInput(d);
}

const cell = (v: unknown) => {
  const text = String(v ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// The register of what's been done, newest first: what passed and failed,
// who did it and when. Downloads as a spreadsheet for an auditor or a
// client's safety officer.
export default function HistoryTab() {
  const navigate = useNavigate();
  const [since, setSince] = useState<Since>("12");
  const [result, setResult] = useState<"" | "pass" | "fail">("");
  const [search, setSearch] = useState("");
  const filter = `status = 'done'${since === "all" ? "" : ` && doneOn >= "${monthsAgo(Number(since))}"`}`;
  const { data: jobs = [], isLoading, error } = useMaintenanceJobs(filter, "-doneOn,-updated");

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (result && j.result !== result) return false;
      if (!term) return true;
      const unit = j.expand?.serial;
      return [j.name, j.expand?.item?.name, unit?.barcode, unit?.label, unit?.serialNumber, j.doneBy, j.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [jobs, result, search]);

  function download(rows: JobWithExpand[]) {
    const header = ["Done on", "Work", "Kind", "Item", "Barcode", "Serial number", "Result", "Done by", "Notes", "Cost", "Plan"];
    const lines = rows.map((j) =>
      [
        j.doneOn,
        j.name,
        kindOf(j.kind).label,
        j.expand?.item?.name ?? "",
        j.expand?.serial?.barcode ?? "",
        j.expand?.serial?.serialNumber ?? "",
        resultLabel(j) + (j.failedQty ? ` (${j.failedQty})` : ""),
        j.doneBy,
        j.notes,
        j.cost || "",
        j.expand?.plan?.name ?? "",
      ]
        .map(cell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv" });
    saveFile({ blob, filename: `maintenance-${localDateInput(new Date())}.csv` });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work, item, barcode, who…" className="input w-64 max-w-full" />
        <select value={result} onChange={(e) => setResult(e.target.value as typeof result)} className="input w-auto">
          <option value="">Passed and failed</option>
          <option value="pass">Passed or done</option>
          <option value="fail">Failed</option>
        </select>
        <select value={since} onChange={(e) => setSince(e.target.value as Since)} className="input w-auto">
          <option value="3">Last 3 months</option>
          <option value="12">Last 12 months</option>
          <option value="all">Everything</option>
        </select>
        <button onClick={() => download(shown)} disabled={shown.length === 0} className="btn-secondary ml-auto">
          Download CSV
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load maintenance: {(error as Error).message}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-4 py-2 font-medium whitespace-nowrap">Done</th>
              <th className="px-3 py-2 font-medium">Work</th>
              <th className="px-3 py-2 font-medium hidden sm:table-cell">Kit</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium hidden md:table-cell">By</th>
              <th className="px-3 py-2 font-medium hidden lg:table-cell text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((j) => (
              <tr key={j.id} onClick={() => navigate(`/maintenance/jobs/${j.id}`)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-2 whitespace-nowrap text-gray-700">{formatDay(j.doneOn)}</td>
                <td className="px-3 py-2">
                  <span className="block font-medium text-gray-900">{j.name}</span>
                  <span className="sm:hidden block text-xs text-gray-600">{assetLabel(j)}</span>
                  {j.notes && <span className="block text-xs text-gray-500 truncate max-w-xs">{j.notes}</span>}
                </td>
                <td className="px-3 py-2 text-gray-700 hidden sm:table-cell">{assetLabel(j)}</td>
                <td className="px-3 py-2">
                  <ResultBadge job={j} />
                </td>
                <td className="px-3 py-2 text-gray-600 hidden md:table-cell">{j.doneBy || "—"}</td>
                <td className="px-3 py-2 text-gray-600 hidden lg:table-cell text-right tabular-nums">{j.cost ? nzd(j.cost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && shown.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">{jobs.length === 0 ? "Nothing recorded in this time." : "Nothing matches."}</p>
        )}
      </div>
    </div>
  );
}
