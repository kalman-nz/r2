const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toCents,
  roundHalfAway,
  chargeableDays,
  dayFactor,
  parseFactors,
  lineAmounts,
  quoteTotals,
} = require("../pb_hooks/lib/pricing.js");

const H = 3600000;

test("toCents rounds to the nearest cent and treats junk as zero", () => {
  assert.equal(toCents(12.345), 1235);
  assert.equal(toCents("45"), 4500);
  assert.equal(toCents(""), 0);
  assert.equal(toCents("abc"), 0);
  assert.equal(toCents(0.1 + 0.2), 30);
});

test("roundHalfAway is symmetric and absorbs float error", () => {
  assert.equal(roundHalfAway(2.5), 3);
  assert.equal(roundHalfAway(-2.5), -3);
  assert.equal(roundHalfAway(1005 * 1.5), 1508);
  assert.equal(roundHalfAway(0), 0);
});

test("chargeableDays counts started 24h periods, minimum 1", () => {
  assert.equal(chargeableDays(0, 15 * H), 1);
  assert.equal(chargeableDays(0, 24 * H), 1);
  assert.equal(chargeableDays(0, 24 * H + 60000), 2);
  assert.equal(chargeableDays(0, 38 * H), 2);
  assert.equal(chargeableDays(0, 0), 1);
  assert.equal(chargeableDays(10, 5), 1);
  assert.equal(chargeableDays(NaN, 5), 1);
});

test("dayFactor reads the table, then adds the extra-day factor", () => {
  const table = [1, 1.5, 2, 2.5, 3];
  assert.equal(dayFactor(1, table, 0.5), 1);
  assert.equal(dayFactor(3, table, 0.5), 2);
  assert.equal(dayFactor(5, table, 0.5), 3);
  assert.equal(dayFactor(7, table, 0.5), 4);
  assert.equal(dayFactor(0, table, 0.5), 1);
  assert.equal(dayFactor(3, [], 0.5), 2);
});

test("parseFactors accepts a comma list and rejects bad tables", () => {
  assert.deepEqual(parseFactors("1, 1.5,2"), [1, 1.5, 2]);
  assert.throws(() => parseFactors(""));
  assert.throws(() => parseFactors("1, abc"));
  assert.throws(() => parseFactors("1, 0"));
  assert.throws(() => parseFactors("1, 2, 1.5"));
});

test("per-day lines use the factor; fixed lines don't", () => {
  assert.deepEqual(lineAmounts({ unitPrice: 45, quantity: 3, priceMode: "per_day" }, 1.5), {
    gross: 20250,
    discount: 0,
    net: 20250,
  });
  assert.deepEqual(lineAmounts({ unitPrice: 120, quantity: 1, priceMode: "fixed" }, 3), {
    gross: 12000,
    discount: 0,
    net: 12000,
  });
});

test("line discounts are percentages, clamped to 0–100", () => {
  assert.equal(lineAmounts({ unitPrice: 100, quantity: 1, discountPct: 10 }, 1).net, 9000);
  assert.equal(lineAmounts({ unitPrice: 100, quantity: 1, discountPct: 150 }, 1).net, 0);
  assert.equal(lineAmounts({ unitPrice: 100, quantity: 1, discountPct: -5 }, 1).net, 10000);
});

test("quote totals: line discounts, then job discount, then 15% GST", () => {
  const lines = [
    { unitPrice: 45, quantity: 4, priceMode: "per_day" }, // 4 × 45 × 2 = 360.00
    { unitPrice: 80, quantity: 1, priceMode: "per_day", discountPct: 25 }, // 160.00 − 40.00
    { unitPrice: 150, quantity: 1, priceMode: "fixed" }, // delivery, 150.00
  ];
  const t = quoteTotals(lines, { factor: 2, discountPct: 10, gstRate: 15 });
  assert.equal(t.gross, 67000);
  assert.equal(t.lineDiscount, 4000);
  assert.equal(t.jobDiscount, 6300); // 10% of 630.00
  assert.equal(t.exGst, 56700);
  assert.equal(t.gst, 8505);
  assert.equal(t.total, 65205);
  assert.equal(t.lines.length, 3);
});

test("GST is rounded once on the total, not per line", () => {
  // Three lines of $0.10: per-line GST would be 3 × round(1.5c) = 6c,
  // on the total it's round(4.5c) = 5c.
  const lines = [1, 2, 3].map(() => ({ unitPrice: 0.1, quantity: 1, priceMode: "fixed" }));
  const t = quoteTotals(lines, { factor: 1, discountPct: 0, gstRate: 15 });
  assert.equal(t.exGst, 30);
  assert.equal(t.gst, 5);
});

test("an empty job totals zero", () => {
  const t = quoteTotals([], { factor: 1, discountPct: 0, gstRate: 15 });
  assert.equal(t.total, 0);
});

const pricing = require("../pb_hooks/lib/pricing.js");

test("lines charge per hour, day, week or once, by their price mode", () => {
  const charge = { factor: 2, hours: 10, weeks: 3 };
  const line = (priceMode) => pricing.lineAmounts({ unitPrice: 10, quantity: 2, discountPct: 0, priceMode }, charge).net;
  assert.equal(line("per_hour"), 20000, "$10/hr × 2 × 10 hours");
  assert.equal(line("per_day"), 4000, "$10/day × 2 × factor 2");
  assert.equal(line("per_week"), 6000, "$10/week × 2 × 3 weeks");
  assert.equal(line("fixed"), 2000, "$10 each × 2");
  assert.equal(pricing.lineAmounts({ unitPrice: 10, quantity: 1, priceMode: "per_day" }, 1.5).net, 1500, "a bare day factor still works");
});

test("weeks are every started 7 days, minimum one", () => {
  assert.equal(pricing.chargeableWeeks(1), 1);
  assert.equal(pricing.chargeableWeeks(7), 1);
  assert.equal(pricing.chargeableWeeks(8), 2);
  assert.equal(pricing.chargeableWeeks(0), 1);
});
