import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Settings } from "../lib/api";
import { errorText } from "../lib/errors";
import Field from "./Field";
import { useToast } from "./ToastProvider";
import { useConfirm } from "./ConfirmProvider";

type BusinessKeys =
  | "businessName"
  | "businessShortName"
  | "businessAddress"
  | "businessPhone"
  | "businessEmail"
  | "gstNumber"
  | "timezone";

// Must match TIMEZONES in pocketbase/pb_hooks/lib/settings.js.
const TIMEZONES = [
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Perth",
  "Australia/Hobart",
  "UTC",
];

export default function GeneralSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [draft, setDraft] = useState<Pick<Settings, BusinessKeys> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        businessName: settings.businessName,
        businessShortName: settings.businessShortName,
        businessAddress: settings.businessAddress,
        businessPhone: settings.businessPhone,
        businessEmail: settings.businessEmail,
        gstNumber: settings.gstNumber,
        timezone: settings.timezone,
      });
    }
  }, [settings]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.updateSettings(draft);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !draft) return <p className="text-gray-500 text-sm">Loading…</p>;
  const set = (key: BusinessKeys, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Business details</h2>
        <p className="text-xs text-gray-500 mt-0.5">Shown in the app header, and at the top of every quote and packing list.</p>
      </div>

      <div className="card p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Business name">
            <input value={draft.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="e.g. Harbour AV Hire Ltd" className="input py-2" />
          </Field>
          <Field label="Short name" hint="For the browser tab, where there's little room">
            <input value={draft.businessShortName} onChange={(e) => set("businessShortName", e.target.value)} placeholder="e.g. Harbour AV" className="input py-2" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <textarea value={draft.businessAddress} onChange={(e) => set("businessAddress", e.target.value)} rows={2} className="input py-2" />
          </Field>
          <Field label="Phone">
            <input value={draft.businessPhone} onChange={(e) => set("businessPhone", e.target.value)} className="input py-2" />
          </Field>
          <Field label="Email">
            <input type="email" value={draft.businessEmail} onChange={(e) => set("businessEmail", e.target.value)} className="input py-2" />
          </Field>
          <Field label="GST number" hint="Printed on quotes">
            <input value={draft.gstNumber} onChange={(e) => set("gstNumber", e.target.value)} placeholder="123-456-789" className="input py-2" />
          </Field>
          <Field label="Time zone" hint="For dates printed on PDFs (screens use your device's own)">
            <select value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} className="input py-2">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="pt-1 border-t border-gray-100">
          <button onClick={save} disabled={saving} className="btn-primary py-2 w-fit mt-3">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// The jobs calendar subscription. The address works without a login (that's
// how calendar apps fetch), so it's only shown on request, and can be
// replaced if it leaks.
export function CalendarFeed() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(rotate: boolean) {
    if (rotate) {
      const ok = await confirm({
        title: "New calendar address",
        message: "Make a new address? Everyone subscribed to the current one stops getting updates until they subscribe again.",
        confirmLabel: "Make new address",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setUrl((rotate ? await api.rotateCalendarLink() : await api.getCalendarLink()).url);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 mt-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Calendar feed</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Subscribe to jobs from Google, Apple or Outlook calendar (read-only, prep to return). Anyone with the address can see job
          names, clients and venues, so share it like a password.
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-3">
        {url ? (
          <>
            <div className="flex items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="input py-2 flex-1 font-mono text-xs" />
              <button
                onClick={() => navigator.clipboard?.writeText(url).then(() => showToast("success", "Copied"))}
                className="btn-secondary py-2"
              >
                Copy
              </button>
            </div>
            <button onClick={() => load(true)} disabled={busy} className="text-sm text-red-600 hover:text-red-700 w-fit">
              Make a new address
            </button>
          </>
        ) : (
          <button onClick={() => load(false)} disabled={busy} className="btn-secondary w-fit">
            {busy ? "…" : "Show calendar address"}
          </button>
        )}
      </div>
    </div>
  );
}
