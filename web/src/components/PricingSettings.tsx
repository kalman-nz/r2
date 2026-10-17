import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Settings } from "../lib/api";
import { errorText } from "../lib/errors";
import Field from "./Field";
import { useToast } from "./ToastProvider";

type PricingKeys = "gstRate" | "dayFactors" | "extraDayFactor" | "bufferHours" | "quoteValidityDays" | "quoteTerms";

// Mirrors lib/pricing.js dayFactor() on the server, for the preview only —
// the server does the real maths.
function previewFactors(text: string, extra: string): { days: number; factor: number }[] | null {
  const table = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(Number);
  if (table.length === 0 || table.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const extraFactor = Number(extra) || 0;
  return Array.from({ length: Math.max(10, table.length + 3) }, (_, i) => {
    const days = i + 1;
    const factor = days <= table.length ? table[days - 1] : table[table.length - 1] + (days - table.length) * extraFactor;
    return { days, factor: Math.round(factor * 1000) / 1000 };
  });
}

export default function PricingSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [draft, setDraft] = useState<Pick<Settings, PricingKeys> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        gstRate: settings.gstRate,
        dayFactors: settings.dayFactors,
        extraDayFactor: settings.extraDayFactor,
        bufferHours: settings.bufferHours,
        quoteValidityDays: settings.quoteValidityDays,
        quoteTerms: settings.quoteTerms,
      });
    }
  }, [settings]);

  if (isLoading || !draft) return <p className="text-gray-500 text-sm">Loading…</p>;
  const set = (key: PricingKeys, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const preview = previewFactors(draft.dayFactors, draft.extraDayFactor);

  async function save() {
    setSaving(true);
    try {
      await api.updateSettings(draft!);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["job-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["availability"] }),
      ]);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Pricing & availability</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Used for every project's totals and every new quote. Issued quotes keep the numbers they were issued with.
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="GST rate (%)" hint="Prices are entered and quoted ex GST; GST is added on the total">
            <input value={draft.gstRate} onChange={(e) => set("gstRate", e.target.value)} inputMode="decimal" className="input py-2" />
          </Field>
          <Field label="Quotes valid for (days)" hint="0 = no expiry date on quotes">
            <input
              value={draft.quoteValidityDays}
              onChange={(e) => set("quoteValidityDays", e.target.value)}
              inputMode="numeric"
              className="input py-2"
            />
          </Field>
          <Field
            label="Day factors"
            className="sm:col-span-2"
            hint="How many day rates a hire costs for 1, 2, 3… days, comma-separated. 1, 1.5, 2 means a 3-day hire costs 2× the day rate."
          >
            <input value={draft.dayFactors} onChange={(e) => set("dayFactors", e.target.value)} className="input py-2 font-mono" />
          </Field>
          <Field label="Each extra day adds" hint="For hires longer than the list above">
            <input value={draft.extraDayFactor} onChange={(e) => set("extraDayFactor", e.target.value)} inputMode="decimal" className="input py-2" />
          </Field>
          <Field label="Turnaround buffer (hours)" hint="Kit stays unavailable this long after every project returns, for checking and cleaning">
            <input value={draft.bufferHours} onChange={(e) => set("bufferHours", e.target.value)} inputMode="decimal" className="input py-2" />
          </Field>
        </div>

        {preview ? (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <tbody>
                <tr className="text-gray-500">
                  <td className="pr-3 py-0.5">Days</td>
                  {preview.map((p) => (
                    <td key={p.days} className="px-2 py-0.5 text-center tabular-nums">
                      {p.days}
                    </td>
                  ))}
                </tr>
                <tr className="text-gray-900">
                  <td className="pr-3 py-0.5 text-gray-500">× rate</td>
                  {preview.map((p) => (
                    <td key={p.days} className="px-2 py-0.5 text-center tabular-nums">
                      {p.factor}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-red-600">Day factors need to be a list of positive numbers.</p>
        )}

        <Field label="Quote terms" hint="Printed at the bottom of every quote">
          <textarea
            value={draft.quoteTerms}
            onChange={(e) => set("quoteTerms", e.target.value)}
            rows={4}
            className="input py-2"
            placeholder="Deposit, payment terms, damage and cancellation policy…"
          />
        </Field>

        <div className="pt-1 border-t border-gray-100">
          <button onClick={save} disabled={saving} className="btn-primary py-2 w-fit mt-3">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
