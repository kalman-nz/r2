// Small helpers for reading records inside route handlers.

// findRecordById throws when nothing matches; most callers want null.
function findOrNull(app, collection, id) {
  if (!id) return null;
  try {
    return app.findRecordById(collection, id);
  } catch (_) {
    return null;
  }
}

// Record.get() on a "json" field returns the raw stored bytes (a Go []byte
// bridged into goja as an array of char codes), not a decoded value.
// Handing it untouched to e.json() works, but any JS-side read or copy
// (Object.assign, spread, property access) mangles it. Decode it first.
function decodeJson(raw, fallback) {
  const empty = fallback === undefined ? {} : fallback;
  if (raw === null || raw === undefined) return empty;
  if (typeof raw === "string") return raw ? JSON.parse(raw) : empty;
  if (typeof raw.string === "function") {
    const text = raw.string();
    return text && text !== "null" ? JSON.parse(text) : empty;
  }
  if (Array.isArray(raw) || typeof raw.length === "number") {
    if (raw.length === 0) return empty;
    return JSON.parse(String.fromCharCode.apply(null, raw));
  }
  return raw;
}

// A plain-JS copy of a record's fields (what the REST API would return),
// safe to spread and extend. publicExport() leaves out hidden fields.
function toPlain(record) {
  return JSON.parse(JSON.stringify(record.publicExport()));
}

// Turns a thrown Go/JS error into a short message for an API response or
// an import error list: "GoError: barcode: Value must be unique." → the
// part after "GoError: ".
function errorMessage(err) {
  const text = String((err && err.message) || err);
  return text.replace(/^GoError:\s*/, "");
}

module.exports = { findOrNull, decodeJson, toPlain, errorMessage };
