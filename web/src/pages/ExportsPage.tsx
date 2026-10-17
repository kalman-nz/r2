import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type XeroJob } from "../lib/api";
import { formatDate, localDateInput, nzd } from "../lib/format";
import { errorText } from "../lib/errors";
import { saveFile } from "../lib/download";
import { useRole } from "../lib/roles";
import { JobStatusBadge, QuoteStatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";

function firstOfLastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return localDateInput(d);
}

// Turns finished jobs into a Xero sales invoice import file. Each job is
// invoiced from the quote the client saw (its latest accepted quote, or
// latest issued one); Xero brings them in as drafts to check and approve.
export default function ExportsPage() {
  const { can } = useRole();
  const { showToast } = useToast();
  const [from, setFrom] = useState(firstOfLastMonth);
  const [to, setTo] = useState(() => localDateInput(new Date()));
  const [invoiceDate, setInvoiceDate] = useState(() => localDateInput(new Date()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["exports", "xero", from, to],
    queryFn: () => api.xeroJobs(from, to),
    enabled: Boolean(from && to),
  });

  // Ready to invoice = has a quote and hasn't changed since it.
  const ready = (j: XeroJob) => j.quote !== null && !j.changedSinceQuote;
  useEffect(() => {
    setSelected(new Set(jobs.filter(ready).map((j) => j.jobId)));
  }, [jobs]);

  const chosen = useMemo(() => jobs.filter((j) => selected.has(j.jobId) && j.quote), [jobs, selected]);
  const total = chosen.reduce((sum, j) => sum + (j.quote?.total ?? 0), 0);

  async function download() {
    setDownloading(true);
    try {
      saveFile(await api.xeroCsv(chosen.map((j) => j.jobId), invoiceDate));
      showToast("success", `Saved ${chosen.length} invoice${chosen.length === 1 ? "" : "s"} for Xero`);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Export invoices to Xero</h1>
        <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
          Makes a file for Xero's invoice import (Business → Invoices → Import). Each job is invoiced from the quote the client
          saw. Xero brings them in as drafts to check and approve, and refuses an invoice number it already has, so a job can't
          be invoiced twice by accident.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">Jobs back from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-500">Invoice date</span>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input py-1.5" />
        </label>
        {settings && (
          <p className="text-xs text-gray-500 pb-2">
            Account {settings.xeroAccountCode} · {settings.xeroTaxType} · due in {settings.xeroDueDays} days · numbered{" "}
            {settings.invoicePrefix}1001…{" "}
            {can("settings.edit") ? (
              <Link to="/settings/accounting" className="text-[#167cfb] hover:text-[#0f6ae0]">
                Change
              </Link>
            ) : (
              "(set in Settings → Accounting)"
            )}
          </p>
        )}
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load jobs: {errorText(error)}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2 font-medium w-16">#</th>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Back</th>
              <th className="px-3 py-2 font-medium">Quote</th>
              <th className="px-3 py-2 font-medium text-right">Incl GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((j) => (
              <tr key={j.jobId} className={j.quote ? "" : "text-gray-400"}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(j.jobId)} disabled={!j.quote} onChange={() => toggle(j.jobId)} />
                </td>
                <td className="px-3 py-2 tabular-nums">{j.number}</td>
                <td className="px-3 py-2">
                  <Link to={`/jobs/${j.jobId}`} className="font-medium text-gray-900 hover:underline">
                    {j.name}
                  </Link>
                  <span className="ml-2">
                    <JobStatusBadge status={j.status} />
                  </span>
                  {j.client && <span className="block text-xs text-gray-500">{j.client}</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(j.returnAt)}</td>
                <td className="px-3 py-2">
                  {j.quote ? (
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <Link to={`/print/quotes/${j.quote.id}`} className="hover:underline">
                          Q{j.number}-{j.quote.version}
                        </Link>
                        <QuoteStatusBadge status={j.quote.status} />
                      </span>
                      {j.changedSinceQuote && (
                        <span className="text-xs text-amber-700">Job changed since this quote — issue a new one to invoice the changes</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs">No quote issued — nothing to invoice from</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{j.quote ? nzd(j.quote.total) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && jobs.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm text-center">No jobs back in those dates.</p>}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600">
          {chosen.length} invoice{chosen.length === 1 ? "" : "s"} · {nzd(total)} incl GST
        </p>
        <button onClick={download} disabled={downloading || chosen.length === 0} className="btn-primary">
          {downloading ? "Making file…" : "Download Xero file"}
        </button>
      </div>
    </div>
  );
}
