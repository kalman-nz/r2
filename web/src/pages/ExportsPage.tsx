import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type XeroJob } from "../lib/api";
import { formatDateTimeYear, localDateInput, nzd, parseDate } from "../lib/format";
import { errorText } from "../lib/errors";
import { saveFile } from "../lib/download";
import { useRole } from "../lib/roles";
import { sortRows, type Sort } from "../lib/table";
import DataTable, { type TableColumn } from "../components/DataTable";
import DateCell from "../components/DateCell";
import { JobStatusBadge, QuoteStatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";

function firstOfLastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return localDateInput(d);
}

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);

const COLUMNS: TableColumn<XeroJob>[] = [
  {
    key: "number",
    label: "#",
    width: 72,
    minWidth: 64,
    sortValue: (j) => j.number,
    render: (j) => <span className="font-mono text-xs text-gray-500">{j.number}</span>,
  },
  {
    key: "name",
    label: "Project",
    width: 280,
    minWidth: 160,
    flex: true,
    sortValue: (j) => j.name.toLowerCase(),
    title: (j) => j.name,
    render: (j) => <span className="font-medium text-gray-900">{j.name}</span>,
  },
  {
    key: "client",
    label: "Client",
    width: 180,
    minWidth: 90,
    sortValue: (j) => j.client.toLowerCase() || "￿",
    title: (j) => j.client,
    render: (j) => muted(j.client),
  },
  {
    key: "status",
    label: "Status",
    width: 120,
    sortValue: (j) => j.status,
    render: (j) => <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />,
  },
  {
    key: "back",
    label: "Back",
    width: 130,
    sortValue: (j) => parseDate(j.returnAt)?.getTime() ?? 0,
    title: (j) => formatDateTimeYear(j.returnAt),
    render: (j) => <DateCell value={j.returnAt} dateOnly />,
  },
  {
    key: "quote",
    label: "Quote",
    width: 200,
    minWidth: 110,
    sortValue: (j) => (j.quote ? j.quote.version : -1),
    title: (j) => (j.changedSinceQuote ? "The project's changed since this quote: issue a new one to invoice the changes" : ""),
    render: (j) =>
      j.quote ? (
        <span className="inline-flex items-center gap-2">
          <Link to={`/print/quotes/${j.quote.id}`} onClick={(e) => e.stopPropagation()} className="text-gray-900 hover:underline">
            Q{j.number}-{j.quote.version}
          </Link>
          {j.changedSinceQuote ? <span className="text-xs text-amber-700">Changed since</span> : <QuoteStatusBadge status={j.quote.status} />}
        </span>
      ) : (
        <span className="text-gray-400">No quote</span>
      ),
  },
  {
    key: "total",
    label: "Incl GST",
    align: "right",
    width: 110,
    sortValue: (j) => j.quote?.total ?? -1,
    render: (j) => (j.quote ? <span className="text-gray-700 tabular-nums">{nzd(j.quote.total)}</span> : muted("")),
  },
];

// Turns finished projects into a Xero sales invoice import file, laid out
// like the other lists. Each is invoiced from the quote the client saw (its
// latest accepted quote, or latest issued one); Xero brings them in as
// drafts to check and approve.
export default function ExportsPage() {
  const navigate = useNavigate();
  const { can } = useRole();
  const { showToast } = useToast();
  const [from, setFrom] = useState(firstOfLastMonth);
  const [to, setTo] = useState(() => localDateInput(new Date()));
  const [invoiceDate, setInvoiceDate] = useState(() => localDateInput(new Date()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sorts, setSorts] = useState<Sort[]>([{ key: "back", dir: "asc" }]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState(false);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ["exports", "xero", from, to],
    queryFn: () => api.xeroJobs(from, to),
    enabled: Boolean(from && to),
  });

  // Ready to invoice = has a quote and hasn't changed since it. Only
  // projects with a quote can be picked.
  const ready = (j: XeroJob) => j.quote !== null && !j.changedSinceQuote;
  useEffect(() => {
    setSelected(new Set(jobs.filter(ready).map((j) => j.jobId)));
  }, [jobs]);
  const quoted = useMemo(() => new Set(jobs.filter((j) => j.quote).map((j) => j.jobId)), [jobs]);

  const rows = useMemo(() => sortRows(jobs, COLUMNS, sorts), [jobs, sorts]);
  const chosen = useMemo(() => jobs.filter((j) => selected.has(j.jobId) && j.quote), [jobs, selected]);
  const total = chosen.reduce((sum, j) => sum + (j.quote?.total ?? 0), 0);
  const unquoted = jobs.length - quoted.size;

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

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Xero export</h1>
          <p className="text-xs text-gray-500">
            {isLoading ? (
              "Loading…"
            ) : (
              <>
                {chosen.length} invoice{chosen.length === 1 ? "" : "s"} · {nzd(total)} incl GST
                {unquoted > 0 && <span className="text-gray-400"> · {unquoted} without a quote</span>}
              </>
            )}
          </p>
        </div>
        <button onClick={download} disabled={downloading || chosen.length === 0} className="btn-primary">
          {downloading ? "Making file…" : "Download Xero file"}
        </button>
      </div>

      <div className="flex items-end gap-3 flex-wrap shrink-0 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Projects back from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Invoice date</span>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="input py-1.5" />
        </label>
        {settings && (
          <p className="ml-auto text-xs text-gray-500 pb-2">
            Account {settings.xeroAccountCode} · {settings.xeroTaxType} · due in {settings.xeroDueDays} days · numbered {settings.invoicePrefix}1001…
            {can("settings.edit") && (
              <>
                {" "}
                <Link to="/settings/accounting" className="font-medium text-signal-ink hover:text-signal-ink-hover">
                  Change
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {error && <p className="text-red-600 text-sm shrink-0">Couldn&apos;t load projects: {errorText(error)}</p>}

      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(j) => j.jobId}
        onRowClick={(j, e) => (e.metaKey || e.ctrlKey ? window.open(`/projects/${j.jobId}`, "_blank") : navigate(`/projects/${j.jobId}`))}
        sorts={sorts}
        onSortsChange={setSorts}
        widths={widths}
        onWidthsChange={setWidths}
        selected={selected}
        // Projects without a quote have nothing to invoice from.
        onSelectedChange={(next) => setSelected(new Set([...next].filter((id) => quoted.has(id))))}
        empty={!isLoading && jobs.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm text-center">No projects back in those dates.</p>}
      />
    </div>
  );
}
