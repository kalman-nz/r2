const test = require("node:test");
const assert = require("node:assert/strict");
const { buildIcs, escapeText, icsDate } = require("../pb_hooks/lib/ical.js");

const job = {
  id: "abc123",
  number: 1042,
  name: "Gala; dinner, upstairs",
  status: "provisional",
  start: Date.UTC(2026, 9, 19, 9, 0),
  end: Date.UTC(2026, 9, 21, 12, 0),
  client: "Kōwhai Events",
  venue: "Town Hall\nStage door",
  updated: Date.UTC(2026, 9, 16, 1, 2, 3),
  url: "https://r2.example.com/projects/abc123",
};

test("dates are UTC basic format", () => {
  assert.equal(icsDate(Date.UTC(2026, 9, 19, 9, 0, 5)), "20261019T090005Z");
});

test("text escaping covers the RFC 5545 specials", () => {
  assert.equal(escapeText("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
});

test("a job becomes one event spanning prep to return", () => {
  const ics = buildIcs([job], "Demo jobs", Date.UTC(2026, 9, 16));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /UID:abc123@r2\r\n/);
  assert.match(ics, /DTSTART:20261019T090000Z\r\n/);
  assert.match(ics, /DTEND:20261021T120000Z\r\n/);
  assert.match(ics, /SUMMARY:#1042 Gala\\; dinner\\, upstairs \(Provisional\)\r\n/);
  assert.match(ics, /STATUS:TENTATIVE\r\n/);
  assert.match(ics, /LOCATION:Town Hall\\nStage door\r\n/);
  // Escaped newlines in values mean no raw line break ever lands mid-value.
  for (const line of ics.split("\r\n").slice(0, -1)) assert.match(line, /^(?: |[A-Z-]+[:;])/, `stray line: ${line}`);
});

test("long lines are folded at 74 characters with a leading space", () => {
  const ics = buildIcs([{ ...job, name: "x".repeat(200) }], "Demo", 0);
  for (const line of ics.split("\r\n")) assert.ok(line.length <= 75, `line too long: ${line.length}`);
  assert.match(ics, /\r\n x/);
});

test("confirmed jobs aren't labelled, and the calendar can be empty", () => {
  const ics = buildIcs([{ ...job, status: "confirmed" }], "Demo", 0);
  assert.match(ics, /SUMMARY:#1042 Gala\\; dinner\\, upstairs\r\n/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.doesNotMatch(buildIcs([], "Demo", 0), /VEVENT/);
});

test("the schedule goes in the description, in UTC", () => {
  const withSchedule = {
    ...job,
    periods: [
      { kind: "other", name: "Pack in, dock B", start: Date.UTC(2026, 9, 19, 9, 0), end: Date.UTC(2026, 9, 19, 12, 0) },
      { kind: "billing", name: "Show", start: Date.UTC(2026, 9, 20, 6, 0), end: Date.UTC(2026, 9, 20, 10, 30) },
    ],
  };
  const unfolded = buildIcs([withSchedule], "Demo", Date.UTC(2026, 9, 16)).replace(/\r\n /g, "");
  assert.match(unfolded, /Schedule \(UTC\):\\nPack in\\, dock B: 2026-10-19 09:00 to 2026-10-19 12:00\\nShow \(billed\): 2026-10-20 06:00 to 2026-10-20 10:30/);
});
