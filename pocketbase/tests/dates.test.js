const test = require("node:test");
const assert = require("node:assert/strict");
const { isDate, addInterval, describeInterval } = require("../pb_hooks/lib/dates.js");

test("isDate takes real calendar days only", () => {
  assert.equal(isDate("2026-10-22"), true);
  assert.equal(isDate("2028-02-29"), true, "leap day");
  assert.equal(isDate("2026-02-29"), false);
  assert.equal(isDate("2026-13-01"), false);
  assert.equal(isDate("2026-10-22 00:00:00.000Z"), false, "a date, not a datetime");
  assert.equal(isDate(""), false);
  assert.equal(isDate(null), false);
});

test("days and weeks count on the calendar, across months and years", () => {
  assert.equal(addInterval("2026-10-22", 10, "day"), "2026-11-01");
  assert.equal(addInterval("2026-12-25", 2, "week"), "2027-01-08");
  assert.equal(addInterval("2027-03-31", 1, "day"), "2027-04-01", "no daylight saving shift");
});

test("months and years keep the day, or land on the month's last day", () => {
  assert.equal(addInterval("2026-10-22", 3, "month"), "2027-01-22");
  assert.equal(addInterval("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(addInterval("2028-01-31", 1, "month"), "2028-02-29");
  assert.equal(addInterval("2026-08-31", 6, "month"), "2027-02-28");
  assert.equal(addInterval("2028-02-29", 1, "year"), "2029-02-28");
  assert.equal(addInterval("2026-10-22", 1, "year"), "2027-10-22");
  assert.equal(addInterval("2026-11-30", 14, "month"), "2028-01-30");
});

test("bad intervals are refused", () => {
  assert.throws(() => addInterval("2026-10-22", 0, "month"));
  assert.throws(() => addInterval("2026-10-22", 1.5, "month"));
  assert.throws(() => addInterval("2026-10-22", 1, "fortnight"));
  assert.throws(() => addInterval("22/10/2026", 1, "day"));
});

test("describeInterval reads naturally", () => {
  assert.equal(describeInterval(1, "year"), "every year");
  assert.equal(describeInterval(3, "month"), "every 3 months");
});
