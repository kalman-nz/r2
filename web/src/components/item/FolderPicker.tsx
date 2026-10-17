import { useState } from "react";
import Modal from "../Modal";
import FolderTree from "./FolderTree";
import type { FolderIndex } from "../../lib/folders";

// Choose a folder: moving items, or moving a folder somewhere else.
export default function FolderPicker({
  title,
  index,
  initial,
  disabled,
  confirmLabel,
  onPick,
  onClose,
}: {
  title: string;
  index: FolderIndex;
  initial: string;
  disabled?: Set<string>;
  confirmLabel: string;
  onPick: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="card p-2 max-h-[55vh] overflow-y-auto">
        <FolderTree index={index} current={chosen} onOpen={setChosen} disabled={disabled} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={async () => {
            setBusy(true);
            try {
              await onPick(chosen);
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy || (disabled?.has(chosen) ?? false)}
          className="btn-primary"
        >
          {busy ? "Moving…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
