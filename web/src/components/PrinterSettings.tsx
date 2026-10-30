import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLocations } from "../lib/catalog";
import { errorText } from "../lib/errors";
import { generateId } from "../lib/id";
import { printTestLabel } from "../lib/print";
import {
  BROTHER_MEDIA,
  BROTHER_MODELS,
  brotherMedia,
  sizeLabel,
  usePrinting,
  type LabelSize,
  type Printer,
  type PrintingConfig,
} from "../lib/printing";
import NumberInput from "./NumberInput";
import PrintAgentsSection, { usePrintAgents } from "./PrintAgentsSection";
import Switch from "./Switch";
import { useToast } from "./ToastProvider";

// Settings → Printer setup: the label stock the business uses, each
// Brother printer with what's loaded in it and where it is, and the print
// agents at the venues that printers go through (PrintAgentsSection, saved
// as they're changed). Printers and sizes are edited as a draft, saved
// together.
export default function PrinterSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: config, isLoading, error } = usePrinting();
  const [draft, setDraft] = useState<PrintingConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (config && !draft) setDraft(config);
  }, [config, draft]);

  const dirty = !!draft && !!config && JSON.stringify(draft) !== JSON.stringify(config);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.updatePrinting(draft);
      queryClient.setQueryData(["printing"], saved);
      queryClient.invalidateQueries({ queryKey: ["printerStatus"] });
      setDraft(saved);
      setEditing(null);
      showToast("success", "Printer setup saved");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="card p-4 text-sm text-red-700">
        Couldn't load printer setup: {errorText(error)}
        {(error as { status?: number }).status === 404 && (
          <p className="mt-1 text-gray-500">The server is older than this page — restart it to pick up the new printing routes.</p>
        )}
      </div>
    );
  }
  if (isLoading || !draft) return <p className="text-gray-500 text-sm">Loading…</p>;

  const update = (patch: Partial<PrintingConfig>) => setDraft({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-8 pb-16">
      <PrintersSection
        draft={draft}
        saved={config ?? draft}
        editing={editing}
        setEditing={setEditing}
        onChange={(printers) => update({ printers })}
      />
      <PrintAgentsSection />
      <SizesSection draft={draft} editing={editing} setEditing={setEditing} onChange={(sizes) => update({ sizes })} />

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 card shadow-lg px-4 py-2.5">
          <span className="text-sm text-gray-600">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setDraft(config ?? null);
                setEditing(null);
              }}
              className="btn-secondary"
            >
              Discard
            </button>
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {action}
    </div>
  );
}

// --- Printers ---------------------------------------------------------------

function PrintersSection({
  draft,
  saved,
  editing,
  setEditing,
  onChange,
}: {
  draft: PrintingConfig;
  saved: PrintingConfig;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onChange: (printers: Printer[]) => void;
}) {
  const { showToast } = useToast();
  const { data: locations = [] } = useLocations();
  const ids = saved.printers.map((p) => p.id).join(",");
  const { data: status, isFetching: checking, refetch } = useQuery({
    queryKey: ["printerStatus", "settings", ids],
    queryFn: () => api.checkPrinters(),
    enabled: ids !== "",
    staleTime: 20_000,
    retry: false,
  });
  const [testing, setTesting] = useState<string | null>(null);
  const { data: agents = [] } = usePrintAgents();
  // Off on a cloud server: every printer goes through an agent at its venue.
  const direct = draft.direct !== false;
  const brotherSizes = draft.sizes.filter((s) => s.brother);
  const sizeName = (id: string) => draft.sizes.find((s) => s.id === id)?.name;
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name;

  function add() {
    const printer: Printer = {
      id: generateId(),
      name: `Printer ${draft.printers.length + 1}`,
      host: "",
      model: "QL-810W",
      sizeId: brotherSizes[0]?.id ?? "",
      locationId: "",
      agentId: direct ? "" : (agents[0]?.id ?? ""),
      isDefault: draft.printers.length === 0,
      enabled: true,
    };
    onChange([...draft.printers, printer]);
    setEditing(printer.id);
  }

  const patch = (id: string, p: Partial<Printer>) => onChange(draft.printers.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const makeDefault = (id: string) => onChange(draft.printers.map((x) => ({ ...x, isDefault: x.id === id })));

  async function test(printer: Printer) {
    setTesting(printer.id);
    try {
      const result = await printTestLabel(printer, draft.sizes.find((s) => s.id === printer.sizeId) ?? null);
      showToast(result.ok ? "success" : "error", result.ok ? `Test label sent to ${printer.name}` : `${printer.name}: ${result.message}`);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setTesting(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Printers"
        action={
          <div className="flex items-center gap-2 shrink-0">
            {draft.printers.length > 0 && (
              <button onClick={() => refetch()} disabled={checking} className="btn-secondary">
                {checking ? "Checking…" : "Check status"}
              </button>
            )}
            <button onClick={add} className="btn-primary">
              Add printer
            </button>
          </div>
        }
      />

      {draft.printers.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-500">
          No printers yet.
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {draft.printers.map((p) => {
            const s = status?.[p.id];
            const isSaved = saved.printers.some((x) => x.id === p.id);
            const open = editing === p.id;
            return (
              <div key={p.id} className={!p.enabled ? "bg-gray-50/60" : undefined}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      !isSaved || !p.enabled ? "bg-gray-300" : !s ? (checking ? "bg-gray-300 animate-pulse" : "bg-gray-300") : s.ok ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    title={!p.enabled ? "Turned off" : !isSaved ? "Save to check" : s ? s.message : "Not checked"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${p.enabled ? "text-gray-900" : "text-gray-500"}`}>
                      {p.name}
                      {(p.isDefault || !p.enabled) && (
                        <span className="font-normal text-gray-400"> · {!p.enabled ? "not in use" : "default"}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 mt-0.5">
                      <span className="font-mono">{p.host || "No address"}</span>
                      <span>{p.model}</span>
                      <span>{sizeName(p.sizeId) ? `${sizeName(p.sizeId)} loaded` : "Nothing loaded"}</span>
                      {locationName(p.locationId) && <span>{locationName(p.locationId)}</span>}
                      {p.agentId ? (
                        <span>via {agentName(p.agentId) ?? "a removed agent"}</span>
                      ) : (
                        !direct && <span className="text-amber-700">Needs a print agent</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => test(p)}
                      disabled={!isSaved || !p.host || testing === p.id}
                      title={isSaved ? "Print a test label" : "Save first"}
                      className="btn-secondary"
                    >
                      {testing === p.id ? "Sending…" : "Test"}
                    </button>
                    {!open && (
                      <button onClick={() => setEditing(p.id)} className="btn-secondary">
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
                    <Labelled label="Name">
                      <input value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} className="input py-1.5" />
                    </Labelled>
                    <Labelled label="Network address">
                      <input
                        value={p.host}
                        onChange={(e) => patch(p.id, { host: e.target.value.trim() })}
                        placeholder="192.168.1.50"
                        className="input py-1.5 font-mono"
                      />
                    </Labelled>
                    <Labelled label="Model">
                      <select value={p.model} onChange={(e) => patch(p.id, { model: e.target.value })} className="input py-1.5">
                        {BROTHER_MODELS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </Labelled>
                    <Labelled label="Loaded with">
                      <select value={p.sizeId} onChange={(e) => patch(p.id, { sizeId: e.target.value })} className="input py-1.5">
                        <option value="">Nothing</option>
                        {brotherSizes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </Labelled>
                    <Labelled label="Prints through">
                      <select value={p.agentId ?? ""} onChange={(e) => patch(p.id, { agentId: e.target.value })} className="input py-1.5">
                        {(direct || !p.agentId) && <option value="">{direct ? "This server" : agents.length === 0 ? "Add a print agent first" : "Pick a print agent"}</option>}
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </Labelled>
                    <Labelled label="Location">
                      <select value={p.locationId} onChange={(e) => patch(p.id, { locationId: e.target.value })} className="input py-1.5">
                        <option value="">Anywhere</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </Labelled>
                    <div className="flex flex-col gap-2.5 justify-end">
                      <Switch checked={p.enabled} onChange={(enabled) => patch(p.id, { enabled })} label="In use" />
                      <div className="flex items-center gap-3 text-sm">
                        {!p.isDefault && (
                          <button onClick={() => makeDefault(p.id)} className="text-gray-600 hover:text-gray-900">
                            Make default
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const rest = draft.printers.filter((x) => x.id !== p.id);
                            if (p.isDefault && rest[0]) rest[0] = { ...rest[0], isDefault: true };
                            onChange(rest);
                            setEditing(null);
                          }}
                          className="text-red-600 hover:text-red-700 ml-auto"
                        >
                          Remove printer
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}

// --- Label sizes --------------------------------------------------------

function SizesSection({
  draft,
  editing,
  setEditing,
  onChange,
}: {
  draft: PrintingConfig;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onChange: (sizes: LabelSize[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const loadedIn = (id: string) => draft.printers.filter((p) => p.sizeId === id).map((p) => p.name);
  const patch = (id: string, p: Partial<LabelSize>) => onChange(draft.sizes.map((s) => (s.id === id ? { ...s, ...p } : s)));

  function add(choice: string) {
    if (!choice) return;
    let size: LabelSize;
    if (choice === "custom") {
      size = { id: generateId(), name: "New size", widthMm: 50, lengthMm: 25, continuous: false, brother: "" };
    } else {
      const m = brotherMedia(choice)!;
      size = {
        id: generateId(),
        name: m.name,
        widthMm: m.widthMm,
        lengthMm: m.lengthMm || 30,
        continuous: m.lengthMm === 0,
        brother: m.id,
      };
    }
    onChange([...draft.sizes, size]);
    setEditing(size.id);
    setAdding("");
  }

  const used = new Set(draft.sizes.map((s) => s.brother).filter(Boolean));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Label sizes"
        action={
          <select value={adding} onChange={(e) => add(e.target.value)} className="input py-1.5 w-auto shrink-0">
            <option value="">Add a size…</option>
            <optgroup label="Brother tape">
              {BROTHER_MEDIA.filter((m) => m.lengthMm === 0).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {used.has(m.id) ? " (added)" : ""}
                </option>
              ))}
            </optgroup>
            <optgroup label="Brother die-cut labels">
              {BROTHER_MEDIA.filter((m) => m.lengthMm > 0).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {used.has(m.id) ? " (added)" : ""}
                </option>
              ))}
            </optgroup>
            <option value="custom">Other size (Zebra, sheets — printed from a PDF)</option>
          </select>
        }
      />

      <div className="card divide-y divide-gray-100">
        {draft.sizes.map((s) => {
          const printers = loadedIn(s.id);
          const open = editing === s.id;
          return (
            <div key={s.id} className={s.hidden ? "bg-gray-50/60" : undefined}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <SizeIcon size={s} />
                <div className="min-w-0 flex-1">
                  <div className={`font-medium text-sm ${s.hidden ? "text-gray-400" : "text-gray-900"}`}>{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {sizeLabel(s)} · {s.brother ? (s.continuous ? "Brother tape" : "Brother labels") : "PDF"}
                    {printers.length > 0 && ` · in ${printers.join(", ")}`}
                    {s.hidden && " · hidden"}
                  </div>
                </div>
                {!open && (
                  <button onClick={() => setEditing(s.id)} className="btn-secondary">
                    Edit
                  </button>
                )}
              </div>
              {open && (
                <div className="px-4 pb-4 grid sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))] gap-3 items-end">
                  <Labelled label="Name">
                    <input value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} className="input py-1.5" />
                  </Labelled>
                  <Labelled label="Width (mm)">
                    <NumberInput
                      min={5}
                      max={300}
                      value={s.widthMm}
                      onChange={(widthMm) => patch(s.id, { widthMm })}
                      disabled={!!s.brother}
                      className="input py-1.5"
                    />
                  </Labelled>
                  <Labelled label={s.continuous ? "Starting length (mm)" : "Length (mm)"}>
                    <NumberInput
                      min={5}
                      max={1000}
                      value={s.lengthMm}
                      onChange={(lengthMm) => patch(s.id, { lengthMm })}
                      disabled={!!s.brother && !s.continuous}
                      className="input py-1.5"
                    />
                  </Labelled>
                  <div className="sm:col-span-3 flex items-center gap-4 text-sm">
                    <Switch checked={!s.hidden} onChange={(on) => patch(s.id, { hidden: !on })} label="Offer when designing" />
                    <button
                      onClick={() => {
                        onChange(draft.sizes.filter((x) => x.id !== s.id));
                        setEditing(null);
                      }}
                      disabled={printers.length > 0}
                      title={printers.length > 0 ? `Loaded in ${printers.join(", ")}` : undefined}
                      className="text-red-600 hover:text-red-700 ml-auto disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Remove size
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// A little to-scale outline: tape runs off the bottom, labels are cut.
function SizeIcon({ size }: { size: LabelSize }) {
  const media = brotherMedia(size.brother);
  const w = size.widthMm;
  const h = size.continuous ? Math.max(w * 1.4, 20) : size.lengthMm;
  const k = 26 / Math.max(w, h);
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0 text-gray-400" aria-hidden>
      {media?.round ? (
        <circle cx="14" cy="14" r={(w * k) / 2} fill="white" stroke="currentColor" />
      ) : (
        <rect
          x={14 - (w * k) / 2}
          y={14 - (h * k) / 2}
          width={w * k}
          height={h * k}
          rx={size.continuous ? 0 : 1.5}
          fill="white"
          stroke="currentColor"
          strokeDasharray={size.continuous ? "0" : undefined}
        />
      )}
      {size.continuous && <path d={`M${14 - (w * k) / 2} ${14 + (h * k) / 2 - 3}h${w * k}`} stroke="currentColor" strokeDasharray="2 2" />}
    </svg>
  );
}
