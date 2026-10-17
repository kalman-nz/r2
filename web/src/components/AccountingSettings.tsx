import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Settings } from "../lib/api";
import { errorText } from "../lib/errors";
import Field from "./Field";
import { useToast } from "./ToastProvider";

type AccountingKeys = "xeroAccountCode" | "xeroTaxType" | "xeroDueDays" | "invoicePrefix";

// How exported invoices land in Xero (see pages/ExportsPage.tsx). The account
// code and tax rate name have to match the organisation's own.
export default function AccountingSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [draft, setDraft] = useState<Pick<Settings, AccountingKeys> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft({
        xeroAccountCode: settings.xeroAccountCode,
        xeroTaxType: settings.xeroTaxType,
        xeroDueDays: settings.xeroDueDays,
        invoicePrefix: settings.invoicePrefix,
      });
    }
  }, [settings]);

  if (isLoading || !draft) return <p className="text-gray-500 text-sm">Loading…</p>;
  const set = (key: AccountingKeys, value: string) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function save() {
    setSaving(true);
    try {
      await api.updateSettings(draft!);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
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
        <h2 className="text-sm font-semibold text-gray-900">Accounting (Xero)</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Used for the invoice file on the Exports page. Find your account codes and tax rate names in Xero under Accounting →
          Chart of accounts and Accounting → Advanced → Tax rates.
        </p>
      </div>
      <div className="card p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Sales account code" hint="Equipment hire income, e.g. 200 (Sales)">
            <input value={draft.xeroAccountCode} onChange={(e) => set("xeroAccountCode", e.target.value)} className="input py-2 font-mono" />
          </Field>
          <Field label="Tax rate name" hint="Exactly as Xero names it">
            <input value={draft.xeroTaxType} onChange={(e) => set("xeroTaxType", e.target.value)} className="input py-2" />
          </Field>
          <Field label="Payment terms (days)" hint="Due date = invoice date + this">
            <input value={draft.xeroDueDays} onChange={(e) => set("xeroDueDays", e.target.value)} inputMode="numeric" className="input py-2" />
          </Field>
          <Field label="Invoice number prefix" hint={`Job #1001 becomes ${draft.invoicePrefix || ""}1001. Use one Xero isn't already using.`}>
            <input value={draft.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value)} className="input py-2 font-mono" />
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
