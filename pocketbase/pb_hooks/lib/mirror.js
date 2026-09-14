// Generic helpers for the rm_* "mirror" collections — each one just stores
// { rentmanId, data } where `data` is the raw JSON record as Rentman
// returned it. Keeping the raw shape (instead of mapping every field onto
// typed PocketBase columns) means a new Rentman field just shows up in
// `data` for free, with no migration needed.

function upsert(app, collectionName, rentmanId, data) {
  const id = String(rentmanId);
  const collection = app.findCollectionByNameOrId(collectionName);
  let record = null;
  try {
    record = app.findFirstRecordByFilter(collectionName, "rentmanId = {:id}", { id: id });
  } catch (_) {
    record = null;
  }
  if (record) {
    record.set("data", data);
  } else {
    record = new Record(collection, { rentmanId: id, data: data });
  }
  app.save(record);
  return record;
}

// Deletes local rows whose rentmanId is no longer present upstream — keeps
// the mirror in sync with deletions, not just creates/updates.
function removeMissing(app, collectionName, validIds) {
  const idSet = new Set(validIds.map(String));
  const all = app.findAllRecords(collectionName);
  for (const r of all) {
    if (!idSet.has(r.get("rentmanId"))) app.delete(r);
  }
}

// record.get() on a json field hands back a types.JSONRaw — a Go []byte
// bridged into goja as an *array of byte values*, not a decoded JS object
// (see pb_data/types.d.ts: `interface JSONRaw extends Array<number>`).
// PocketBase's own e.json() knows how to marshal that correctly (it calls
// Go's json.Marshaler), so returning it untouched works — but the instant
// you Object.assign/spread it into a plain JS object (to add sibling keys
// like _equipment), goja's JSON.stringify no longer gets Go's marshaler
// involved and serializes it as a literal array of byte numbers instead,
// with no error anywhere. .string() gives the real JSON-encoded text;
// JSON.parse that to get an actual plain JS value before it goes anywhere
// near Object.assign, a .map() merge, or enrich.js.
function toPlain(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(value.string());
}

function allData(app, collectionName) {
  return app.findAllRecords(collectionName).map((r) => toPlain(r.get("data")));
}

function dataById(app, collectionName, rentmanId) {
  try {
    const r = app.findFirstRecordByFilter(collectionName, "rentmanId = {:id}", { id: String(rentmanId) });
    return toPlain(r.get("data"));
  } catch (_) {
    return null;
  }
}

function deleteById(app, collectionName, rentmanId) {
  try {
    const r = app.findFirstRecordByFilter(collectionName, "rentmanId = {:id}", { id: String(rentmanId) });
    app.delete(r);
    return true;
  } catch (_) {
    return false;
  }
}

// Small key/value state store for sync bookkeeping (last run time, last
// error, counts) — same shape as lib/settings.js's key/value pattern.
function getSyncState(app) {
  const rows = app.findAllRecords("sync_state");
  const result = {};
  for (const row of rows) result[row.get("key")] = toPlain(row.get("value"));
  return result;
}

function setSyncState(app, key, value) {
  const collection = app.findCollectionByNameOrId("sync_state");
  let existing = null;
  try {
    existing = app.findFirstRecordByFilter("sync_state", "key = {:key}", { key: key });
  } catch (_) {
    existing = null;
  }
  if (existing) {
    existing.set("value", value);
    app.save(existing);
  } else {
    app.save(new Record(collection, { key: key, value: value }));
  }
}

module.exports = { upsert, removeMissing, allData, dataById, deleteById, getSyncState, setSyncState };
