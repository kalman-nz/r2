import type { ReactNode } from "react";
import { SIZE_PRESETS, TAPE_WIDTHS, isBrotherWidth } from "../lib/labelSpec";
import NumberInput from "./NumberInput";

// Label size: Brother and Zebra presets, or any width × length. Only Brother
// tape widths can go straight to the networked QL printer; every size can be
// downloaded as a PDF and printed through a driver.
export default function LabelSizeControls({
  widthMm,
  heightMm,
  onChange,
  children,
}: {
  widthMm: number;
  heightMm: number;
  onChange: (widthMm: number, heightMm: number) => void;
  children?: ReactNode;
}) {
  const groups = ["Brother", "Zebra"] as const;
  return (
    <div className="flex flex-col gap-2.5 card p-3 text-sm">
      {groups.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500 w-16 shrink-0">{group}</span>
          {SIZE_PRESETS.filter((p) => p.group === group).map((p) => {
            const active = p.widthMm === widthMm && p.heightMm === heightMm;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => onChange(p.widthMm, p.heightMm)}
                className={`px-2 py-1 rounded border text-xs ${
                  active ? "border-signal bg-signal-soft text-signal-ink" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-gray-500">Width</span>
          <NumberInput min={10} max={300} value={widthMm} onChange={(w) => onChange(w, heightMm)} className="input py-1 w-20" />
          <span className="text-gray-500">mm</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-500">Length</span>
          <NumberInput min={5} max={300} value={heightMm} onChange={(h) => onChange(widthMm, h)} className="input py-1 w-20" />
          <span className="text-gray-500">mm</span>
        </label>
        {children}
      </div>
      {!isBrotherWidth(widthMm) && (
        <p className="text-xs text-amber-700">
          {widthMm}mm isn't a Brother tape width ({TAPE_WIDTHS.map((w) => w.mm).join(", ")}mm), so labels this size are printed
          from a downloaded PDF.
        </p>
      )}
    </div>
  );
}
