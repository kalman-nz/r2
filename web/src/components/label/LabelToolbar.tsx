import type { ReactNode } from "react";
import { useDropdown } from "../../lib/dropdown";
import type { AlignMode } from "../../lib/labelGeometry";
import NumberInput from "../NumberInput";

export interface DesignerPrefs {
  snap: boolean; // to the label, its margin and other elements
  grid: boolean; // show the grid and snap to it
  gridMm: number;
  marginMm: number; // 0 = no margin guide
}

export type OrderMove = "front" | "forward" | "backward" | "back";

// Simple 16px line icons, drawn in currentColor.
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

// Two bars lined up against a guide line, turned for each align mode.
function AlignIcon({ mode }: { mode: AlignMode }) {
  const vertical = mode === "top" || mode === "vcenter" || mode === "bottom";
  const pos = mode === "left" || mode === "top" ? "start" : mode === "right" || mode === "bottom" ? "end" : "mid";
  const guide = pos === "start" ? 2.5 : pos === "end" ? 13.5 : 8;
  const bar = (len: number, offset: number) => {
    const start = pos === "start" ? 4 : pos === "end" ? 12 - len : 8 - len / 2;
    return vertical ? (
      <rect x={offset} y={start} width="3" height={len} rx="0.5" fill="currentColor" stroke="none" />
    ) : (
      <rect x={start} y={offset} width={len} height="3" rx="0.5" fill="currentColor" stroke="none" />
    );
  };
  return (
    <Svg>
      {vertical ? <line x1="1.5" y1={guide} x2="14.5" y2={guide} /> : <line x1={guide} y1="1.5" x2={guide} y2="14.5" />}
      {bar(8, 4)}
      {bar(5, 9)}
    </Svg>
  );
}

function DistributeIcon({ axis }: { axis: "x" | "y" }) {
  return (
    <Svg>
      {[2.5, 7, 11.5].map((p) =>
        axis === "x" ? (
          <rect key={p} x={p} y="4" width="2" height="8" rx="0.5" fill="currentColor" stroke="none" />
        ) : (
          <rect key={p} x="4" y={p} width="8" height="2" rx="0.5" fill="currentColor" stroke="none" />
        ),
      )}
    </Svg>
  );
}

const UndoIcon = () => (
  <Svg>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
  </Svg>
);
const RedoIcon = () => (
  <Svg>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
  </Svg>
);
const MagnetIcon = () => (
  <Svg>
    <path d="M3.5 2.5v5.5a4.5 4.5 0 0 0 9 0V2.5" />
    <path d="M3.5 5h3M9.5 5h3M6.5 2.5V8a1.5 1.5 0 0 0 3 0V2.5" />
  </Svg>
);
const GridIcon = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11" />
  </Svg>
);
const LayersIcon = () => (
  <Svg>
    <path d="m8 2.5 5.5 3L8 8.5l-5.5-3z" />
    <path d="m2.5 8.5 5.5 3 5.5-3" />
    <path d="m2.5 11 5.5 3 5.5-3" />
  </Svg>
);
const CogIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" />
  </Svg>
);

function ToolButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`h-8 min-w-8 px-1.5 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-35 disabled:pointer-events-none ${
        active ? "bg-signal-soft text-signal-ink" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="w-px h-5 bg-gray-200 mx-1" />;

const ALIGN_TITLES: Record<AlignMode, string> = {
  left: "Align left",
  hcenter: "Align centres",
  right: "Align right",
  top: "Align top",
  vcenter: "Align middles",
  bottom: "Align bottom",
};

function OrderMenu({ disabled, onOrder }: { disabled: boolean; onOrder: (move: OrderMove) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const items: { move: OrderMove; label: string; keys: string }[] = [
    { move: "front", label: "Bring to front", keys: "⇧⌘]" },
    { move: "forward", label: "Bring forward", keys: "⌘]" },
    { move: "backward", label: "Send backward", keys: "⌘[" },
    { move: "back", label: "Send to back", keys: "⇧⌘[" },
  ];
  return (
    <div ref={ref} className="relative">
      <ToolButton title="Order" onClick={() => setOpen(!open)} disabled={disabled} active={open}>
        <LayersIcon />
      </ToolButton>
      {open && (
        <div className="absolute z-20 left-0 mt-1 w-52 card py-1 shadow-lg text-sm">
          {items.map((i) => (
            <button
              key={i.move}
              type="button"
              onClick={() => {
                onOrder(i.move);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50"
            >
              {i.label}
              <span className="text-xs text-gray-400 font-mono">{i.keys}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsMenu({ prefs, onPrefs }: { prefs: DesignerPrefs; onPrefs: (p: DesignerPrefs) => void }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <ToolButton title="Snapping and grid settings" onClick={() => setOpen(!open)} active={open}>
        <CogIcon />
      </ToolButton>
      {open && (
        <div className="absolute z-20 right-0 mt-1 w-64 card p-3 shadow-lg text-sm flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.snap} onChange={(e) => onPrefs({ ...prefs, snap: e.target.checked })} />
            <span className="text-gray-700">Snap to label and elements</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={prefs.grid} onChange={(e) => onPrefs({ ...prefs, grid: e.target.checked })} />
            <span className="text-gray-700">Show grid and snap to it</span>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Grid size (mm)</span>
            <NumberInput clamp min={0.5} max={20} value={prefs.gridMm} onChange={(gridMm) => onPrefs({ ...prefs, gridMm })} className="input py-1 w-20" />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Margin guide (mm)</span>
            <NumberInput clamp min={0} max={20} value={prefs.marginMm} onChange={(marginMm) => onPrefs({ ...prefs, marginMm })} className="input py-1 w-20" />
          </label>
        </div>
      )}
    </div>
  );
}

export default function LabelToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  selectionCount,
  onAlign,
  onDistribute,
  onOrder,
  prefs,
  onPrefs,
  zoom,
  onZoom,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selectionCount: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  onOrder: (move: OrderMove) => void;
  prefs: DesignerPrefs;
  onPrefs: (p: DesignerPrefs) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  const alignTarget = selectionCount === 1 ? " to the label" : "";
  return (
    <div className="flex flex-wrap items-center gap-0.5 card px-1.5 py-1">
      <ToolButton title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
        <UndoIcon />
      </ToolButton>
      <ToolButton title="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
        <RedoIcon />
      </ToolButton>
      <Divider />
      {(["left", "hcenter", "right", "top", "vcenter", "bottom"] as const).map((mode) => (
        <ToolButton key={mode} title={ALIGN_TITLES[mode] + alignTarget} onClick={() => onAlign(mode)} disabled={selectionCount === 0}>
          <AlignIcon mode={mode} />
        </ToolButton>
      ))}
      <ToolButton title="Space evenly across" onClick={() => onDistribute("x")} disabled={selectionCount < 3}>
        <DistributeIcon axis="x" />
      </ToolButton>
      <ToolButton title="Space evenly down" onClick={() => onDistribute("y")} disabled={selectionCount < 3}>
        <DistributeIcon axis="y" />
      </ToolButton>
      <Divider />
      <OrderMenu disabled={selectionCount === 0} onOrder={onOrder} />
      <div className="flex items-center gap-0.5 ml-auto">
        <ToolButton title="Snap to label and elements" onClick={() => onPrefs({ ...prefs, snap: !prefs.snap })} active={prefs.snap}>
          <MagnetIcon />
        </ToolButton>
        <ToolButton title="Grid" onClick={() => onPrefs({ ...prefs, grid: !prefs.grid })} active={prefs.grid}>
          <GridIcon />
        </ToolButton>
        <SettingsMenu prefs={prefs} onPrefs={onPrefs} />
        <Divider />
        <ToolButton title="Zoom out" onClick={() => onZoom(zoom / 1.25)} disabled={zoom <= 0.5}>
          <span className="text-base leading-none">−</span>
        </ToolButton>
        <button
          type="button"
          title="Fit to screen"
          onClick={() => onZoom(1)}
          className="h-8 w-14 text-xs font-mono text-gray-600 rounded-md hover:bg-gray-100"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolButton title="Zoom in" onClick={() => onZoom(zoom * 1.25)} disabled={zoom >= 6}>
          <span className="text-base leading-none">+</span>
        </ToolButton>
      </div>
    </div>
  );
}
