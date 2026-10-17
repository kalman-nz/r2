// Date helpers shared by the availability engine, pricing and the routes.
// Pure (no PocketBase globals), so pocketbase/tests can require it under Node.
//
// PocketBase stores datetimes as "2026-10-16 09:30:00.000Z" (a space, not a
// "T"). V8 parses that, but the JSVM (goja) only reliably parses strict ISO,
// so always go through toMs() rather than Date.parse() directly.

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

// Returns NaN for anything empty or unparseable, so callers can check with
// Number.isFinite().
function toMs(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;
  return Date.parse(String(value).trim().replace(" ", "T"));
}

// The format PocketBase itself writes, so string comparisons in SQL filters
// (e.g. "prepAt < {:to}") line up with what's stored.
function toPbDate(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

module.exports = { HOUR_MS, DAY_MS, toMs, toPbDate };
