// Quote maths. Pure functions only, same as lib/availability.js, so they're
// unit-tested under Node (pocketbase/tests/pricing.test.js).
//
// Prices are stored in dollars (ex GST) because that's what people type,
// but every calculation here runs in integer cents and rounds once per
// step, so totals never pick up float drift.

const { HOUR_MS } = require("./time.js");

function toCents(dollars) {
  const n = Number(dollars);
  return Number.isFinite(n) ? roundHalfAway(n * 100) : 0;
}

function fromCents(cents) {
  return cents / 100;
}

// Math.round sends -2.5 to -2; money should round symmetrically. The
// epsilon absorbs float error like 1507.4999999 from 1005 * 1.5.
function roundHalfAway(x) {
  if (x === 0) return 0;
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);
}

function clampPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 100 ? 100 : n;
}

// Charged per started 24 hours, minimum one day: 9am Fri to 11pm Sat (38h)
// is 2 days, and an evening event running past midnight is still 1.
function chargeableDays(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 1;
  return Math.max(1, Math.ceil((endMs - startMs) / (24 * HOUR_MS) - 1e-9));
}

// factors[i] is the multiplier for (i + 1) days, e.g. [1, 1.5, 2] means a
// 3-day hire costs 2× the day rate. Past the end of the table each extra
// day adds extraDayFactor.
function dayFactor(days, factors, extraDayFactor) {
  const table = factors && factors.length ? factors : [1];
  const d = Math.max(1, Math.floor(days));
  if (d <= table.length) return table[d - 1];
  return table[table.length - 1] + (d - table.length) * (Number(extraDayFactor) || 0);
}

// "1, 1.5, 2" → [1, 1.5, 2]. Throws on anything that isn't a list of
// positive, non-decreasing numbers (a longer hire should never cost less).
function parseFactors(text) {
  const parts = String(text || "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) throw new Error("Day factors need at least one value");
  const factors = parts.map(Number);
  for (let i = 0; i < factors.length; i++) {
    if (!Number.isFinite(factors[i]) || factors[i] <= 0) throw new Error("Day factors must be positive numbers");
    if (i > 0 && factors[i] < factors[i - 1]) throw new Error("Day factors can't go down as days go up");
  }
  return factors;
}

// What a line's price is multiplied by, from its priceMode:
//   per_day   the job's day factor (from charged days and the factor table)
//   per_hour  the job's charged hours
//   per_week  the job's charged weeks
//   fixed     1: delivery, a flat labour call, a sold item
// charge is { factor, hours, weeks }, or just the day factor as a number.
function multiplierFor(priceMode, charge) {
  const c = typeof charge === "number" ? { factor: charge } : charge || {};
  if (priceMode === "fixed") return 1;
  if (priceMode === "per_hour") return Number(c.hours) || 1;
  if (priceMode === "per_week") return Number(c.weeks) || 1;
  return Number(c.factor) || 1;
}

// Weeks charged for a number of charged days: every started week, min 1.
function chargeableWeeks(days) {
  return Math.max(1, Math.ceil((Number(days) || 0) / 7 - 1e-9));
}

// line: { unitPrice (dollars), quantity, discountPct, priceMode }
function lineAmounts(line, charge) {
  const unitCents = toCents(line.unitPrice);
  const qty = Number(line.quantity) || 0;
  const multiplier = multiplierFor(line.priceMode, charge);
  const gross = roundHalfAway(unitCents * qty * multiplier);
  const discount = roundHalfAway((gross * clampPct(line.discountPct)) / 100);
  return { gross: gross, discount: discount, net: gross - discount };
}

// lines: lineAmounts lines, each optionally with its own charge.
// opts: { factor, hours, weeks, discountPct (whole-job, applied after line
// discounts), gstRate (percent, e.g. 15) }. Every amount returned is in cents.
// GST is worked out once on the job total rather than per line, which is
// how IRD expects a tax invoice to add up.
function quoteTotals(lines, opts) {
  let gross = 0;
  let lineDiscount = 0;
  let net = 0;
  const amounts = lines.map((line) => {
    // A line on a subproject brings its own { factor, hours, weeks }.
    const a = lineAmounts(line, line.charge || opts);
    gross += a.gross;
    lineDiscount += a.discount;
    net += a.net;
    return a;
  });
  const jobDiscount = roundHalfAway((net * clampPct(opts.discountPct)) / 100);
  const exGst = net - jobDiscount;
  const gst = roundHalfAway((exGst * (Number(opts.gstRate) || 0)) / 100);
  return {
    lines: amounts,
    gross: gross,
    lineDiscount: lineDiscount,
    jobDiscount: jobDiscount,
    exGst: exGst,
    gst: gst,
    total: exGst + gst,
  };
}

module.exports = {
  toCents,
  fromCents,
  roundHalfAway,
  chargeableDays,
  dayFactor,
  chargeableWeeks,
  multiplierFor,
  parseFactors,
  lineAmounts,
  quoteTotals,
};
