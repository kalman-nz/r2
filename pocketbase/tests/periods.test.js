const test = require("node:test");
const assert = require("node:assert/strict");
const { summarise, chargedDays } = require("../pb_hooks/lib/periods.js");

const H = 3600000;
const p = (kind, startH, endH) => ({ kind, start: startH * H, end: endH * H });

test("kit is booked over the usage periods; the project spans everything", () => {
  const s = summarise([p("other", 0, 3), p("usage", 2, 50), p("billing", 24, 30), p("other", 49, 55)]);
  assert.equal(s.prepAt, 2 * H);
  assert.equal(s.returnAt, 50 * H);
  assert.equal(s.startAt, 0);
  assert.equal(s.endAt, 55 * H);
  assert.equal(s.billingStart, 24 * H);
  assert.equal(s.billingEnd, 30 * H);
});

test("without a usage period there's nothing to book, so nothing is derived", () => {
  assert.equal(summarise([]), null);
  assert.equal(summarise([p("billing", 1, 2), p("other", 0, 3)]), null);
});

test("billing periods are charged one by one: two show days around a rehearsal is two days", () => {
  assert.equal(chargedDays([p("usage", 0, 80), p("billing", 8, 20), p("other", 32, 44), p("billing", 56, 68)]), 2);
});

test("overlapping billing periods don't count twice", () => {
  assert.equal(chargedDays([p("billing", 0, 20), p("billing", 10, 30)]), 2);
});

test("no billing periods: null, so the caller falls back", () => {
  assert.equal(chargedDays([p("usage", 0, 10)]), null);
});

test("broken periods are ignored", () => {
  const s = summarise([p("usage", 5, 3), p("usage", 1, 2), { kind: "billing", start: NaN, end: 4 * H }]);
  assert.equal(s.prepAt, 1 * H);
  assert.equal(s.returnAt, 2 * H);
  assert.ok(Number.isNaN(s.billingStart));
});

test("hours charged are the billing periods' total, every started hour", () => {
  const { chargedHours } = require("../pb_hooks/lib/periods.js");
  assert.equal(chargedHours([p("billing", 8, 12), p("other", 12, 20), p("billing", 30, 32.5)]), 7, "4 h + 2.5 h, rounded up");
  assert.equal(chargedHours([p("billing", 0, 5), p("billing", 3, 6)]), 6, "overlaps count once");
  assert.equal(chargedHours([p("usage", 0, 5)]), null);
});
