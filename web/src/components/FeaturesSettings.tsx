import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { adminApi, type FeatureKey, type Features, type PresetKey } from "../lib/api";
import { errorText } from "../lib/errors";
import { FEATURES, PRESETS, presetChanges } from "../lib/workflow";
import Switch from "./Switch";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";

// What an organisation has (pb_hooks/lib/features.js). It's what the
// organisation pays for, so only platform admins see and change it, in the
// admin panel; the organisation just doesn't see what it hasn't got. Off, a feature is hidden for everyone and the
// server stops doing it; nothing's deleted, so turning it back on picks up
// where it left off.

// The admin panel's: an organisation's features, from a preset or one at a
// time.
export function FeatureSwitches({ orgId, orgName, features, onChanged }: { orgId: string; orgName: string; features: Features; onChanged: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<FeatureKey | PresetKey | null>(null);
  const on = (key: FeatureKey) => features[key] !== false;
  const current = PRESETS.find((p) => FEATURES.every((f) => on(f.key) === p.on.includes(f.key)))?.key;

  async function save(changes: Partial<Features>, busyKey: FeatureKey | PresetKey, done: string) {
    setBusy(busyKey);
    try {
      await adminApi.updateFeatures(orgId, changes);
      await onChanged();
      // If you're in it, its menus follow.
      await queryClient.invalidateQueries();
      showToast("success", done);
    } catch (err) {
      showToast("error", `Couldn't change it: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(key: FeatureKey, value: boolean) {
    const info = FEATURES.find((f) => f.key === key)!;
    if (!value) {
      const ok = await confirm({
        title: `Turn off ${info.label}`,
        message: `For ${orgName}: ${info.off} Nothing's deleted: turn it back on any time and it's all still there.`,
        confirmLabel: "Turn off",
      });
      if (!ok) return;
    }
    await save({ [key]: value }, key, `${info.label} ${value ? "on" : "off"} for ${orgName}`);
  }

  async function applyPreset(key: PresetKey) {
    const preset = PRESETS.find((p) => p.key === key)!;
    const changes = presetChanges(key);
    const off = FEATURES.filter((f) => on(f.key) && !changes[f.key]).map((f) => f.label);
    const turnOn = FEATURES.filter((f) => !on(f.key) && changes[f.key]).map((f) => f.label);
    const ok = await confirm({
      title: `Set ${orgName} up as ${preset.label.toLowerCase()}`,
      message: [turnOn.length > 0 && `Turns on ${turnOn.join(", ")}.`, off.length > 0 && `Turns off ${off.join(", ")}.`, "Nothing's deleted, and any of them can be changed after."]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "Set up",
    });
    if (!ok) return;
    await save(changes, key, `${orgName} set up as ${preset.label.toLowerCase()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <div key={p.key} className={`rounded-md border p-3 flex flex-col gap-2 ${current === p.key ? "border-signal/50 bg-signal-soft/30" : "border-gray-200"}`}>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{p.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{p.hint}</p>
            </div>
            {current === p.key ? (
              <span className="text-xs font-medium text-signal-ink">Set up like this now</span>
            ) : (
              <button onClick={() => applyPreset(p.key)} disabled={busy !== null} className="btn-secondary py-1 self-start">
                {busy === p.key ? "Setting up…" : "Use this"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {FEATURES.map((f) => {
          const blocked = !!f.needs && !on(f.needs);
          const needs = f.needs ? FEATURES.find((x) => x.key === f.needs)?.label : "";
          return (
            <div key={f.key} className="flex items-start justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{f.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{blocked ? `Needs ${needs} on.` : f.hint}</p>
              </div>
              <Switch label="" ariaLabel={f.label} checked={on(f.key) && !blocked} disabled={busy !== null || blocked} onChange={(v) => toggle(f.key, v)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
