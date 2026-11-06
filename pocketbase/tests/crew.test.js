const test = require("node:test");
const assert = require("node:assert/strict");
const { syncNeedTimes, validateCrew, validateNeed } = require("../pb_hooks/lib/crew.js");

global.BadRequestError = class BadRequestError extends Error {};

function record(fields) {
  return {
    id: fields.id || "",
    get: (key) => fields[key],
    getString: (key) => fields[key] || "",
    getBool: (key) => fields[key] === true,
    getInt: (key) => fields[key] || 0,
    isNew: () => !fields.id,
    set: (key, value) => {
      fields[key] = value;
    },
  };
}

function rosterFixture(existingCrew, quantity = 1) {
  const records = {
    jobs: { "job-1": record({ id: "job-1", org: "org-1" }) },
    crew_people: {
      "person-1": record({ id: "person-1", org: "org-1", name: "Alex" }),
      "person-2": record({ id: "person-2", org: "org-1", name: "Sam" }),
    },
    crew_needs: {
      "need-1": record({ id: "need-1", job: "job-1", role: "role-1", quantity }),
    },
    crew_roles: {
      "role-1": record({ id: "role-1", org: "org-1", name: "Audio operator" }),
    },
  };
  const app = {
    findRecordById: (collection, id) => records[collection]?.[id] ?? null,
    findRecordsByFilter: (collection) => (collection === "job_crew" ? existingCrew : []),
  };
  return { app, records };
}

function needFixture(fields = {}) {
  const records = {
    jobs: { "job-1": record({ id: "job-1", org: "org-1" }) },
    crew_roles: { "role-1": record({ id: "role-1", org: "org-1", name: "Audio operator", levels: '["Basic","Advanced"]' }) },
    job_periods: {
      "period-1": record({
        id: "period-1",
        job: "job-1",
        start: "2026-11-07 08:00:00.000Z",
        end: "2026-11-07 10:00:00.000Z",
      }),
      "period-other": record({ id: "period-other", job: "job-other" }),
    },
  };
  const app = {
    findRecordById: (collection, id) => records[collection]?.[id] ?? null,
    findRecordsByFilter: () => [],
  };
  const need = record({
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    quantity: 2,
    customTimes: false,
    start: "",
    end: "",
    ...fields,
  });
  return { app, need, records };
}

test("a crew need cannot be assigned more people than its requested quantity", () => {
  const existing = record({ id: "crew-1", job: "job-1", person: "person-1", need: "need-1" });
  const { app } = rosterFixture([existing]);
  const attempt = record({ org: "org-1", job: "job-1", person: "person-2", need: "need-1" });

  assert.throws(() => validateCrew(app, attempt), /All 1 Audio operator spots are filled/);
});

test("the same person cannot be assigned to one crew need twice", () => {
  const existing = record({ id: "crew-1", job: "job-1", person: "person-1", need: "need-1" });
  const { app } = rosterFixture([existing], 3);
  const attempt = record({ org: "org-1", job: "job-1", person: "person-1", need: "need-1" });

  assert.throws(() => validateCrew(app, attempt), /Alex is already on that/);
});

test("a crew need without custom times follows its schedule item", () => {
  const { app, need, records } = needFixture();

  validateNeed(app, need);

  assert.equal(need.getString("start"), records.job_periods["period-1"].getString("start"));
  assert.equal(need.getString("end"), records.job_periods["period-1"].getString("end"));
});

test("a crew need with custom times keeps its own schedule", () => {
  const { app, need } = needFixture({
    customTimes: true,
    start: "2026-11-07 07:00:00.000Z",
    end: "2026-11-07 11:00:00.000Z",
  });

  validateNeed(app, need);

  assert.equal(need.getString("start"), "2026-11-07 07:00:00.000Z");
  assert.equal(need.getString("end"), "2026-11-07 11:00:00.000Z");
});

test("a crew need refuses a finish time that is not after its start", () => {
  const { app, need } = needFixture({
    customTimes: true,
    start: "2026-11-07 11:00:00.000Z",
    end: "2026-11-07 11:00:00.000Z",
  });

  assert.throws(() => validateNeed(app, need), /finish has to be after their start/);
});

test("a crew need must use a schedule item from its project", () => {
  const { app, need } = needFixture({ period: "period-other" });

  assert.throws(() => validateNeed(app, need), /schedule item isn't on this project/);
});

test("a crew need can request one of its role's skill levels", () => {
  const { app, need } = needFixture({ level: "Advanced" });

  validateNeed(app, need);

  assert.equal(need.getString("level"), "Advanced");
});

test("a crew need cannot request a level its role does not offer", () => {
  const { app, need } = needFixture({ level: "Expert" });

  assert.throws(() => validateNeed(app, need), /Expert isn't one of Audio operator's levels/);
});

test("moving a schedule item updates its linked crew needs but not custom times", () => {
  const start = "2026-11-07 12:00:00.000Z";
  const end = "2026-11-07 14:00:00.000Z";
  const needs = [
    record({ id: "need-linked", start: "2026-11-07 08:00:00.000Z", end: "2026-11-07 10:00:00.000Z" }),
    record({ id: "need-custom", start: "2026-11-07 07:00:00.000Z", end: "2026-11-07 11:00:00.000Z" }),
  ];
  needs[1].getBool = (key) => key === "customTimes";
  const saved = [];
  const app = {
    findRecordsByFilter: () => needs.filter((need) => !need.getBool("customTimes")),
    save: (need) => saved.push(need.id),
  };
  const period = record({ id: "period-1", start, end });

  syncNeedTimes(app, period);

  assert.equal(needs[0].getString("start"), start);
  assert.equal(needs[0].getString("end"), end);
  assert.equal(needs[1].getString("start"), "2026-11-07 07:00:00.000Z");
  assert.equal(needs[1].getString("end"), "2026-11-07 11:00:00.000Z");
  assert.deepEqual(saved, ["need-linked"]);
});
