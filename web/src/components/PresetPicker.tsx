import type { PresetKey } from "../lib/api";
import { PRESETS } from "../lib/workflow";

// What a new organisation will use R2 for: which features it starts with
// (lib/workflow.ts PRESETS). Each can be changed after, in Settings →
// Features, without losing anything.
export default function PresetPicker({ value, onChange }: { value: PresetKey; onChange: (key: PresetKey) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm text-gray-700 mb-1">What it&apos;s for</legend>
      {PRESETS.map((p) => (
        <label
          key={p.key}
          className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer ${value === p.key ? "border-signal/50 bg-signal-soft/40" : "border-gray-200 hover:bg-gray-50"}`}
        >
          <input type="radio" name="preset" checked={value === p.key} onChange={() => onChange(p.key)} className="mt-1" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">{p.label}</span>
            <span className="block text-xs text-gray-500">{p.hint}</span>
          </span>
        </label>
      ))}
      <span className="text-xs text-gray-500">Change any of it later in the admin panel.</span>
    </fieldset>
  );
}
