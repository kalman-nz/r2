import { useState } from "react";
import type { LabelDataContext } from "../lib/labelSpec";
import { useCan } from "../lib/roles";
import PrintDialog from "./print/PrintDialog";

// Prints a batch: units (ItemDetail) or item types (Inventory list). The
// caller says how to fill each label and, for units, which unit it is.
type BatchPrintProps<T> = {
  items: T[];
  getDisplayName: (item: T) => string;
  getContext: (item: T) => LabelDataContext;
  getSerialId?: (item: T) => string | undefined;
  onDone: () => void;
};

// Hidden from roles without labels.print.
export default function BatchPrintBar<T>(props: BatchPrintProps<T>) {
  return useCan()("labels.print") ? <BatchPrintInner {...props} /> : null;
}

function BatchPrintInner<T>({ items, getDisplayName, getContext, getSerialId, onDone }: BatchPrintProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={items.length === 0} className="btn-secondary">
        Print
      </button>
      {open && (
        <PrintDialog
          count={items.length}
          getContext={(i) => getContext(items[i])}
          getName={(i) => getDisplayName(items[i])}
          getJob={(i, template) => ({ templateId: template.id, serialId: getSerialId?.(items[i]) })}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      )}
    </>
  );
}
