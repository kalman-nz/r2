import { useState } from "react";
import type { LabelDataContext } from "../lib/labelSpec";
import { useCan } from "../lib/roles";
import PrintDialog from "./print/PrintDialog";

// One label: a unit (serialId, so the print log can name it) or an item
// type. Hidden from roles without labels.print.
export default function PrintButton(props: { context: LabelDataContext; serialId?: string; label?: string }) {
  return useCan()("labels.print") ? <PrintButtonInner {...props} /> : null;
}

function PrintButtonInner({ context, serialId, label = "Print" }: { context: LabelDataContext; serialId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary">
        {label}
      </button>
      {open && (
        <PrintDialog
          count={1}
          getContext={() => context}
          getName={() => context.displayname || context.equipmentName || "Label"}
          getJob={(_, template) => ({ templateId: template.id, serialId })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
