import { useRef, useState } from "react";
import { pb } from "../../lib/pocketbase";
import type { Item } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useToast } from "../ToastProvider";

// The item's photo at the top of its page. Click to add or change it;
// remove it from the corner. Saves straight away.
export default function ItemPhoto({ item, canEdit, onSaved }: { item: Item; canEdit: boolean; onSaved: (item: Item) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function upload(file: File | null | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("photo", file);
      onSaved(await pb.collection("items").update<Item>(item.id, data));
    } catch (err) {
      showToast("error", `Couldn't save the photo: ${errorText(err)}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      onSaved(await pb.collection("items").update<Item>(item.id, { photo: null }));
    } catch (err) {
      showToast("error", `Couldn't remove the photo: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const frame = "relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-white";
  return (
    <div className="group relative shrink-0">
      {canEdit ? (
        <button onClick={() => input.current?.click()} disabled={busy} className={`${frame} block`} aria-label={item.photo ? "Change photo" : "Add photo"}>
          {item.photo ? (
            <img src={pb.files.getURL(item, item.photo, { thumb: "300x300" })} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-xs text-gray-400 bg-gray-50">Add photo</span>
          )}
          <span className="absolute inset-x-0 bottom-0 py-1 text-[11px] font-medium text-white bg-carbon/70 opacity-0 group-hover:opacity-100 transition-opacity">
            {busy ? "Saving…" : item.photo ? "Change" : "Upload"}
          </span>
        </button>
      ) : (
        <div className={frame}>
          {item.photo && <img src={pb.files.getURL(item, item.photo, { thumb: "300x300" })} alt="" className="w-full h-full object-cover" />}
        </div>
      )}
      {canEdit && item.photo && (
        <button
          onClick={remove}
          disabled={busy}
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-fault-ink text-sm leading-none opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Remove photo"
          title="Remove photo"
        >
          ×
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
