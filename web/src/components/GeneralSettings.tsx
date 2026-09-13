import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function GeneralSettings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [businessName, setBusinessName] = useState("");
  const [businessShortName, setBusinessShortName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setBusinessName(settings.businessName);
      setBusinessShortName(settings.businessShortName);
    }
  }, [settings]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateSettings({ businessName: businessName.trim(), businessShortName: businessShortName.trim() });
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
        <label htmlFor="businessName" className="text-sm text-gray-500">
          Business name
        </label>
        <input
          id="businessName"
          type="text"
          placeholder="e.g. Bay AV Workshop"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="input py-2"
        />
        <p className="text-xs text-gray-500">Shown in the header alongside "Rentman+".</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="businessShortName" className="text-sm text-gray-500">
          Business short name
        </label>
        <input
          id="businessShortName"
          type="text"
          placeholder="e.g. Bay AV"
          value={businessShortName}
          onChange={(e) => setBusinessShortName(e.target.value)}
          className="input py-2"
        />
        <p className="text-xs text-gray-500">
          Used for the browser tab title instead, since there's little room there for the full name. Falls back to
          the business name, then "Rentman+", if left blank.
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
