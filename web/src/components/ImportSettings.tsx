import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type CsvImportResult } from "../lib/api";
import { normaliseHeader, parseCsv } from "../lib/csv";
import { errorText } from "../lib/errors";
import { useFeature, useRole } from "../lib/roles";
import { useToast } from "./ToastProvider";

type CsvKind = "items" | "contacts";

// R2 field, its label, and header names it's matched to automatically.
// hint shows on hover where the format isn't obvious.
const TARGETS: Record<CsvKind, { key: string; label: string; hint?: string; required?: boolean; aliases: string[] }[]> = {
  items: [
    { key: "name", label: "Name", required: true, aliases: ["name", "item", "itemname", "equipment", "product"] },
    { key: "code", label: "Code", aliases: ["code", "sku", "itemcode", "partnumber"] },
    { key: "category", label: "Category", hint: "e.g. Audio / Speakers", aliases: ["category", "folder", "group", "department"] },
    { key: "quantity", label: "Quantity", hint: "For bulk items", aliases: ["quantity", "qty", "stock", "count", "onhand", "owned"] },
    { key: "serials", label: "Unit barcodes", hint: "Separate with ;", aliases: ["serials", "serialnumbers", "barcodes", "assettags", "units"] },
    { key: "barcode", label: "Item barcode", aliases: ["barcode", "qr", "qrcode"] },
    { key: "price", label: "Price", aliases: ["price", "dayrate", "rate", "rentalprice", "dailyrate", "hireprice", "saleprice"] },
    { key: "priceUnit", label: "Price per", hint: "hour, day, week or each", aliases: ["priceunit", "per", "priceper", "unit", "uom", "rateunit"] },
    { key: "replacementValue", label: "Replacement cost", aliases: ["replacementvalue", "value", "replacementcost", "replacement"] },
    { key: "weightKg", label: "Weight (kg)", aliases: ["weight", "weightkg", "kg"] },
    { key: "powerW", label: "Power (W)", aliases: ["power", "powerw", "watts", "wattage"] },
    { key: "locationInWarehouse", label: "Shelf / bin", aliases: ["location", "shelf", "bin", "bay", "warehouselocation", "locationinwarehouse"] },
    { key: "description", label: "Description", hint: "Shown on quotes", aliases: ["description", "externalnote", "externalremark"] },
    { key: "notes", label: "Internal notes", aliases: ["notes", "note", "comments", "internalnote", "internalremark"] },
  ],
  contacts: [
    { key: "name", label: "Name", required: true, aliases: ["name", "company", "companyname", "organisation", "organization", "client"] },
    { key: "kind", label: "Company or person", aliases: ["type", "kind"] },
    { key: "contactPerson", label: "Contact person", aliases: ["contactperson", "contact", "person", "attn", "contactname"] },
    { key: "email", label: "Email", aliases: ["email", "emailaddress", "mail"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "phonenumber", "tel", "telephone"] },
    { key: "billingAddress", label: "Billing address", aliases: ["address", "billingaddress", "postaladdress", "invoiceaddress"] },
    { key: "notes", label: "Notes", aliases: ["notes", "note", "comments"] },
  ],
};

const KIND_LABELS: Record<CsvKind, string> = { items: "Inventory items", contacts: "Contacts" };

export default function ImportSettings() {
  const { can } = useRole();
  return <div className="flex flex-col gap-8">{can("import.csv") && <CsvImport />}</div>;
}

function CsvImport() {
  const queryClient = useQueryClient();
  const projectsOn = useFeature()("projects");
  const { showToast } = useToast();
  const [kind, setKind] = useState<CsvKind>("items");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const kinds: CsvKind[] = projectsOn ? ["items", "contacts"] : ["items"];
  const headers = table[0] ?? [];
  const targets = TARGETS[kind];
  const mapped = targets.filter((t) => mapping[t.key] !== undefined);

  function autoMap(nextHeaders: string[], nextKind: CsvKind) {
    const normalised = nextHeaders.map(normaliseHeader);
    const next: Record<string, number> = {};
    for (const t of TARGETS[nextKind]) {
      const index = normalised.findIndex((h) => t.aliases.includes(h));
      if (index !== -1 && !Object.values(next).includes(index)) next[t.key] = index;
    }
    setMapping(next);
  }

  async function load(file: File) {
    const rows = parseCsv(await file.text());
    setFileName(file.name);
    setTable(rows);
    setResult(null);
    autoMap(rows[0] ?? [], kind);
  }

  function clear() {
    setFileName("");
    setTable([]);
    setMapping({});
    setResult(null);
  }

  const rows = useMemo(
    () =>
      table.slice(1).map((r) => {
        const out: Record<string, string> = {};
        for (const [key, index] of Object.entries(mapping)) out[key] = (r[index] ?? "").trim();
        return out;
      }),
    [table, mapping],
  );

  async function send(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.importCsv(kind, rows, dryRun);
      setResult(r);
      if (r.committed) {
        await Promise.all(["items", "categories", "contacts", "availability", "import-runs"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
        showToast("success", `Imported ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
      }
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const checkedClean = !!result?.dryRun && result.errors.length === 0;
  const imported = !!result?.committed;

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <h2 className="text-sm font-semibold text-gray-900">Import from a spreadsheet</h2>

      <div className="card p-4 flex items-center gap-3 flex-wrap text-sm">
        {kinds.length > 1 ? (
          <div className="inline-flex rounded-md border border-gray-200 p-0.5">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setResult(null);
                  autoMap(headers, k);
                }}
                className={`px-3 py-1.5 rounded text-sm ${kind === k ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900"}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-medium text-gray-900">{KIND_LABELS[kind]}</span>
        )}
        <label className="btn-secondary cursor-pointer">
          {fileName ? "Choose another file" : "Choose CSV file"}
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) load(file);
              // Let the same file be picked again after fixing it.
              e.target.value = "";
            }}
          />
        </label>
        {fileName && (
          <span className="flex items-center gap-2 min-w-0 text-gray-600">
            <span className="truncate">{fileName}</span>
            <span className="text-gray-400 shrink-0">
              {table.length - 1} row{table.length === 2 ? "" : "s"}
            </span>
            <button onClick={clear} className="text-gray-400 hover:text-gray-900 shrink-0" aria-label="Clear file">
              ×
            </button>
          </span>
        )}
      </div>

      {table.length > 0 && (
        <>
          <section className="card p-4 flex flex-col gap-3 text-sm">
            <h3 className="font-medium text-gray-900">Columns</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {targets.map((t) => (
                <label key={t.key} className="flex items-center justify-between gap-2">
                  <span className="text-gray-600" title={t.hint}>
                    {t.label}
                    {t.required && <span className="text-red-500"> *</span>}
                  </span>
                  <select
                    value={mapping[t.key] ?? -1}
                    onChange={(e) => {
                      const index = Number(e.target.value);
                      setResult(null);
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (index < 0) delete next[t.key];
                        else next[t.key] = index;
                        return next;
                      });
                    }}
                    className={`input py-1 w-48 ${mapping[t.key] === undefined ? "text-gray-400" : ""}`}
                  >
                    <option value={-1}>Not imported</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          {mapped.length > 0 && rows.length > 0 && (
            <section className="card p-4 flex flex-col gap-2 text-sm">
              <h3 className="font-medium text-gray-900">Preview</h3>
              <table className="w-full table-fixed text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    {mapped.map((t) => (
                      <th key={t.key} className="px-2 py-1 font-medium truncate">
                        {t.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {mapped.map((t) => (
                        <td key={t.key} className="px-2 py-1 text-gray-700 truncate" title={r[t.key]}>
                          {r[t.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {result && (
            <div className={`rounded-md border p-3 text-sm ${result.errors.length ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
              {result.errors.length === 0 ? (
                <p>
                  {imported ? "Imported" : "Ready to import"}: {Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.
                </p>
              ) : (
                <>
                  <p className="font-medium mb-1">Nothing was saved. Fix these rows and choose the file again:</p>
                  <ul className="text-xs flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {!imported && (
            <div>
              {checkedClean ? (
                <button onClick={() => send(false)} disabled={busy} className="btn-primary">
                  {busy ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
                </button>
              ) : (
                <button onClick={() => send(true)} disabled={busy || mapping.name === undefined} className="btn-primary">
                  {busy ? "Checking…" : "Check file"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
