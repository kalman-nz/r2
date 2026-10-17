import type { Category } from "./api";

// Inventory folders are the categories collection: each has a parent (""
// at the top), items sit in any folder, and folders nest as deep as people
// like. Everything here works on ids, never on names, so a "/" in a folder
// name can't confuse it.

export interface FolderIndex {
  byId: Map<string, Category>;
  // parent id ("" for the top) → its folders, in display order
  children: Map<string, Category[]>;
}

export function indexFolders(categories: Category[]): FolderIndex {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string, Category[]>();
  for (const c of categories) {
    // A parent that no longer exists puts the folder at the top.
    const parent = c.parent && byId.has(c.parent) ? c.parent : "";
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return { byId, children };
}

// A folder and every folder inside it, at any depth. "" is everything.
export function subtree(index: FolderIndex, id: string): Set<string> {
  const ids = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of index.children.get(current) ?? []) stack.push(child.id);
  }
  return ids;
}

// The folders from the top down to this one (empty at the top).
export function trail(index: FolderIndex, id: string): Category[] {
  const out: Category[] = [];
  const seen = new Set<string>();
  let current = index.byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.unshift(current);
    current = current.parent ? index.byId.get(current.parent) : undefined;
  }
  return out;
}

// The folder an item is in, as the tree sees it ("" when it has none or
// its folder is gone).
export function folderOf(index: FolderIndex, category: string): string {
  return category && index.byId.has(category) ? category : "";
}
