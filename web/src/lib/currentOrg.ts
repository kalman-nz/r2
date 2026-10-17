import { pb } from "./pocketbase";

// The organisation the app is working in, for code outside React: api.ts
// sends it as X-Org with every call, react-query keeps each organisation's
// data apart by it (queryKeyHashFn in main.tsx), and SDK list queries filter
// on it (orgFilter). OrgProvider (lib/org.tsx) decides which one it is.
// Remembered per browser, so the app reopens where you left it.

const STORAGE_KEY = "r2.org";

let current = "";
try {
  current = localStorage.getItem(STORAGE_KEY) ?? "";
} catch {
  // storage blocked (private browsing) — start with none
}

export function currentOrgId(): string {
  return current;
}

export function setCurrentOrgId(id: string) {
  current = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // not remembered across reloads, that's all
  }
}

// For SDK list queries: this organisation's records only. Collection rules
// let someone read every organisation they belong to; the app shows one at
// a time.
export function orgFilter(filter?: string): string {
  const own = pb.filter("org = {:org}", { org: current });
  return filter ? `${own} && (${filter})` : own;
}

// For SDK creates: the record goes in this organisation.
export function withOrg<T extends object>(data: T): T & { org: string } {
  return { ...data, org: current };
}
