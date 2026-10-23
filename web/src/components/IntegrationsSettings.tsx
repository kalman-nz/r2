import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type IntegrationProvider,
  type IntegrationSummary,
  type JobStatus,
  type MomentusSyncConfig,
  type RentmanSyncConfig,
  type SyncLogEntry,
} from "../lib/api";
import { errorText } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import { saveFile } from "../lib/download";
import { displayPath, useCategoryPaths } from "../lib/catalog";
import Field from "./Field";
import Switch from "./Switch";
import Segmented from "./Segmented";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

// Settings → Integrations: live sync with Rentman and Momentus
// (pb_hooks/lib/sync.js). The worker on the server does the syncing every
// minute; this page sets it up and shows how it's going.

const STAGES: { value: JobStatus; label: string }[] = [
  { value: "enquiry", label: "Enquiry" },
  { value: "provisional", label: "Provisional" },
  { value: "confirmed", label: "Confirmed" },
  { value: "out", label: "Out" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
];

const CONFLICT_OPTIONS = (other: string) => [
  { value: "newest", label: "Newest edit wins" },
  { value: "remote", label: `${other} wins` },
  { value: "local", label: "R2 wins" },
];

const msDate = (ms: number | null) => (ms ? formatDateTime(new Date(ms).toISOString()) : "never");

export default function IntegrationsSettings() {
  const { data, isLoading, error } = useQuery({ queryKey: ["integrations"], queryFn: api.getIntegrations, refetchInterval: 15_000 });
  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !data) return <p className="text-red-600 text-sm">Couldn't load integrations: {errorText(error)}</p>;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Integrations</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Keep R2 in step with the other systems you use. R2 checks for changes every minute in the background, so you can keep working in either one.
          Nothing is ever deleted across systems: something removed on one side is archived on the other.
        </p>
      </div>
      <RentmanCard summary={data.rentman} />
      <MomentusCard summary={data.momentus} />
    </div>
  );
}

// ------------------------------------------------------------- shared

function useSave(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  async function save(changes: Record<string, unknown>, message = "Saved") {
    setSaving(true);
    try {
      await api.updateIntegration(provider, changes);
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("success", message);
      return true;
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return { save, saving };
}

function Card({ title, subtitle, status, children }: { title: string; subtitle: string; status: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        {status}
      </div>
      <div className="card p-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pt-4 border-t border-gray-100 first:pt-0 first:border-t-0">
      <div>
        <h4 className="text-sm font-medium text-gray-900">{title}</h4>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function StatusPill<C extends { enabled: boolean; paused: boolean }>({ summary }: { summary: IntegrationSummary<C> }) {
  const { config, state, failed } = summary;
  let label = "Off";
  let tone = "bg-gray-100 text-gray-600";
  if (config.enabled && config.paused) {
    label = "Paused";
    tone = "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  } else if (config.enabled && (state.lastError || failed.length)) {
    label = "Needs attention";
    tone = "bg-red-50 text-red-700 ring-1 ring-red-200";
  } else if (config.enabled) {
    label = state.lastPollAt ? "Live" : "Starting…";
    tone = "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  }
  return <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${tone}`}>{label}</span>;
}

function SecretInput({ label, isSet, hint, onSave, saving }: { label: string; isSet: boolean; hint: string; onSave: (value: string) => void; saving: boolean }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          aria-label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isSet ? "•••••••• (saved — paste a new one to replace it)" : "Paste it here"}
          className="input py-2 flex-1 font-mono"
        />
        <button
          onClick={() => {
            onSave(value.trim());
            setValue("");
          }}
          disabled={saving || !value.trim()}
          className="btn-secondary py-2"
        >
          Save
        </button>
      </div>
      <span className="text-xs text-gray-500">{hint}</span>
    </div>
  );
}

// Test connection, Sync now, Pause, and how the last checks went.
function Controls<C extends { enabled: boolean; paused: boolean }>({
  provider,
  summary,
  canStart,
  extra,
  onEnable,
}: {
  provider: IntegrationProvider;
  summary: IntegrationSummary<C>;
  canStart: boolean;
  extra?: ReactNode;
  // Instead of saving straight away, e.g. to confirm first.
  onEnable?: (on: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { save, saving } = useSave(provider);
  const [busy, setBusy] = useState("");
  const { config, state, pending } = summary;

  async function test() {
    setBusy("test");
    try {
      const r = await api.testIntegration(provider);
      showToast(r.ok ? "success" : "error", r.message);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      await api.integrationAction(provider, "sync");
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("success", "Sync queued: it runs within a minute");
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch
          checked={config.enabled}
          disabled={saving || (!config.enabled && !canStart)}
          onChange={(on) => (onEnable ? onEnable(on) : save({ enabled: on }, on ? "Sync is on" : "Sync is off"))}
          label={config.enabled ? "Sync is on" : "Sync is off"}
        />
        {config.enabled && (
          <Switch checked={config.paused} disabled={saving} onChange={(on) => save({ paused: on }, on ? "Paused" : "Resumed")} label="Paused" />
        )}
        <div className="flex flex-wrap gap-2 ml-auto">
          <button onClick={test} disabled={!!busy || !canStart} className="btn-secondary py-1.5 text-sm">
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button onClick={syncNow} disabled={!!busy || !config.enabled || config.paused} className="btn-secondary py-1.5 text-sm">
            {busy === "sync" ? "Queuing…" : "Sync now"}
          </button>
          {extra}
        </div>
      </div>
      {!canStart && !config.enabled && <p className="text-xs text-gray-500">Add the connection details below first.</p>}
      {config.enabled && (
        <p className="text-xs text-gray-500">
          Last checked {msDate(state.lastPollAt)}
          {pending > 0 ? ` · ${pending} change${pending === 1 ? "" : "s"} waiting to sync` : ""}
          {Object.keys(summary.links).length > 0 &&
            ` · ${Object.entries(summary.links)
              .map(([k, n]) => `${n.toLocaleString()} ${n === 1 ? (COLLECTION_ONE[k] ?? k) : (COLLECTION_LABEL[k] ?? k)}`)
              .join(", ")} linked`}
        </p>
      )}
      {state.lastError && <p className="text-xs rounded-md bg-red-50 border border-red-200 text-red-700 p-2">Last check failed: {state.lastError}</p>}
    </div>
  );
}

const COLLECTION_ONE: Record<string, string> = {
  items: "item",
  serials: "unit",
  categories: "category",
  locations: "stock location",
  contacts: "contact",
  venues: "location",
  jobs: "project",
  job_lines: "project line",
  quotes: "quote",
};

const COLLECTION_LABEL: Record<string, string> = {
  items: "items",
  serials: "units",
  categories: "categories",
  locations: "stock locations",
  contacts: "contacts",
  venues: "locations",
  jobs: "projects",
  job_lines: "project lines",
  quotes: "quotes",
};

function FailedList<C>({ provider, summary }: { provider: IntegrationProvider; summary: IntegrationSummary<C> }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  if (summary.failed.length === 0) return null;
  async function act(action: "retry" | "discard") {
    try {
      await api.integrationAction(provider, action);
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("success", action === "retry" ? "Trying again" : "Cleared");
    } catch (err) {
      showToast("error", errorText(err));
    }
  }
  return (
    <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {summary.failed.length} change{summary.failed.length === 1 ? "" : "s"} couldn't sync
        </p>
        <div className="flex gap-3 text-sm">
          <button onClick={() => act("retry")} className="font-medium hover:underline">
            Try again
          </button>
          <button onClick={() => act("discard")} className="text-amber-700 hover:underline">
            Clear
          </button>
        </div>
      </div>
      <ul className="text-xs flex flex-col gap-1 max-h-40 overflow-y-auto">
        {summary.failed.map((f) => (
          <li key={f.id}>
            <span className="font-medium">
              {f.action} {COLLECTION_LABEL[f.collection] ?? f.collection}
            </span>
            : {f.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivityLog({ provider, otherName }: { provider: IntegrationProvider; otherName: string }) {
  const [open, setOpen] = useState(false);
  const { data: entries = [] } = useQuery({ queryKey: ["integration-log", provider], queryFn: () => api.integrationLog(provider), enabled: open, refetchInterval: open ? 15_000 : false });
  return (
    <div className="pt-4 border-t border-gray-100">
      <button onClick={() => setOpen((o) => !o)} className="text-sm text-gray-600 hover:text-gray-900" aria-expanded={open}>
        {open ? "▾" : "▸"} Sync history
      </button>
      {open && (
        <div className="mt-2 flex flex-col divide-y divide-gray-100">
          {entries.length === 0 && <p className="text-xs text-gray-500 py-2">Nothing yet.</p>}
          {entries.map((e) => (
            <LogEntry key={e.id} entry={e} otherName={otherName} />
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { poll: "Check", queue: "Changes", webhook: "Webhook" };

function LogEntry({ entry, otherName }: { entry: SyncLogEntry; otherName: string }) {
  const [open, setOpen] = useState(false);
  const counts = Object.entries(entry.counts).filter(([, n]) => n > 0);
  const detail = entry.errors.length > 0 || entry.conflicts.length > 0;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(blank)" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="py-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-gray-700">
          {KIND_LABEL[entry.kind] ?? entry.kind}
          {entry.who ? ` (${entry.who})` : ""} ·{" "}
          <span className={entry.status === "failed" ? "text-red-600" : entry.status === "partial" ? "text-amber-700" : "text-emerald-700"}>
            {entry.status === "ok" ? "ok" : entry.status === "partial" ? "some problems" : "failed"}
          </span>
          {counts.length > 0 && ` · ${counts.map(([k, n]) => `${n.toLocaleString()} ${k}`).join(", ")}`}
          {entry.message && ` · ${entry.message}`}
          {detail && (
            <button onClick={() => setOpen((o) => !o)} className="ml-2 text-signal hover:underline">
              {open ? "hide" : `${entry.errors.length ? `${entry.errors.length} problems` : ""}${entry.errors.length && entry.conflicts.length ? ", " : ""}${entry.conflicts.length ? `${entry.conflicts.length} conflicts` : ""}`}
            </button>
          )}
        </span>
        <span className="text-gray-400 shrink-0">{formatDateTime(entry.startedAt)}</span>
      </div>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 text-gray-600">
          {entry.conflicts.map((c, i) => (
            <li key={`c${i}`}>
              Both changed {COLLECTION_LABEL[c.collection] ?? c.collection} {c.remoteId} {c.field}: R2 had “{show(c.local)}”, {otherName} had “{show(c.remote)}” → kept{" "}
              {c.winner === "local" ? "R2's" : `${otherName}'s`}
            </li>
          ))}
          {entry.errors.map((e, i) => (
            <li key={`e${i}`} className="text-red-700">
              {e.what} {e.id}
              {e.name ? ` (${e.name})` : ""}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CopyField({ label, value, hint }: { label: string; value: string; hint: ReactNode }) {
  const { showToast } = useToast();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <input readOnly value={value} aria-label={label} className="input py-2 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            showToast("success", "Copied");
          }}
          className="btn-secondary py-2"
        >
          Copy
        </button>
      </div>
      <span className="text-xs text-gray-500">{hint}</span>
    </div>
  );
}

// ------------------------------------------------------------ Rentman

function RentmanCard({ summary }: { summary: IntegrationSummary<RentmanSyncConfig> }) {
  const { save, saving } = useSave("rentman");
  const confirm = useConfirm();
  const [draft, setDraft] = useState(summary.config);
  useEffect(() => setDraft(summary.config), [summary.config]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(summary.config);
  const set = <K extends keyof RentmanSyncConfig>(key: K, value: RentmanSyncConfig[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function saveDraft() {
    const { enabled: _e, paused: _p, webhookKey: _w, ...rest } = draft;
    await save(rest);
  }

  async function turnOn(on: boolean) {
    if (on && !summary.state.initialDone) {
      const ok = await confirm({
        title: "Start syncing with Rentman",
        message:
          "R2 will bring in your Rentman equipment, contacts and projects, then keep both in step. Anything you imported before is linked up rather than copied again; where the two differ, the first sync keeps " +
          (draft.firstSync === "local" ? "R2's" : "Rentman's") +
          " version.",
        confirmLabel: "Start syncing",
      });
      if (!ok) return;
    }
    await save({ enabled: on }, on ? "Sync is on" : "Sync is off");
  }

  const twoWay: { key: "items" | "contacts" | "venues"; label: string; hint: string }[] = [
    { key: "items", label: "Equipment", hint: "Name, code, folder, price, weight, power, warehouse location, remarks, archived" },
    { key: "contacts", label: "Clients", hint: "Name, company or person, email, phone" },
    { key: "venues", label: "Locations", hint: "Name and phone of the places projects happen" },
  ];

  return (
    <Card
      title="Rentman"
      subtitle="Two-way sync with your Rentman account, for running both side by side or switching over gradually."
      status={<StatusPill summary={summary} />}
    >
      <Controls provider="rentman" summary={summary} canStart={summary.secretSet} onEnable={turnOn} />
      <FailedList provider="rentman" summary={summary} />

      <Section title="Connection">
        <SecretInput
          label="Rentman API token"
          isSet={summary.secretSet}
          saving={saving}
          onSave={(secret) => save({ secret }, "Token saved")}
          hint="Create one in Rentman under Configuration → Integrations → API. The same token as Settings → Import. Stored on the server, never shown again."
        />
        {summary.webhookUrl && (
          <CopyField
            label="Webhook address"
            value={summary.webhookUrl}
            hint={
              <>
                For changes in Rentman to arrive within a minute, add this address in Rentman under Configuration → Integrations → Webhooks. Without it R2 still
                catches up every {summary.config.pollMinutes} minutes.{" "}
                {summary.state.lastWebhookAt ? `Last webhook ${msDate(summary.state.lastWebhookAt)}.` : "No webhook received yet."}
              </>
            }
          />
        )}
      </Section>

      <Section title="What syncs both ways" hint="Edits on either side go to the other. Everything else Rentman has (stock counts, serial numbers, addresses) comes into R2 only.">
        <div className="flex flex-col gap-3">
          {twoWay.map((t) => (
            <div key={t.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="sm:w-40 shrink-0">
                <div className="text-sm text-gray-900">{t.label}</div>
                <div className="text-xs text-gray-500">{t.hint}</div>
              </div>
              <Segmented
                label={`${t.label} direction`}
                value={draft.sync[t.key]}
                onChange={(v) => set("sync", { ...draft.sync, [t.key]: v })}
                options={[
                  { value: "both", label: "Both ways" },
                  { value: "in", label: "From Rentman only" },
                ]}
              />
              <label className={`flex items-center gap-2 text-sm ${draft.sync[t.key] !== "both" ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={draft.createInRentman[t.key]}
                  disabled={draft.sync[t.key] !== "both"}
                  onChange={(e) => set("createInRentman", { ...draft.createInRentman, [t.key]: e.target.checked })}
                />
                New ones made in R2 go to Rentman
              </label>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Projects"
        hint="Rentman doesn't let other apps change its projects, so projects and their equipment come into R2 only. Edits made to them in R2 stay in R2 until that same detail changes in Rentman."
      >
        <Switch checked={draft.projects} onChange={(v) => set("projects", v)} label="Bring in projects and their equipment" />
        <Switch checked={draft.projectRequests} onChange={(v) => set("projectRequests", v)} label="Let people send R2 projects to Rentman as project requests" />
        {draft.projectRequests && (
          <p className="text-xs text-gray-500 -mt-1">
            A “Send to Rentman” option appears on R2 projects. Someone accepts the request in Rentman, and the project then links back up with the R2 one.
          </p>
        )}
      </Section>

      <Section title="When both sides change the same thing">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Conflicts" hint="Every conflict is listed in the sync history">
            <select value={draft.conflictRule} onChange={(e) => set("conflictRule", e.target.value as RentmanSyncConfig["conflictRule"])} className="input py-2">
              {CONFLICT_OPTIONS("Rentman").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="First sync of records imported before" hint="Where R2 and Rentman already differ">
            <select value={draft.firstSync} onChange={(e) => set("firstSync", e.target.value as RentmanSyncConfig["firstSync"])} className="input py-2">
              <option value="remote">Rentman's version wins</option>
              <option value="local">R2's version wins</option>
            </select>
          </Field>
          <Field label="Catch up every (minutes)" hint="In case a webhook was missed">
            <input type="number" min={1} value={draft.pollMinutes} onChange={(e) => set("pollMinutes", Number(e.target.value))} className="input py-2" />
          </Field>
          <Field label="Re-read all project equipment every (hours)" hint="The longest list; webhooks keep it current in between">
            <input type="number" min={1} value={draft.linesPollHours} onChange={(e) => set("linesPollHours", Number(e.target.value))} className="input py-2" />
          </Field>
        </div>
      </Section>

      <SaveBar dirty={dirty} saving={saving} onSave={saveDraft} onReset={() => setDraft(summary.config)} />
      <ActivityLog provider="rentman" otherName="Rentman" />
    </Card>
  );
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
      <button onClick={onSave} disabled={saving || !dirty} className="btn-primary py-2">
        {saving ? "Saving…" : "Save changes"}
      </button>
      {dirty && (
        <button onClick={onReset} className="text-sm text-gray-500 hover:text-gray-800">
          Undo
        </button>
      )}
    </div>
  );
}

// ----------------------------------------------------------- Momentus

const listText = (list: string[]) => list.join(", ");
const textList = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function MomentusCard({ summary }: { summary: IntegrationSummary<MomentusSyncConfig> }) {
  const { save, saving } = useSave("momentus");
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const categoryPaths = useCategoryPaths();
  const [draft, setDraft] = useState(summary.config);
  const [departments, setDepartments] = useState(listText(summary.config.departments));
  const [endpoints, setEndpoints] = useState(JSON.stringify(summary.config.endpoints, null, 2));
  useEffect(() => {
    setDraft(summary.config);
    setDepartments(listText(summary.config.departments));
    setEndpoints(JSON.stringify(summary.config.endpoints, null, 2));
  }, [summary.config]);
  const set = <K extends keyof MomentusSyncConfig>(key: K, value: MomentusSyncConfig[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const withLists = { ...draft, departments: textList(departments) };
  let endpointsValue: Record<string, string> | null = null;
  try {
    endpointsValue = endpoints.trim() ? JSON.parse(endpoints) : {};
  } catch {
    endpointsValue = null;
  }
  const dirty = JSON.stringify({ ...withLists, endpoints: endpointsValue }) !== JSON.stringify(summary.config);
  const connected = !!(summary.config.baseUrl && summary.config.orgCode && summary.config.apiUserId && summary.secretSet);
  const seen = Object.entries(summary.state.seenStatuses);

  async function saveDraft() {
    if (endpointsValue === null) {
      showToast("error", "The endpoint overrides aren't valid JSON");
      return;
    }
    const { enabled: _e, paused: _p, ...rest } = withLists;
    await save({ ...rest, endpoints: endpointsValue });
  }

  async function pushInventory() {
    try {
      await api.integrationAction("momentus", "pushInventory");
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
      showToast("success", "Sending inventory: it starts within a minute");
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function downloadCsv() {
    try {
      saveFile(await api.momentusResourcesCsv());
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  return (
    <Card
      title="Momentus"
      subtitle="For venues that take bookings in Momentus Enterprise: events come in as projects, AV is quoted in R2 and goes back as an order on the event."
      status={<StatusPill summary={summary} />}
    >
      <Controls provider="momentus" summary={summary} canStart={connected} />
      <FailedList provider="momentus" summary={summary} />

      <Section
        title="Connection"
        hint="Needs the Momentus API module on your licence and an API user (in Momentus: API User screen). Sending orders and resources needs the API's add/edit licence too."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Momentus address" hint="The https:// address you open Momentus at" className="sm:col-span-2">
            <input value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://" className="input py-2 font-mono" />
          </Field>
          <Field label="Organisation code" hint="Your Momentus org code, e.g. 10">
            <input value={draft.orgCode} onChange={(e) => set("orgCode", e.target.value)} className="input py-2 font-mono" />
          </Field>
          <Field label="API user ID">
            <input value={draft.apiUserId} onChange={(e) => set("apiUserId", e.target.value)} className="input py-2 font-mono" />
          </Field>
        </div>
        <SecretInput
          label="API user secret"
          isSet={summary.secretSet}
          saving={saving}
          onSave={(secret) => save({ secret }, "Secret saved")}
          hint="Stored on the server, never shown again."
        />
      </Section>

      <Section title="Events → projects" hint="Each event becomes a project, with its account as the client and its first room as the location.">
        <Switch checked={draft.pullEvents} onChange={(v) => set("pullEvents", v)} label="Bring in events" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <Field label="Days back">
            <input type="number" min={0} value={draft.pastDays} onChange={(e) => set("pastDays", Number(e.target.value))} className="input py-2" />
          </Field>
          <Field label="Months ahead">
            <input type="number" min={1} value={draft.windowMonths} onChange={(e) => set("windowMonths", Number(e.target.value))} className="input py-2" />
          </Field>
          <Field label="Prep (hours before)" hint="Kit goes out">
            <input type="number" min={0} value={draft.prepHours} onChange={(e) => set("prepHours", Number(e.target.value))} className="input py-2" />
          </Field>
          <Field label="Return (hours after)" hint="Kit comes back">
            <input type="number" min={0} value={draft.returnHours} onChange={(e) => set("returnHours", Number(e.target.value))} className="input py-2" />
          </Field>
        </div>
        <Switch checked={draft.onlyWithOrders} onChange={(v) => set("onlyWithOrders", v)} label="Only events with an order for your department" />
        <div className="flex flex-col gap-2">
          <span className="text-sm text-gray-500">Event statuses</span>
          {seen.length === 0 ? (
            <p className="text-xs text-gray-500">The statuses your venue uses appear here after the first sync, so you can choose which to bring in and what each means in R2.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {seen.map(([code, name]) => {
                const included = draft.eventStatuses.length === 0 || draft.eventStatuses.includes(code);
                return (
                  <div key={code} className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2 w-48">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(e) => {
                          const all = draft.eventStatuses.length === 0 ? seen.map(([c]) => c) : draft.eventStatuses;
                          const next = e.target.checked ? [...all, code] : all.filter((c) => c !== code);
                          set("eventStatuses", next.length === seen.length ? [] : next);
                        }}
                      />
                      {name} <span className="text-xs text-gray-400 font-mono">{code}</span>
                    </label>
                    <select
                      aria-label={`R2 status for ${name}`}
                      value={draft.statusMap[code] ?? ""}
                      onChange={(e) => {
                        const map = { ...draft.statusMap };
                        if (e.target.value) map[code] = e.target.value as JobStatus;
                        else delete map[code];
                        set("statusMap", map);
                      }}
                      className="input py-1 text-sm w-44"
                    >
                      <option value="">Guess from the name</option>
                      {STAGES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <Section title="Orders → project equipment" hint="Items ordered for your department in Momentus become lines on the project, matched to R2 items by resource code.">
        <Switch checked={draft.pullOrders} onChange={(v) => set("pullOrders", v)} label="Bring in orders" />
        <Field label="Your department codes" hint="Separate with commas. Empty brings in every department's orders.">
          <input value={departments} onChange={(e) => setDepartments(e.target.value)} placeholder="AV" className="input py-2 font-mono" />
        </Field>
      </Section>

      <Section title="Quotes → orders" hint="When you issue a quote on a project from Momentus, it goes to the event as an order (the same order each time you re-quote), priced to match the quote's total.">
        <Switch checked={draft.pushQuotes} onChange={(v) => set("pushQuotes", v)} label="Send issued quotes to Momentus" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
          <Field label="Order department">
            <input value={draft.orderDepartment} onChange={(e) => set("orderDepartment", e.target.value)} className="input py-2 font-mono" />
          </Field>
          <Field label="Order type">
            <input value={draft.orderType} onChange={(e) => set("orderType", e.target.value)} className="input py-2 font-mono" />
          </Field>
          <Field label="Resource for other lines" hint="Labour, custom lines, items not in Momentus">
            <input value={draft.miscResource} onChange={(e) => set("miscResource", e.target.value)} className="input py-2 font-mono" />
          </Field>
        </div>
      </Section>

      <Section title="Inventory → resources" hint="Your R2 items appear in Momentus as resources, by item code, so sales staff can sell them. Changes to items follow automatically.">
        <Switch checked={draft.pushInventory} onChange={(v) => set("pushInventory", v)} label="Send inventory to Momentus" />
        <Field label="Only these categories" hint="None ticked sends every active item">
          <div className="flex flex-wrap gap-x-4 gap-y-1 max-h-32 overflow-y-auto">
            {[...categoryPaths.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, path]) => (
                <label key={id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.inventoryCategories.includes(id)}
                    onChange={(e) => set("inventoryCategories", e.target.checked ? [...draft.inventoryCategories, id] : draft.inventoryCategories.filter((c) => c !== id))}
                  />
                  {displayPath(path)}
                </label>
              ))}
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={pushInventory} disabled={!summary.config.enabled || !summary.config.pushInventory} className="btn-secondary py-1.5 text-sm">
            Send all inventory now
          </button>
          <button onClick={downloadCsv} className="text-sm text-signal hover:underline">
            Download as a spreadsheet
          </button>
          {summary.state.lastInventoryAt && <span className="text-xs text-gray-500">Last sent {msDate(summary.state.lastInventoryAt)}</span>}
        </div>
        {summary.state.inventoryBlocked && (
          <p className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 p-2">
            Momentus refused the resources: your API licence may not include adding them. Download the spreadsheet and import it in Momentus instead.
          </p>
        )}
      </Section>

      <Section
        title="Advanced: API paths"
        hint="R2's Momentus connection was built from Momentus's published API layout. If your instance's API Help page (/api/help) shows different paths, enter them here, e.g. { &quot;events&quot;: &quot;/api/v1/Events/{org}&quot; }."
      >
        <textarea value={endpoints} onChange={(e) => setEndpoints(e.target.value)} rows={3} spellCheck={false} className="input py-2 font-mono text-xs" />
        {endpointsValue === null && <p className="text-xs text-red-600">Not valid JSON yet.</p>}
      </Section>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={saveDraft}
        onReset={() => {
          setDraft(summary.config);
          setDepartments(listText(summary.config.departments));
          setEndpoints(JSON.stringify(summary.config.endpoints, null, 2));
        }}
      />
      <ActivityLog provider="momentus" otherName="Momentus" />
    </Card>
  );
}
