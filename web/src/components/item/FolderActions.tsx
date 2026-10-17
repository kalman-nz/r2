import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api } from "../../lib/api";
import type { Category, Item } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { withOrg } from "../../lib/currentOrg";
import { useCan } from "../../lib/roles";
import { subtree, type FolderIndex } from "../../lib/folders";
import Modal from "../Modal";
import { useToast } from "../ToastProvider";
import FolderPicker from "./FolderPicker";
import Switch from "../Switch";

export interface FolderActionsApi {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  // parent "" is the top (Inventory)
  newFolder: (parent: string) => void;
  rename: (id: string) => void;
  move: (id: string) => void;
  remove: (id: string) => void;
  // The dialogs these open; render once.
  dialogs: ReactNode;
}

// New / rename / move / delete for any folder, shared by the inventory
// header (acting on the folder you're in) and the folder tree (acting on
// the folder you point at). Deleting moves what's inside up a level first,
// so nothing is lost or left without a folder by accident.
export function useFolderActions({ index, items, onOpen }: { index: FolderIndex; items: Item[]; onOpen: (id: string) => void }): FolderActionsApi {
  const can = useCan();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [naming, setNaming] = useState<{ mode: "new"; parent: string } | { mode: "rename"; id: string } | null>(null);
  const [name, setName] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The folder being deleted, and whether its contents go too (the default).
  const [deleting, setDeleting] = useState<{ id: string; contents: boolean } | null>(null);

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ["categories"] }), queryClient.invalidateQueries({ queryKey: ["items"] })]);
  const nameOf = (id: string) => (id ? (index.byId.get(id)?.name ?? "Inventory") : "Inventory");

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || !naming) return;
    setBusy(true);
    try {
      if (naming.mode === "new") {
        const created = await pb.collection("categories").create<Category>(withOrg({ name: trimmed, parent: naming.parent }));
        await refresh();
        onOpen(created.id);
      } else {
        await pb.collection("categories").update(naming.id, { name: trimmed });
        await refresh();
      }
      setNaming(null);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(id: string, parent: string) {
    try {
      await pb.collection("categories").update(id, { parent });
      await refresh();
      setMoving(null);
      showToast("success", `Moved ${nameOf(id)} into ${nameOf(parent)}`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const folder = index.byId.get(deleting.id);
    if (!folder) return;
    setBusy(true);
    try {
      const result = await api.deleteFolder(folder.id, deleting.contents);
      setDeleting(null);
      onOpen(folder.parent || "");
      await refresh();
      showToast(
        "success",
        deleting.contents
          ? `Deleted ${folder.name}` + (result.archived ? `. ${result.archived} item${result.archived === 1 ? " was" : "s were"} on projects, so archived instead` : "")
          : `Deleted ${folder.name}, its contents moved up`,
      );
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const movingFolder = moving ? index.byId.get(moving) : undefined;
  const deletingFolder = deleting ? index.byId.get(deleting.id) : undefined;
  const canDeleteItems = can("items.delete");
  // What's inside the folder being deleted, at any depth.
  const inside = (() => {
    if (!deletingFolder) return { items: 0, folders: 0 };
    const ids = subtree(index, deletingFolder.id);
    return { items: items.filter((i) => ids.has(i.category)).length, folders: ids.size - 1 };
  })();
  const describe = (n: { items: number; folders: number }) =>
    [n.items > 0 && `${n.items} item${n.items === 1 ? "" : "s"}`, n.folders > 0 && `${n.folders} folder${n.folders === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" and ")
      .replace(/^./, (c) => c.toUpperCase());
  const dialogs = (
    <>
      {naming && (
        <Modal title={naming.mode === "new" ? `New folder in ${nameOf(naming.parent)}` : "Rename folder"} onClose={() => setNaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
            className="flex flex-col gap-4"
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Folder name" className="input py-2" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNaming(null)} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
                {naming.mode === "new" ? "Create" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deletingFolder && (
        <Modal title={`Delete ${deletingFolder.name}?`} onClose={() => setDeleting(null)}>
          <div className="flex flex-col gap-3 text-sm text-gray-700">
            <Switch
              checked={deleting!.contents}
              onChange={(on) => setDeleting({ id: deletingFolder.id, contents: on })}
              label="Delete contents"
              danger
              disabled={!canDeleteItems}
            />
            <p>
              {inside.items + inside.folders === 0
                ? "The folder is empty."
                : deleting!.contents
                  ? `${describe(inside)} will be deleted. Items already used on projects can't be, so they're archived and kept in ${nameOf(deletingFolder.parent)}.`
                  : `${describe(inside)} will move up into ${nameOf(deletingFolder.parent)}.`}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={() => void confirmDelete()} disabled={busy} className="btn-danger">
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
      {movingFolder && (
        <FolderPicker
          title={`Move ${movingFolder.name} into…`}
          index={index}
          initial={movingFolder.parent || ""}
          disabled={subtree(index, movingFolder.id)}
          confirmLabel="Move here"
          onPick={(parent) => moveTo(movingFolder.id, parent)}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );

  return {
    canCreate: can("categories.create"),
    canEdit: can("categories.edit"),
    canDelete: can("categories.delete") && !busy,
    newFolder: (parent) => {
      setName("");
      setNaming({ mode: "new", parent });
    },
    rename: (id) => {
      setName(index.byId.get(id)?.name ?? "");
      setNaming({ mode: "rename", id });
    },
    move: (id) => setMoving(id),
    remove: (id) => setDeleting({ id, contents: can("items.delete") }),
    dialogs,
  };
}

// The header buttons, for the folder you're in.
export default function FolderActions({ actions, current }: { actions: FolderActionsApi; current: string }) {
  return (
    <>
      {current && actions.canEdit && (
        <>
          <button onClick={() => actions.rename(current)} className="btn-secondary">
            Rename
          </button>
          <button onClick={() => actions.move(current)} className="btn-secondary">
            Move
          </button>
        </>
      )}
      {current && actions.canDelete && (
        <button onClick={() => actions.remove(current)} className="btn-secondary">
          Delete
        </button>
      )}
      {actions.canCreate && (
        <button onClick={() => actions.newFolder(current)} className="btn-secondary">
          New folder
        </button>
      )}
    </>
  );
}
