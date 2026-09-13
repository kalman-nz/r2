import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function PrinterSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [printerHost, setPrinterHost] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setPrinterHost(settings.printerHost);
  }, [settings]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateSettings({ printerHost: printerHost.trim() });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="flex flex-col gap-4 max-w-sm">
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
          LAN IP of the Brother QL label printer (e.g. 10.20.26.79). Applies to every print job immediately, no
          restart needed.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary py-2 w-fit">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}
