import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type DocumentField, type DocumentTemplate, type JobLineView, type JobSummary } from "../lib/api";
import { pb } from "../lib/pocketbase";
import { formatDateTime, formatPeriod } from "../lib/format";
import { errorText } from "../lib/errors";
import { linesByHeading } from "../lib/documents";

// One of the organisation's project documents (Settings → Documents), filled
// in with the project's details and laid out to print on A4 and fill in by
// hand: the browser's Print saves it as a PDF too.
export default function DocumentView() {
  const { id = "", templateId = "" } = useParams();
  const { data: summary, isLoading, error } = useQuery({ queryKey: ["job-summary", id], queryFn: () => api.getJobSummary(id) });
  const template = useQuery({
    queryKey: ["document-template", templateId],
    queryFn: () => pb.collection("document_templates").getOne<DocumentTemplate>(templateId),
  });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  if (isLoading || template.isLoading) return <p className="p-6 text-gray-500 text-sm">Loading…</p>;
  if (error || !summary) return <p className="p-6 text-red-600 text-sm">Couldn't load this project: {error ? errorText(error) : "not found"}</p>;
  if (template.error || !template.data) return <p className="p-6 text-red-600 text-sm">Couldn't load this document: {template.error ? errorText(template.error) : "not found"}</p>;

  const doc = template.data;
  const { job } = summary;
  const groups = doc.equipment === "none" ? [] : linesByHeading(summary.lines);

  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-3">
        <Link to={`/projects/${job.id}`} className="text-sm text-gray-500 hover:text-gray-900">
          ← Project #{job.number}
        </Link>
        <button onClick={() => window.print()} className="btn-primary" title="Print, or choose Save as PDF in the print window">
          Print or save PDF
        </button>
      </div>

      <article className="print-sheet max-w-[210mm] mx-auto my-6 bg-white shadow-sm border border-gray-200 p-[14mm] text-[12.5px] text-gray-800 flex flex-col gap-5">
        <DocumentHeader title={doc.name} businessName={settings?.businessName ?? ""} summary={summary} />

        {doc.schedule && summary.periods.length > 0 && (
          <section className="flex flex-col gap-1 break-inside-avoid">
            <SectionTitle>Schedule</SectionTitle>
            <table className="w-full border-collapse">
              <tbody>
                {[...summary.periods]
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 align-top">
                      <td className="py-1 pr-3 w-48 font-medium">{p.name}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{formatPeriod(p.start, p.end)}</td>
                      <td className="py-1 text-gray-600">{p.notes}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        {doc.equipment !== "none" && (
          <section className="flex flex-col gap-1">
            <SectionTitle>Equipment</SectionTitle>
            {groups.length === 0 ? <p className="text-gray-500">No equipment on this project.</p> : <EquipmentTable mode={doc.equipment} groups={groups} />}
          </section>
        )}

        {doc.notes && job.notes && (
          <section className="break-inside-avoid">
            <SectionTitle>Notes</SectionTitle>
            <p className="whitespace-pre-line mt-1">{job.notes}</p>
          </section>
        )}

        <Fields fields={doc.fields} />
      </article>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</h2>;
}

// The project at the top of every document: who, where, when, and who to
// call on site.
function DocumentHeader({ title, businessName, summary }: { title: string; businessName: string; summary: JobSummary }) {
  const { job } = summary;
  const client = job.clientInfo;
  const venue = job.venueInfo;
  const contacts = [
    client?.contactPerson && `Contact: ${client.contactPerson}${client.phone ? ` · ${client.phone}` : ""}`,
    venue?.contactName && `On site: ${venue.contactName}${venue.phone ? ` · ${venue.phone}` : ""}`,
  ].filter(Boolean);
  return (
    <header className="flex items-start justify-between gap-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {title}
          {businessName ? ` · ${businessName}` : ""}
        </p>
        <h1 className="text-xl font-bold text-gray-900">
          #{job.number} {job.name}
        </h1>
        <p>{[client?.name, venue?.name].filter(Boolean).join(" · ")}</p>
        {venue?.address && <p className="text-gray-600 whitespace-pre-line">{venue.address}</p>}
        {contacts.map((c) => (
          <p key={c as string} className="text-gray-600">
            {c}
          </p>
        ))}
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
        <p>
          <span className="text-gray-500">Starts</span> {formatDateTime(job.startAt)}
        </p>
        <p>
          <span className="text-gray-500">Ends</span> {formatDateTime(job.endAt)}
        </p>
        {job.reference && (
          <p>
            <span className="text-gray-500">Ref</span> {job.reference}
          </p>
        )}
      </div>
    </header>
  );
}

const box = <span className="inline-block w-3.5 h-3.5 border border-gray-500 rounded-sm align-middle" />;
const blank = <span className="block border-b border-gray-300 h-4" />;

function EquipmentTable({ mode, groups }: { mode: DocumentTemplate["equipment"]; groups: { name: string; lines: JobLineView[] }[] }) {
  const ret = mode === "return";
  const check = mode === "checklist";
  const span = ret ? 5 : check ? 4 : 2;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-gray-800 text-left">
          {check && <th className="py-1.5 w-8" />}
          <th className={`py-1.5 font-semibold ${ret ? "" : "text-right w-12 pr-3"}`}>{ret ? "Item" : "Qty"}</th>
          {ret ? (
            <>
              <th className="py-1.5 font-semibold text-right w-12 pr-3">Out</th>
              <th className="py-1.5 font-semibold w-16 pr-3">Back</th>
              <th className="py-1.5 font-semibold w-10 text-center">OK</th>
              <th className="py-1.5 font-semibold w-48">Notes</th>
            </>
          ) : (
            <th className="py-1.5 font-semibold">Item</th>
          )}
          {check && <th className="py-1.5 font-semibold w-28">Where</th>}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Group key={group.name || "(none)"} name={group.name} span={span}>
            {group.lines.map((line) => {
              const child = Boolean(line.parentLine);
              const isKit = line.item?.kind === "kit";
              const name = (
                <>
                  {child && "– "}
                  {line.name}
                  {isKit && <span className="text-gray-500"> (kit)</span>}
                  {line.item?.code && <span className="text-gray-400 font-mono text-[11px] ml-1.5">{line.item.code}</span>}
                </>
              );
              return (
                <tr key={line.id} className="border-b border-gray-100 break-inside-avoid align-top">
                  {check && <td className="py-1.5">{!isKit && box}</td>}
                  {ret ? (
                    <>
                      <td className={`py-1.5 ${child ? "pl-4 text-gray-700" : ""}`}>{name}</td>
                      <td className="py-1.5 text-right pr-3 font-semibold tabular-nums">{line.quantity}</td>
                      <td className="py-1.5 pr-3">{!isKit && blank}</td>
                      <td className="py-1.5 text-center">{!isKit && box}</td>
                      <td className="py-1.5">{!isKit && blank}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 text-right pr-3 font-semibold tabular-nums">{line.quantity}</td>
                      <td className={`py-1.5 ${child ? "pl-4 text-gray-700" : ""}`}>{name}</td>
                    </>
                  )}
                  {check && <td className="py-1.5 text-gray-600">{line.item?.locationInWarehouse}</td>}
                </tr>
              );
            })}
          </Group>
        ))}
      </tbody>
    </table>
  );
}

function Group({ name, span, children }: { name: string; span: number; children: React.ReactNode }) {
  return (
    <>
      {name && (
        <tr>
          <td colSpan={span} className="pt-4 pb-1 font-semibold text-gray-900">
            {name}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

// The form's own parts, in order.
function Fields({ fields }: { fields: DocumentField[] }) {
  if (fields.length === 0) return null;
  // Tick boxes in a row sit together in two columns; signatures side by side.
  const blocks: DocumentField[][] = [];
  for (const f of fields) {
    const last = blocks[blocks.length - 1];
    const groupable = f.type === "checkbox" || f.type === "signature";
    if (groupable && last && last[0].type === f.type) last.push(f);
    else blocks.push([f]);
  }
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block) => {
        const first = block[0];
        if (first.type === "checkbox") {
          return (
            <div key={first.id} className="grid grid-cols-2 gap-x-6 gap-y-1.5 break-inside-avoid">
              {block.map((f) => (
                <p key={f.id} className="flex items-start gap-2">
                  <span className="mt-0.5">{box}</span>
                  {f.label}
                </p>
              ))}
            </div>
          );
        }
        if (first.type === "signature") {
          return (
            <div key={first.id} className="grid grid-cols-2 gap-x-8 gap-y-6 pt-4 break-inside-avoid">
              {block.map((f) => (
                <div key={f.id} className="flex flex-col gap-5">
                  <p className="font-semibold text-gray-900">{f.label}</p>
                  <Line label="Name" />
                  <Line label="Signature" />
                  <Line label="Date" />
                </div>
              ))}
            </div>
          );
        }
        return <SingleField key={first.id} field={first} />;
      })}
    </div>
  );
}

function SingleField({ field }: { field: DocumentField }) {
  switch (field.type) {
    case "heading":
      return <h2 className="text-sm font-bold text-gray-900 pt-3 border-b border-gray-800 pb-1 break-after-avoid">{field.label}</h2>;
    case "note":
      return <p className="whitespace-pre-line text-gray-700">{field.label}</p>;
    case "text":
      return <Line label={field.label} />;
    case "date":
      return (
        <p className="flex items-end gap-2 break-inside-avoid">
          <span className="shrink-0">{field.label}</span>
          <span className="text-gray-400 tracking-[0.3em]">__ / __ / ____  at  __ : __</span>
        </p>
      );
    case "textarea":
      return (
        <div className="flex flex-col gap-1 break-inside-avoid">
          <p>{field.label}</p>
          <div className="flex flex-col gap-5 pt-3">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="block border-b border-gray-300" />
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function Line({ label }: { label: string }) {
  return (
    <p className="flex items-end gap-2 break-inside-avoid">
      <span className="shrink-0">{label}</span>
      <span className="flex-1 border-b border-gray-400 h-4" />
    </p>
  );
}
