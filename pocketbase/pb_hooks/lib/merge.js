// Field-by-field three-way merge for live sync (lib/sync.js). Pure (no
// PocketBase globals), so pocketbase/tests can require it under Node.
//
// Every synced record keeps `base`: its fields as they were the last time
// both sides agreed. Comparing base with R2's copy and the other system's
// copy says who changed what:
//   only R2 changed a field          → it goes to the other system
//   only the other system changed it → it comes into R2
//   both changed it to different values → a conflict, settled by the rule
// Fields are in R2's shape (R2 field names and values) on both sides; the
// connector converts the other system's record first.

// Empty-ish values all count as "nothing": a blank string in R2 and a null
// in Rentman are the same field.
function isBlank(v) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Object keys sorted, so { a, b } and { b, a } compare equal.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const out = {};
    for (const key of Object.keys(v).sort()) if (!isBlank(v[key])) out[key] = stable(v[key]);
    return out;
  }
  return v;
}

function same(a, b) {
  if (isBlank(a) && isBlank(b)) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  if (typeof a === "object" || typeof b === "object") {
    const sa = JSON.stringify(stable(a));
    const sb = JSON.stringify(stable(b));
    return sa === sb || (sa === "{}" && isBlank(b)) || (sb === "{}" && isBlank(a));
  }
  return a === b;
}

// base: fields as last synced, or null for a record never synced before.
// local, remote: the fields now on each side (local null: R2 hasn't got it
// yet; remote null: the other system hasn't).
// opts:
//   fields      which fields to merge (default: every field on either side)
//   outFields   the ones the other system lets R2 write; changes to the
//               rest stay in R2
//   direction   "both" | "in" (other system → R2 only) | "out" (R2 → it)
//   rule        conflict winner: "newest" | "remote" | "local"
//   localNewer  for "newest": whether R2's copy changed more recently
//   firstSync   who wins where a never-synced record differs: "remote"
//               (default, an import) or "local"
// Returns { toLocal, toRemote, conflicts, base } where toLocal/toRemote are
// the fields to write to each side and base is what to keep for next time.
function merge(base, local, remote, opts) {
  const o = opts || {};
  const direction = o.direction || "both";
  const rule = o.rule || "newest";
  const canIn = direction !== "out";
  const outFields = o.outFields || null;
  const canOutField = (f) => direction !== "in" && (!outFields || outFields.indexOf(f) !== -1);
  const fields = o.fields || unionKeys(local, remote);
  const toLocal = {};
  const toRemote = {};
  const conflicts = [];
  const next = Object.assign({}, base || {});

  for (const f of fields) {
    const l = local ? local[f] : undefined;
    const r = remote ? remote[f] : undefined;
    const hasBase = !!base && Object.prototype.hasOwnProperty.call(base, f);
    const b = hasBase ? base[f] : undefined;
    if (!remote) {
      // Only R2 has it: send what's allowed, remember it as agreed.
      if (canOutField(f) && !isBlank(l)) toRemote[f] = l;
      next[f] = l;
      continue;
    }
    if (!local) {
      if (canIn) toLocal[f] = r;
      next[f] = r;
      continue;
    }
    if (same(l, r)) {
      next[f] = r;
      continue;
    }
    const localChanged = hasBase ? !same(l, b) : null;
    const remoteChanged = hasBase ? !same(r, b) : null;
    let winner;
    if (!hasBase) {
      winner = (o.firstSync || "remote") === "local" ? "local" : "remote";
    } else if (localChanged && !remoteChanged) {
      winner = "local";
    } else if (remoteChanged && !localChanged) {
      winner = "remote";
    } else {
      // Both changed it.
      winner = rule === "local" ? "local" : rule === "remote" ? "remote" : o.localNewer ? "local" : "remote";
      conflicts.push({ field: f, local: l, remote: r, winner: winner });
    }
    if (winner === "local" && !canOutField(f)) {
      // R2's edit can't go anywhere: keep it in R2 and leave base alone, so
      // a later change on the other side still comes in.
      continue;
    }
    if (winner === "remote" && !canIn) continue;
    if (winner === "local") {
      toRemote[f] = l;
      next[f] = l;
    } else {
      toLocal[f] = r;
      next[f] = r;
    }
  }
  return { toLocal: toLocal, toRemote: toRemote, conflicts: conflicts, base: next };
}

function unionKeys(a, b) {
  const seen = {};
  const out = [];
  for (const obj of [a, b]) {
    for (const key of Object.keys(obj || {})) {
      if (!seen[key]) {
        seen[key] = true;
        out.push(key);
      }
    }
  }
  return out;
}

function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}

module.exports = { merge, same, isBlank, isEmpty };
