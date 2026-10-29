// Calendar dates ("2026-10-22"): when maintenance is due and when it was
// done. A due date is a day on the calendar, not an instant, so these are
// kept as plain strings: they sort and compare as text, and never shift a
// day when a time zone changes.
//
// Pure (no PocketBase globals), so pocketbase/tests can require it under
// Node — see pocketbase/tests/dates.test.js.

const UNITS = ["day", "week", "month", "year"];

function parts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// A real day in YYYY-MM-DD form (not 2026-02-30).
function isDate(date) {
  const p = parts(date);
  if (!p || p.m < 1 || p.m > 12 || p.d < 1) return false;
  return p.d <= daysInMonth(p.y, p.m);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function format(y, m, d) {
  const pad = (n, w) => String(n).padStart(w, "0");
  return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2);
}

// `every` days/weeks/months/years after `date`. Months and years keep the
// day of the month where they can and otherwise land on the month's last
// day: 31 Jan + 1 month is 28 (or 29) Feb, 29 Feb + 1 year is 28 Feb.
function addInterval(date, every, unit) {
  const p = parts(date);
  if (!p || !isDate(date)) throw new Error("Not a date: " + date);
  const n = Number(every);
  if (!Number.isInteger(n) || n < 1) throw new Error("Every has to be a whole number, 1 or more");
  if (unit === "day" || unit === "week") {
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n * (unit === "week" ? 7 : 1)));
    return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  if (unit !== "month" && unit !== "year") throw new Error("Unknown interval: " + unit);
  const months = p.y * 12 + (p.m - 1) + n * (unit === "year" ? 12 : 1);
  const y = Math.floor(months / 12);
  const m = (months % 12) + 1;
  return format(y, m, Math.min(p.d, daysInMonth(y, m)));
}

// The first day on a fixed schedule (`start`, then every `every`
// days/weeks/months/years from it) that comes after `after`, or on it
// when `onOrAfter`. Each step counts from `start`, so "every month from
// the 31st" stays on the 31st (or the month's last day) and never drifts.
function nextOnSchedule(start, every, unit, after, onOrAfter) {
  if (!isDate(start) || !isDate(after)) throw new Error("Not a date");
  const n = Number(every);
  if (!Number.isInteger(n) || n < 1) throw new Error("Every has to be a whole number, 1 or more");
  const beats = (day) => (onOrAfter ? day >= after : day > after);
  if (beats(start)) return start;
  // Jump close first, then step: steps of about this many days.
  const approx = { day: 1, week: 7, month: 28, year: 365 }[unit] * n;
  const a = parts(start);
  const b = parts(after);
  const gap = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000;
  let k = Math.max(1, Math.floor(gap / approx) - 2);
  // Months are up to 31 days, so a jump of gap/28 can overshoot: back off.
  while (k > 1 && beats(addInterval(start, (k - 1) * n, unit))) k--;
  for (;;) {
    const day = addInterval(start, k * n, unit);
    if (beats(day)) return day;
    k++;
  }
}

// "every 12 months", "every week"
function describeInterval(every, unit) {
  return Number(every) === 1 ? "every " + unit : "every " + every + " " + unit + "s";
}

module.exports = { UNITS, isDate, addInterval, nextOnSchedule, describeInterval };
