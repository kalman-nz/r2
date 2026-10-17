import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type QuoteLine, type QuoteStatus } from "../lib/api";
import { formatDate, formatRange, nzd } from "../lib/format";
import { errorText } from "../lib/errors";
import { saveFile } from "../lib/download";
import { QuoteStatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";
import { useCan } from "../lib/roles";

// A quote, rendered entirely from the snapshot taken when it was issued
// (lib/jobs.js issueQuote) — never from the live job. The PDF to send the
// client is made server-side from the same snapshot (print/r2_pdf.py); this
// page is the on-screen version, and still prints on A4 from the browser.
export default function QuoteView() {
  const canSetStatus = useCan()("quotes.status");
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: quote, isLoading, error } = useQuery({ queryKey: ["quote", id], queryFn: () => api.getQuote(id) });
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    setDownloading(true);
    try {
      saveFile(await api.quotePdf(id));
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <p className="p-6 text-gray-500 text-sm">Loading…</p>;
  if (error || !quote) return <p className="p-6 text-red-600 text-sm">Couldn't load this quote: {error ? errorText(error) : "not found"}</p>;

  const s = quote.snapshot;
  const number = `Q${s.job.number}-${quote.version}`;

  async function setStatus(status: QuoteStatus) {
    try {
      const updated = await api.setQuoteStatus(quote!.id, status);
      queryClient.setQueryData(["quote", id], updated);
      await queryClient.invalidateQueries({ queryKey: ["job-summary", quote!.job] });
      showToast("success", `Marked ${status}`);
    } catch (err) {
      showToast("error", `Couldn't update: ${errorText(err)}`);
    }
  }

  // Group headings in the order lines first use them; auto-added lines sit
  // under their parent.
  const groups: { name: string; lines: QuoteLine[] }[] = [];
  const parentGroup = new Map<string, string>();
  for (const line of s.lines) {
    const name = line.parentLine ? (parentGroup.get(line.parentLine) ?? line.group) : line.group;
    if (!line.parentLine) parentGroup.set(line.id, name);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, lines: [] }));
    group.lines.push(line);
  }

  const t = s.pricing.totals;
  const dates = s.job.showStart ? formatRange(s.job.showStart, s.job.showEnd) : formatRange(s.job.prepAt, s.job.returnAt);

  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to={`/projects/${quote.job}`} className="text-sm text-gray-500 hover:text-gray-900">
            ← Project #{s.job.number}
          </Link>
          <QuoteStatusBadge status={quote.status} />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {canSetStatus && quote.status !== "accepted" && (
            <button onClick={() => setStatus("accepted")} className="btn-secondary">
              Mark accepted
            </button>
          )}
          {canSetStatus && quote.status !== "declined" && (
            <button onClick={() => setStatus("declined")} className="btn-secondary">
              Declined
            </button>
          )}
          {canSetStatus && quote.status !== "void" && (
            <button onClick={() => setStatus("void")} className="btn-secondary">
              Void
            </button>
          )}
          <button onClick={() => window.print()} className="btn-secondary">
            Print
          </button>
          <button onClick={downloadPdf} disabled={downloading} className="btn-primary">
            {downloading ? "Making PDF…" : "Download PDF"}
          </button>
        </div>
      </div>

      <article className="print-sheet max-w-[210mm] mx-auto my-6 bg-white shadow-sm border border-gray-200 p-[14mm] text-[12.5px] text-gray-800 flex flex-col gap-6">
        {quote.status === "void" && (
          <p className="text-center text-red-600 font-semibold uppercase tracking-wide">Void — superseded or withdrawn</p>
        )}
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{s.business.name || "Your business name"}</h1>
            <p className="whitespace-pre-line text-gray-600">{s.business.address}</p>
            <p className="text-gray-600">{[s.business.phone, s.business.email].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-light tracking-wide text-gray-400 uppercase">Quote</p>
            <p className="font-semibold text-gray-900">{number}</p>
            <p className="text-gray-600">Issued {formatDate(s.issuedAt)}</p>
            {s.validUntil && <p className="text-gray-600">Valid until {formatDate(s.validUntil)}</p>}
            {s.business.gstNumber && <p className="text-gray-600">GST no. {s.business.gstNumber}</p>}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">For</h2>
            {s.client ? (
              <>
                <p className="font-semibold text-gray-900">{s.client.name}</p>
                {s.client.contactPerson && <p>Attn: {s.client.contactPerson}</p>}
                <p className="whitespace-pre-line">{s.client.billingAddress}</p>
                <p className="text-gray-600">{[s.client.email, s.client.phone].filter(Boolean).join(" · ")}</p>
              </>
            ) : (
              <p className="text-gray-400">—</p>
            )}
          </div>
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Project</h2>
            <p className="font-semibold text-gray-900">{s.job.name}</p>
            {s.job.reference && <p>Your ref: {s.job.reference}</p>}
            {s.venue && (
              <p>
                {s.venue.name}
                {s.venue.address ? `, ${s.venue.address}` : ""}
              </p>
            )}
            <p className="text-gray-600">{dates}</p>
          </div>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800 text-left">
              <th className="py-1.5 font-semibold">Description</th>
              <th className="py-1.5 font-semibold text-right w-14">Qty</th>
              <th className="py-1.5 font-semibold text-right w-24">Rate</th>
              <th className="py-1.5 font-semibold text-right w-14">Disc</th>
              <th className="py-1.5 font-semibold text-right w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <QuoteGroup key={group.name || "(none)"} name={group.name} lines={group.lines} />
            ))}
          </tbody>
        </table>

        <section className="flex justify-between gap-8 break-inside-avoid">
          <p className="text-gray-500 text-[11.5px] max-w-sm">
            Equipment rates are per day. This hire is charged as {s.pricing.days} day{s.pricing.days === 1 ? "" : "s"} at{" "}
            {s.pricing.factor}× the day rate. Prices are in NZD.
          </p>
          <div className="w-64 shrink-0 flex flex-col gap-1">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{nzd(t.gross - t.lineDiscount)}</span>
            </div>
            {t.jobDiscount !== 0 && (
              <div className="flex justify-between">
                <span>Discount ({s.pricing.discountPct}%)</span>
                <span className="tabular-nums">−{nzd(t.jobDiscount)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-gray-300 pt-1">
              <span>Total ex GST</span>
              <span className="tabular-nums">{nzd(t.exGst)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST {s.pricing.gstRate}%</span>
              <span className="tabular-nums">{nzd(t.gst)}</span>
            </div>
            <div className="flex justify-between text-base font-bold border-t-2 border-gray-800 pt-1">
              <span>Total incl GST</span>
              <span className="tabular-nums">{nzd(t.total)}</span>
            </div>
          </div>
        </section>

        {s.job.quoteNotes && (
          <section className="break-inside-avoid">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</h2>
            <p className="whitespace-pre-line">{s.job.quoteNotes}</p>
          </section>
        )}
        {s.terms && (
          <section className="break-inside-avoid text-[11px] text-gray-500">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Terms</h2>
            <p className="whitespace-pre-line">{s.terms}</p>
          </section>
        )}
      </article>
    </div>
  );
}

function QuoteGroup({ name, lines }: { name: string; lines: QuoteLine[] }) {
  const subtotal = lines.reduce((sum, l) => sum + (l.amount?.net ?? 0), 0);
  return (
    <>
      {name && (
        <tr className="break-inside-avoid">
          <td colSpan={4} className="pt-4 pb-1 font-semibold text-gray-900">
            {name}
          </td>
          <td className="pt-4 pb-1 text-right text-gray-500 tabular-nums">{nzd(subtotal)}</td>
        </tr>
      )}
      {lines.map((line) => {
        const child = Boolean(line.parentLine);
        const free = child && !line.unitPrice;
        return (
          <tr key={line.id} className={`border-b border-gray-100 break-inside-avoid ${child ? "text-gray-500" : ""}`}>
            <td className={`py-1 ${child ? "pl-5" : ""}`}>
              {child && "– "}
              {line.name}
              {line.description && <span className="block text-[11px] text-gray-500">{line.description}</span>}
            </td>
            <td className="py-1 text-right tabular-nums">{line.quantity}</td>
            <td className="py-1 text-right tabular-nums">{free ? "incl." : nzd(line.unitPrice)}</td>
            <td className="py-1 text-right tabular-nums">{line.discountPct ? `${line.discountPct}%` : ""}</td>
            <td className="py-1 text-right tabular-nums">{free ? "" : nzd(line.amount.net)}</td>
          </tr>
        );
      })}
    </>
  );
}
