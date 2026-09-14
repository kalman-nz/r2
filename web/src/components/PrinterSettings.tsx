import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { printCustomText } from "../lib/print";
import { useToast } from "./ToastProvider";

export default function PrinterSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const [printerHost, setPrinterHost] = useState("");
  const [defaultTemplateId, setDefaultTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (settings) {
      setPrinterHost(settings.printerHost);
      setDefaultTemplateId(settings.defaultTemplateId);
    }
  }, [settings]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateSettings({ printerHost: printerHost.trim(), defaultTemplateId });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function sendTestLabel() {
    setTesting(true);
    try {
      const result = await printCustomText(`Test label\n${new Date().toLocaleString()}`, 62, 29, false);
      if (result.ok) {
        showToast("success", "Test label sent — check the printer");
      } else {
        showToast("error", `Test print failed: ${result.message}`);
      }
    } catch (err) {
      showToast("error", `Test print failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Printer</h2>
          <p className="text-xs text-gray-500 mt-0.5">Where labels get sent, and which template to reach for by default.</p>
        </div>

        {isLoading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="card p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="printerHost" className="text-sm text-gray-500">
                Printer address
              </label>
              <input
                id="printerHost"
                type="text"
                placeholder="10.20.26.79"
                value={printerHost}
                onChange={(e) => setPrinterHost(e.target.value)}
                className="input py-2 font-mono"
              />
              <p className="text-xs text-gray-500">
                LAN/Wi-Fi IP of the Brother QL label printer (e.g. a QL-810W on the workshop network). Applies to
                every print job immediately, no restart needed.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="defaultTemplate" className="text-sm text-gray-500">
                Default label template
              </label>
              <select
                id="defaultTemplate"
                value={defaultTemplateId}
                onChange={(e) => setDefaultTemplateId(e.target.value)}
                className="input py-2"
              >
                <option value="">None — always ask</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.widthMm}×{t.heightMm}mm)
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Listed first (and marked "default") wherever a template is picked for printing — saves a click for
                the template you use most.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
              <button onClick={save} disabled={saving} className="btn-primary py-2 w-fit mt-3">
                {saving ? "Saving…" : "Save"}
              </button>
              {saved && <span className="text-sm text-emerald-600 mt-3">Saved</span>}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Test the connection</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Prints a small label with the current date/time — confirms the printer is reachable and configured
            correctly without needing a real asset to hand.
          </p>
        </div>
        <div className="card p-4">
          <button onClick={sendTestLabel} disabled={testing || !printerHost.trim()} className="btn-secondary">
            {testing ? "Sending…" : "Send test label"}
          </button>
        </div>
      </div>
    </div>
  );
}
