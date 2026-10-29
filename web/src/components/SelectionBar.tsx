import type { ReactNode } from "react";

// The "N selected" actions bar for lists with tick boxes. Sits in its own
// row between the toolbar and the table.
export default function SelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  return (
    <div className="shrink-0 card px-4 py-2 flex items-center gap-2 flex-wrap text-sm">
      <span className="font-medium text-gray-900 mr-1">{count} selected</span>
      {children}
      <button onClick={onClear} className="text-gray-500 hover:text-gray-900 ml-auto">
        Clear selection
      </button>
    </div>
  );
}
