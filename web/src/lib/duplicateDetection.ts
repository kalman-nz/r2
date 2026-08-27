import type { Equipment } from "./api";

export type DuplicateReason = "same-code" | "same-name" | "similar-name";

export interface DuplicateGroup {
  key: string;
  reason: DuplicateReason;
  items: Equipment[];
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Simple union-find so a chain of pairwise matches (A~B, B~C) collapses
// into one group (A, B, C) instead of two overlapping ones. Scoped to a
// single pass (same-code, or same-name, or similar-name) — never shared
// across passes, otherwise one weak similar-name link can drag a whole
// same-code cluster's items into a group whose "Same code" label would
// then be a lie for most of its members (this was a real bug: a fuzzy
// name match transitively pulled unrelated items into a same-code group).
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function bucket<K>(map: Map<K, number[]>, key: K): number[] {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  return list;
}

interface IndexGroup {
  key: string;
  reason: DuplicateReason;
  indices: number[];
}

function groupsFromLinks(indices: number[], links: [number, number][], reason: DuplicateReason): IndexGroup[] {
  if (links.length === 0) return [];
  const uf = new UnionFind(indices.length);
  const posOf = new Map(indices.map((idx, pos) => [idx, pos]));
  for (const [a, b] of links) uf.union(posOf.get(a)!, posOf.get(b)!);

  const membersByRoot = new Map<number, number[]>();
  for (const idx of indices) bucket(membersByRoot, uf.find(posOf.get(idx)!)).push(idx);

  const groups: IndexGroup[] = [];
  for (const [root, members] of membersByRoot) {
    if (members.length < 2) continue;
    groups.push({ key: `${reason}-${root}`, reason, indices: members });
  }
  return groups;
}

const SIMILARITY_THRESHOLD = 0.6;
// Tokens shared by more than this many items are too generic ("cable",
// "adapter", "mount", ...) to mean anything — skip them so the similar-name
// pass stays fast and doesn't drown in false positives.
const MAX_BUCKET_SIZE = 40;

// Flags equipment that looks like it might be entered twice. Three
// independent passes, strongest signal first — an item already claimed by
// a stronger pass (exact code match) is excluded from the weaker passes,
// so a group's label always accurately describes every member in it:
//   1. Same code — equipment codes are meant to be unique; this is the
//      strongest signal and usually points at a genuine data-entry dupe.
//   2. Same normalized name (case/punctuation-insensitive).
//   3. Similar name — shares most of its significant words, bucketed by
//      shared token so this stays roughly linear on a ~1000+ item catalog
//      instead of comparing every item against every other one.
// This only *detects* candidates for review — merging/fixing still happens
// in Rentman itself.
export function findDuplicateGroups(items: Equipment[]): DuplicateGroup[] {
  const claimed = new Set<number>();
  const allGroups: DuplicateGroup[] = [];

  function resolveGroups(indexGroups: IndexGroup[]) {
    for (const g of indexGroups) {
      for (const i of g.indices) claimed.add(i);
      allGroups.push({ key: g.key, reason: g.reason, items: g.indices.map((i) => items[i]) });
    }
  }

  // 1. Same code.
  const byCode = new Map<string, number[]>();
  items.forEach((item, i) => {
    const code = (item.code || "").trim().toLowerCase();
    if (code) bucket(byCode, code).push(i);
  });
  const codeLinks: [number, number][] = [];
  for (const list of byCode.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) codeLinks.push([list[a], list[b]]);
    }
  }
  resolveGroups(groupsFromLinks(items.map((_, i) => i), codeLinks, "same-code"));

  // 2. Same normalized name, among items not already claimed by pass 1.
  const remaining1 = items.map((_, i) => i).filter((i) => !claimed.has(i));
  const byName = new Map<string, number[]>();
  remaining1.forEach((i) => {
    const name = normalizeName(items[i].displayname || items[i].name || "");
    if (name) bucket(byName, name).push(i);
  });
  const nameLinks: [number, number][] = [];
  for (const list of byName.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) nameLinks.push([list[a], list[b]]);
    }
  }
  resolveGroups(groupsFromLinks(remaining1, nameLinks, "same-name"));

  // 3. Similar (but not identical) name, among whatever's still unclaimed.
  const remaining2 = items.map((_, i) => i).filter((i) => !claimed.has(i));
  const tokenSets = new Map(remaining2.map((i) => [i, tokenSet(items[i].displayname || items[i].name || "")]));
  const tokenBuckets = new Map<string, number[]>();
  for (const i of remaining2) {
    for (const t of tokenSets.get(i)!) bucket(tokenBuckets, t).push(i);
  }
  const compared = new Set<string>();
  const similarLinks: [number, number][] = [];
  for (const list of tokenBuckets.values()) {
    if (list.length < 2 || list.length > MAX_BUCKET_SIZE) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (compared.has(key)) continue;
        compared.add(key);
        if (jaccard(tokenSets.get(i)!, tokenSets.get(j)!) >= SIMILARITY_THRESHOLD) similarLinks.push([i, j]);
      }
    }
  }
  resolveGroups(groupsFromLinks(remaining2, similarLinks, "similar-name"));

  for (const g of allGroups) {
    g.items.sort((a, b) => (a.displayname || a.name || "").localeCompare(b.displayname || b.name || ""));
  }

  const REASON_RANK: Record<DuplicateReason, number> = { "same-code": 3, "same-name": 2, "similar-name": 1 };
  allGroups.sort((a, b) => {
    if (a.reason !== b.reason) return REASON_RANK[b.reason] - REASON_RANK[a.reason];
    return b.items.length - a.items.length;
  });

  return allGroups;
}
