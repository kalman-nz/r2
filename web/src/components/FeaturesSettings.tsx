import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type FeatureKey } from "../lib/api";
import { errorText } from "../lib/errors";
import { useOrg } from "../lib/org";
import { FEATURES } from "../lib/workflow";
import Switch from "./Switch";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";

// Settings > Features: what this business uses R2 for. A theatre with a
// small crew might not scan kit or keep repair jobs; a touring production
// company wants both. Off, a feature is hidden for everyone and the server
// stops doing it; nothing's deleted, so turning it back on picks up where
// it left off (pb_hooks/lib/features.js).
export default function FeaturesSettings() {
  const queryClient = useQueryClient();
  const { org, feature, refresh } = useOrg();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<FeatureKey | null>(null);

  async function toggle(key: FeatureKey, on: boolean) {
    if (!org) return;
    const info = FEATURES.find((f) => f.key === key)!;
    if (!on) {
      const ok = await confirm({
        title: `Turn off ${info.label}`,
        message: `${info.off} Nothing's deleted: turn it back on any time and it's all still there.`,
        confirmLabel: "Turn off",
      });
      if (!ok) return;
    }
    setBusy(key);
    try {
      await api.updateFeatures(org.id, { [key]: on });
      // Permissions and menus follow /api/me.
      await refresh();
      await queryClient.invalidateQueries();
      showToast("success", `${info.label} ${on ? "on" : "off"}`);
    } catch (err) {
      showToast("error", `Couldn't change it: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Features</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Turn off what your business doesn't use, so nobody has to work around it. It's hidden for everyone, and nothing's deleted.
        </p>
      </div>
      <div className="card divide-y divide-gray-100">
        {FEATURES.map((f) => {
          const blocked = !!f.needs && !feature(f.needs);
          const needs = f.needs ? FEATURES.find((x) => x.key === f.needs)?.label : "";
          return (
            <div key={f.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{f.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{blocked ? `Needs ${needs} on.` : f.hint}</p>
              </div>
              <Switch
                label=""
                ariaLabel={f.label}
                checked={feature(f.key)}
                disabled={busy !== null || blocked}
                onChange={(on) => toggle(f.key, on)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
