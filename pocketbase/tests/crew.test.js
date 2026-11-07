const test = require("node:test");
const assert = require("node:assert/strict");
const { syncNeedTimes, validateCrew, validateNeed } = require("../pb_hooks/lib/crew.js");

global.BadRequestError = class BadRequestError extends Error {};

function record(fields, originalFields = fields) {
  const original = { ...originalFields };
  return {
    id: fields.id || "",
    get: (key) => fields[key],
    getString: (key) => fields[key] || "",
    getBool: (key) => fields[key] === true,
    getInt: (key) => fields[key] || 0,
    isNew: () => !fields.id,
    original: () => ({ getString: (key) => original[key] || "" }),
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

function needFixture(fields = {}, otherNeeds = [], originalFields = fields, assignments = []) {
  const records = {
    jobs: { "job-1": record({ id: "job-1", org: "org-1" }) },
    crew_roles: {
      "role-1": record({ id: "role-1", org: "org-1", name: "Audio operator", levels: '["Basic","Advanced"]' }),
      "role-2": record({ id: "role-2", org: "org-1", name: "Stage manager", levels: '["Basic","Advanced"]' }),
    },
    job_periods: {
      "period-1": record({
        id: "period-1",
        job: "job-1",
        start: "2026-11-07 08:00:00.000Z",
        end: "2026-11-07 10:00:00.000Z",
      }),
      "period-2": record({
        id: "period-2",
        job: "job-1",
        start: "2026-11-07 08:00:00.000Z",
        end: "2026-11-07 10:00:00.000Z",
      }),
      "period-other": record({ id: "period-other", job: "job-other" }),
    },
    crew_needs: [...(originalFields.id ? [record(originalFields)] : []), ...otherNeeds],
    job_crew: assignments,
  };
  const app = {
    findRecordById: (collection, id) => records[collection]?.[id] ?? null,
    findRecordsByFilter: (collection) => records[collection] || [],
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
  }, originalFields);
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

test("editing a crew need to match another need is rejected without changing its assignment", () => {
  const original = {
    id: "need-edit",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Advanced",
    quantity: 2,
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
    notes: "Original",
  };
  const peer = record({
    ...original,
    id: "need-peer",
    level: "Basic",
    quantity: 1,
  });
  const assignment = record({ id: "crew-1", job: "job-1", need: "need-edit", person: "person-1" });
  const { app, need, records } = needFixture({ ...original, level: "Basic" }, [peer], original, [assignment]);

  assert.throws(() => validateNeed(app, need), /would create a matching crew need/);
  assert.equal(records.crew_needs[0].getString("level"), "Advanced");
  assert.equal(records.crew_needs[1].getString("level"), "Basic");
  assert.equal(records.job_crew[0].getString("need"), "need-edit");
});

test("editing a crew need to equal another need's effective times is rejected", () => {
  const original = {
    id: "need-edit",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: true,
    start: "2026-11-07 06:00:00.000Z",
    end: "2026-11-07 07:00:00.000Z",
    notes: "",
  };
  const peer = record({
    ...original,
    id: "need-peer",
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
  });
  const { app, need } = needFixture(
    { ...original, start: "2026-11-07T08:00:00+00:00", end: "2026-11-07T10:00:00+00:00" },
    [peer],
    original,
  );

  assert.throws(() => validateNeed(app, need), /would create a matching crew need/);
});

test("editing a role or schedule item to match another need is rejected", () => {
  const original = {
    id: "need-edit",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
    notes: "",
  };
  const rolePeer = record({ ...original, id: "need-role-peer", role: "role-2" });
  const { app: roleApp, need: roleEdit } = needFixture({ ...original, role: "role-2" }, [rolePeer], original);
  assert.throws(() => validateNeed(roleApp, roleEdit), /would create a matching crew need/);

  const periodPeer = record({ ...original, id: "need-period-peer", period: "period-2" });
  const { app: periodApp, need: periodEdit } = needFixture({ ...original, period: "period-2" }, [periodPeer], original);
  assert.throws(() => validateNeed(periodApp, periodEdit), /would create a matching crew need/);
});

test("an edit does not collide with the crew need being edited", () => {
  const original = {
    id: "need-edit",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
    notes: "Old note",
  };
  const { app, need } = needFixture({ ...original, quantity: 3, notes: "Updated note" }, [], original);

  assert.doesNotThrow(() => validateNeed(app, need));
  assert.equal(need.getInt("quantity"), 3);
  assert.equal(need.getString("notes"), "Updated note");
});

test("ordinary edits and edits to unchanged historical duplicates remain valid", () => {
  const original = {
    id: "need-edit",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
    notes: "Old note",
  };
  const assignment = record({ id: "crew-1", job: "job-1", need: "need-edit", person: "person-1" });
  const { app, need } = needFixture(
    {
      ...original,
      quantity: 3,
      customTimes: true,
      start: "2026-11-07 07:00:00.000Z",
      end: "2026-11-07 11:00:00.000Z",
      notes: "Updated note",
    },
    [],
    original,
    [assignment],
  );

  validateNeed(app, need);

  assert.equal(need.getInt("quantity"), 3);
  assert.equal(need.getString("start"), "2026-11-07 07:00:00.000Z");
  assert.equal(need.getString("notes"), "Updated note");
  assert.equal(assignment.getString("need"), "need-edit");

  const duplicate = record({ ...original, id: "need-duplicate" });
  const legacy = needFixture({ ...original, quantity: 3, notes: "Historical note" }, [duplicate], original, [assignment]);
  assert.doesNotThrow(() => validateNeed(legacy.app, legacy.need));
  assert.equal(legacy.need.getString("notes"), "Historical note");
  assert.equal(legacy.records.crew_needs[1].id, "need-duplicate");
  assert.equal(legacy.records.crew_needs[1].getString("notes"), "Old note");
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
    saveNoValidate: (need) => saved.push(need.id),
  };
  const period = record({ id: "period-1", start, end });

  syncNeedTimes(app, period);

  assert.equal(needs[0].getString("start"), start);
  assert.equal(needs[0].getString("end"), end);
  assert.equal(needs[1].getString("start"), "2026-11-07 07:00:00.000Z");
  assert.equal(needs[1].getString("end"), "2026-11-07 11:00:00.000Z");
  assert.deepEqual(saved, ["need-linked"]);
});

test("moving a schedule item syncs duplicate linked needs even when a custom need now matches", () => {
  const original = {
    id: "need-linked",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: "2026-11-07 08:00:00.000Z",
    end: "2026-11-07 10:00:00.000Z",
    notes: "",
  };
  const second = record({ ...original, id: "need-linked-2" });
  const custom = record({
    ...original,
    id: "need-custom",
    customTimes: true,
    start: "2026-11-07 12:00:00.000Z",
    end: "2026-11-07 14:00:00.000Z",
  });
  const { app, records } = needFixture(original, [second, custom], original);
  const findRecordsByFilter = app.findRecordsByFilter;
  app.findRecordsByFilter = (collection, filter, ...args) => {
    const matches = findRecordsByFilter(collection, filter, ...args);
    return filter === "period = {:id} && customTimes = false"
      ? matches.filter((candidate) => !candidate.getBool("customTimes"))
      : matches;
  };
  app.save = (candidate) => validateNeed(app, candidate);
  const saved = [];
  app.saveNoValidate = (candidate) => saved.push(candidate.id);
  const period = records.job_periods["period-1"];
  period.set("start", "2026-11-07 12:00:00.000Z");
  period.set("end", "2026-11-07 14:00:00.000Z");

  assert.doesNotThrow(() => syncNeedTimes(app, period));
  assert.deepEqual(saved, ["need-linked", "need-linked-2"]);
  assert.equal(records.crew_needs[0].getString("start"), period.getString("start"));
  assert.equal(second.getString("end"), period.getString("end"));
  assert.equal(custom.getString("start"), "2026-11-07 12:00:00.000Z");
});
