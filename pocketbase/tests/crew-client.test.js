const test = require("node:test");
const assert = require("node:assert/strict");

const crew = import("../../web/src/lib/crewLogic.ts");

test("back-to-back crew bookings do not overlap", async () => {
  const { overlaps } = await crew;

  assert.equal(overlaps("2026-11-07T08:00:00Z", "2026-11-07T10:00:00Z", "2026-11-07T10:00:00Z", "2026-11-07T12:00:00Z"), false);
});

test("clash detection finds another overlapping booking for the same person only", async () => {
  const { clashesFor } = await crew;
  const need = { id: "need-current", start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z" };
  const bookings = [
    { id: "current", person: "person-1", need: "need-current", expand: { need } },
    { id: "clash", person: "person-1", need: "need-other", expand: { need: { start: "2026-11-07T09:00:00Z", end: "2026-11-07T11:00:00Z" } } },
    { id: "other-person", person: "person-2", need: "need-other", expand: { need: { start: "2026-11-07T09:00:00Z", end: "2026-11-07T11:00:00Z" } } },
    { id: "later", person: "person-1", need: "need-later", expand: { need: { start: "2026-11-07T10:00:00Z", end: "2026-11-07T12:00:00Z" } } },
  ];

  assert.deepEqual(clashesFor(bookings, "person-1", need).map((booking) => booking.id), ["clash"]);
});

test("slot fit accepts the requested skill level or higher", async () => {
  const { fitFor } = await crew;
  const role = { id: "driver", name: "Driver", levels: ["1F", "2F", "4F"] };

  assert.equal(fitFor({ skills: ["driver"], skillLevels: { driver: "4F" } }, role, "2F"), "fits");
  assert.equal(fitFor({ skills: ["driver"], skillLevels: { driver: "1F" } }, role, "2F"), "below");
  assert.equal(fitFor({ skills: [], skillLevels: {} }, role, "2F"), "no");
});
