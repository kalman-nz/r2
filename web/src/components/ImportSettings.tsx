import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CsvImportResult, type RentmanImportResult, type RentmanImportStep } from "../lib/api";
import { normaliseHeader, parseCsv } from "../lib/csv";
import { formatDateTime } from "../lib/format";
import { errorText } from "../lib/errors";
import { useFeature, useRole } from "../lib/roles";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

type CsvKind = "items" | "contacts";

// R2 field, its label, and header names it's matched to automatically.
const TARGETS: Record<CsvKind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  items: [
    { key: "name", label: "Name", required: true, aliases: ["name", "item", "itemname", "equipment", "product"] },
    { key: "code", label: "Code", aliases: ["code", "sku", "itemcode", "partnumber"] },
    { key: "category", label: "Category (e.g. Audio / Speakers)", aliases: ["category", "folder", "group", "department"] },
    { key: "quantity", label: "Quantity (bulk items)", aliases: ["quantity", "qty", "stock", "count", "onhand", "owned"] },
    { key: "serials", label: "Unit barcodes (separate with ;)", aliases: ["serials", "serialnumbers", "barcodes", "assettags", "units"] },
    { key: "price", label: "Price", aliases: ["price", "dayrate", "rate", "rentalprice", "dailyrate", "hireprice", "saleprice"] },
    { key: "priceUnit", label: "Price per (hour, day, week, each)", aliases: ["priceunit", "per", "priceper", "unit", "uom", "rateunit"] },
    { key: "barcode", label: "Item barcode", aliases: ["barcode", "qr", "qrcode"] },
    { key: "replacementValue", label: "Replacement cost", aliases: ["replacementvalue", "value", "replacementcost", "replacement"] },
    { key: "weightKg", label: "Weight (kg)", aliases: ["weight", "weightkg", "kg"] },
    { key: "powerW", label: "Power (W)", aliases: ["power", "powerw", "watts", "wattage"] },
    { key: "locationInWarehouse", label: "Location in warehouse", aliases: ["location", "shelf", "bin", "bay", "warehouselocation"] },
    { key: "description", label: "Description (on quotes)", aliases: ["description", "externalnote", "externalremark"] },
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

export default function ImportSettings() {
  const { can } = useRole();
  return (
    <div className="flex flex-col gap-8">
      {can("import.rentman") && <RentmanImport />}
      {can("import.csv") && <CsvImport />}
    </div>
  );
}

function RentmanImport() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: runs = [] } = useQuery({ queryKey: ["import-runs"], queryFn: api.listImportRuns });
  const [token, setToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<RentmanImportResult | null>(null);
  const [what, setWhat] = useState({ equipment: true, contacts: false, projects: false });
  // Contacts and projects come in only while the organisation uses projects.
  const projectsOn = useFeature()("projects");

  async function saveToken(value: string) {
    setSavingToken(true);
    try {
      await api.updateSettings({ rentmanApiToken: value });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setToken("");
      showToast("success", value ? "Token saved" : "Token removed");
    } catch (err) {
      showToast("error", `Couldn't save the token: ${errorText(err)}`);
    } finally {
      setSavingToken(false);
    }
  }

  // Projects need their clients and locations, so they bring contacts with them.
  const steps: RentmanImportStep[] = [
    ...(what.equipment ? (["equipment"] as const) : []),
    ...(what.contacts || what.projects ? (["contacts"] as const) : []),
    ...(what.projects ? (["projects", "lines"] as const) : []),
  ];
  const STEP_LABEL: Record<RentmanImportStep, string> = {
    equipment: "equipment",
    contacts: "contacts and locations",
    projects: "projects",
    lines: "project equipment",
  };

  // A step at a time (project equipment a page at a time), so no one
  // request runs long. Everything goes in the same import run.
  async function runImport() {
    const parts = [what.equipment && "equipment, serial numbers, folders and stock locations", (what.contacts || what.projects) && "contacts and locations", what.projects && "projects with their equipment"].filter(Boolean);
    const ok = await confirm({
      title: "Import from Rentman",
      message: `Copy ${parts.join(", ")} from Rentman into R2? Running it again later updates what it imported before (overwriting edits made in R2 to those fields) and never deletes anything.`,
      confirmLabel: "Import",
    });
    if (!ok) return;
    setRunning(true);
    setResult(null);
    const startedAt = Date.now();
    let runId: string | undefined;
    try {
      let last: RentmanImportResult | null = null;
      for (const [i, step] of steps.entries()) {
        const final = i === steps.length - 1;
        let cursor: string | null = null;
        do {
          setProgress(`Importing ${STEP_LABEL[step]}…${step === "lines" && last?.counts.lines ? ` ${last.counts.lines.toLocaleString()} lines so far` : ""}`);
          last = await api.importRentman({ step, runId, cursor, final });
          runId = last.runId;
          cursor = last.next;
        } while (cursor);
      }
      if (last) setResult({ ...last, tookMs: Date.now() - startedAt });
      await Promise.all(
        ["items", "categories", "locations", "availability", "customFields", "import-runs", "contacts", "venues", "jobs"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      showToast("success", "Rentman import finished");
    } catch (err) {
      showToast("error", errorText(err));
      await queryClient.invalidateQueries({ queryKey: ["import-runs"] });
    } finally {
      setRunning(false);
      setProgress("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Import from Rentman</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {projectsOn
            ? "Pulls your equipment, contacts and projects out of your own Rentman account. Projects come with their equipment lines, priced as Rentman priced them. Crew, transport and other costs stay in Rentman."
            : "Pulls your equipment out of your own Rentman account: items, serial numbers, folders and stock locations."}
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="rentmanToken" className="text-sm text-gray-500">
            Rentman API token
          </label>
          <div className="flex items-center gap-2">
            <input
              id="rentmanToken"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings?.rentmanApiTokenSet ? "•••••••• (saved — paste a new one to replace it)" : "Paste your token"}
              className="input py-2 flex-1 font-mono"
            />
            <button onClick={() => saveToken(token.trim())} disabled={savingToken || !token.trim()} className="btn-secondary py-2">
              Save
            </button>
            {settings?.rentmanApiTokenSet && (
              <button onClick={() => saveToken("")} disabled={savingToken} className="text-sm text-red-600 hover:text-red-700">
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Create one in Rentman's API settings. It's stored on the server and never shown in the browser again.
          </p>
        </div>
        <div className="flex flex-col gap-2 pt-3 border-t border-gray-100 text-sm">
          <span className="text-gray-500">What to import</span>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={what.equipment} onChange={(e) => setWhat((w) => ({ ...w, equipment: e.target.checked }))} disabled={running} className="mt-0.5" />
            <span>
              Equipment
              <span className="block text-xs text-gray-500">Items, serial numbers, folders, stock locations and custom fields</span>
            </span>
          </label>
          {projectsOn && (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={what.contacts || what.projects}
                  onChange={(e) => setWhat((w) => ({ ...w, contacts: e.target.checked }))}
                  disabled={running || what.projects}
                  className="mt-0.5"
                />
                <span>
                  Contacts and locations
                  <span className="block text-xs text-gray-500">Clients become contacts; the places projects happen become locations</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={what.projects} onChange={(e) => setWhat((w) => ({ ...w, projects: e.target.checked }))} disabled={running} className="mt-0.5" />
                <span>
                  Projects
                  <span className="block text-xs text-gray-500">
                    With their dates, status and equipment. Brings contacts too. Import equipment first, or its lines come in as plain text lines.
                  </span>
                </span>
              </label>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={runImport} disabled={running || !settings?.rentmanApiTokenSet || steps.length === 0} className="btn-primary py-2">
            {running ? "Importing…" : "Import now"}
          </button>
          {running && <span className="text-sm text-gray-500">{progress}</span>}
        </div>
        {result && (
          <div className="text-sm flex flex-col gap-2">
            <p className="text-gray-700">
              Imported {Object.entries(result.counts).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(", ")} in {(result.tookMs / 1000).toFixed(0)}s.
            </p>
            {result.errors.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800 max-h-48 overflow-y-auto">
                <p className="font-medium mb-1">{result.errors.length} records couldn't be imported:</p>
                <ul className="text-xs flex flex-col gap-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.resource} {e.rentmanId}
                      {e.name ? ` (${e.name})` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <div className="card overflow-hidden">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-4 pt-3 pb-1">Recent imports</h3>
          <div className="divide-y divide-gray-100">
            {runs.map((run) => (
              <div key={run.id} className="px-4 py-2 text-xs flex items-center justify-between gap-3">
                <span className="text-gray-700">
                  {run.source === "rentman" ? "Rentman" : `CSV ${run.counts.kind ?? ""}`} ·{" "}
                  <span className={run.status === "failed" ? "text-red-600" : run.status === "ok" ? "text-emerald-700" : "text-gray-500"}>
                    {run.status}
                  </span>
                  {run.message ? ` · ${run.message}` : ""}
                  {run.errors?.length ? ` · ${run.errors.length} problems` : ""}
                </span>
                <span className="text-gray-400 shrink-0">
                  {run.who} · {formatDateTime(run.created)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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

  const headers = table[0] ?? [];
  const targets = TARGETS[kind];

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
        await Promise.all(
          ["items", "categories", "contacts", "availability", "import-runs"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
        );
        showToast("success", `Imported ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
      }
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const checkedClean = result?.dryRun && result.errors.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Import from a spreadsheet</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Save the sheet as CSV. Nothing is saved until the whole file checks out — one bad row and nothing changes, so it's safe to
          fix the file and try again.
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as CsvKind;
              setKind(next);
              setResult(null);
              autoMap(headers, next);
            }}
            className="input py-2 w-auto"
          >
            <option value="items">Inventory items</option>
            {projectsOn && <option value="contacts">Contacts</option>}
          </select>
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) load(file);
            }}
            className="text-sm text-gray-600"
          />
        </div>

        {table.length > 0 && (
          <>
            <p className="text-xs text-gray-500">
              {fileName}: {table.length - 1} rows. Match each R2 field to a column (guessed from the headers).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {targets.map((t) => (
                <label key={t.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-600">
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
                    className="input py-1 w-44"
                  >
                    <option value={-1}>— not imported —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="overflow-x-auto border border-gray-100 rounded-md">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-50">
                    {targets
                      .filter((t) => mapping[t.key] !== undefined)
                      .map((t) => (
                        <th key={t.key} className="px-2 py-1 font-medium whitespace-nowrap">
                          {t.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {targets
                        .filter((t) => mapping[t.key] !== undefined)
                        .map((t) => (
                          <td key={t.key} className="px-2 py-1 text-gray-700 max-w-48 truncate">
                            {r[t.key]}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => send(true)} disabled={busy || mapping.name === undefined} className="btn-secondary py-2">
                {busy ? "Checking…" : "Check file"}
              </button>
              <button onClick={() => send(false)} disabled={busy || !checkedClean} className="btn-primary py-2">
                Import {rows.length} rows
              </button>
            </div>

            {result && (
              <div
                className={`rounded-md border p-3 text-sm ${
                  result.errors.length ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"
                }`}
              >
                {result.errors.length === 0 ? (
                  <p>
                    {result.committed ? "Imported" : "Ready to import"}: {Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.
                  </p>
                ) : (
                  <>
                    <p className="font-medium mb-1">Fix these rows and choose the file again (nothing was saved):</p>
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
          </>
        )}
      </div>
    </div>
  );
}
