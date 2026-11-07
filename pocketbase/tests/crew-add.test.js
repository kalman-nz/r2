const test = require("node:test");
const assert = require("node:assert/strict");
const { addCrewNeeds } = require("../pb_hooks/lib/crew.js");

global.BadRequestError = class BadRequestError extends Error {};

class TestRecord {
  constructor(collection, fields) {
    this.collection = collection;
    this.id = fields.id || "";
    this.fields = { ...fields };
  }

  get(key) {
    return this.fields[key];
  }

  getString(key) {
    const value = this.fields[key];
    return typeof value === "string" ? value : "";
  }

  getBool(key) {
    return this.fields[key] === true;
  }

  getInt(key) {
    return Number(this.fields[key]) || 0;
  }

  getStringSlice(key) {
    return Array.isArray(this.fields[key]) ? this.fields[key] : [];
  }

  isNew() {
    return !this.id;
  }

  set(key, value) {
    this.fields[key] = value;
  }
}

global.Record = TestRecord;

const periodStart = "2026-11-07 08:00:00.000Z";
const periodEnd = "2026-11-07 10:00:00.000Z";

function record(collection, fields) {
  return new TestRecord(collection, fields);
}

function crewApp(seed = {}, failDeleteId = "") {
  const initial = {
    jobs: [record("jobs", { id: "job-1", org: "org-1" })],
    job_periods: [record("job_periods", { id: "period-1", job: "job-1", kind: "other", start: periodStart, end: periodEnd })],
    crew_roles: [record("crew_roles", { id: "role-1", org: "org-1", name: "Audio operator", levels: '["Basic","Advanced"]' })],
    crew_needs: [],
    job_crew: [],
    ...seed,
  };
  const state = Object.fromEntries(Object.entries(initial).map(([name, rows]) => [name, new Map(rows.map((row) => [row.id, row]))]));

  function appFor(records) {
    return {
      findCollectionByNameOrId: (name) => name,
      findRecordById: (collection, id) => {
        const found = records[collection]?.get(id);
        if (!found) throw new Error("not found");
        return found;
      },
      findRecordsByFilter: (collection, filter = "", _sort = "", limit = 0, _offset = 0, params = {}) => {
        let rows = [...(records[collection]?.values() || [])];
        for (const [key, value] of Object.entries(params)) {
          if (filter.includes(`${key} = {:${key}}`)) rows = rows.filter((row) => row.getString(key) === value);
        }
        if (_sort.includes("created")) rows.sort((a, b) => a.getString("created").localeCompare(b.getString("created")));
        return limit > 0 ? rows.slice(0, limit) : rows;
      },
      save: (row) => {
        if (!row.id) row.id = `new-${records[row.collection].size + 1}`;
        if (!row.getString("created")) row.set("created", `2026-11-07T12:00:0${records[row.collection].size}Z`);
        records[row.collection].set(row.id, row);
        return row;
      },
      saveNoValidate: (row) => appFor(records).save(row),
      delete: (row) => {
        if (row.id === failDeleteId) throw new Error("write failed");
        records[row.collection].delete(row.id);
        if (row.collection === "crew_needs") {
          for (const [id, crew] of records.job_crew) {
            if (crew.getString("need") === row.id) records.job_crew.delete(id);
          }
        }
      },
      runInTransaction: (work) => {
        const draft = Object.fromEntries(
          Object.entries(records).map(([name, rows]) => [
            name,
            new Map([...rows].map(([id, row]) => [id, record(name, { ...row.fields, id })])),
          ]),
        );
        work(appFor(draft));
        for (const name of Object.keys(records)) {
          records[name].clear();
          for (const [id, row] of draft[name]) records[name].set(id, row);
        }
      },
    };
  }

  const app = appFor(state);
  return { app, records: state };
}

test("adding a matching crew need increases the existing headcount", () => {
  const existing = record("crew_needs", {
    id: "need-1",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "",
    created: "2026-11-07T08:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [existing] });

  const added = addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "Basic", quantity: 3, customTimes: false },
  ]);

  assert.equal(added.length, 1);
  assert.equal(added[0].id, "need-1");
  assert.equal(records.crew_needs.size, 1);
  assert.equal(records.crew_needs.get("need-1").getInt("quantity"), 5);
});

test("a new need is created once when repeated matching drafts are submitted together", () => {
  const { app, records } = crewApp();

  const added = addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "Basic", quantity: 2, notes: " First call ", customTimes: false },
    { period: "period-1", role: "role-1", level: "Basic", quantity: 3, notes: "First call", customTimes: false },
  ]);

  assert.equal(added.length, 1);
  assert.equal(records.crew_needs.size, 1);
  assert.equal(added[0].getInt("quantity"), 5);
  assert.equal(added[0].getString("notes"), "First call");
});

test("needs with equal effective times match even when only one uses custom times", () => {
  const existing = record("crew_needs", {
    id: "need-custom",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "",
    quantity: 2,
    customTimes: true,
    start: "2026-11-07T08:00:00+00:00",
    end: "2026-11-07T10:00:00+00:00",
    notes: "",
    created: "2026-11-07T08:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [existing] });

  const added = addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "", quantity: 1, customTimes: false },
  ]);

  assert.equal(added[0].id, "need-custom");
  assert.equal(records.crew_needs.size, 1);
  assert.equal(records.crew_needs.get("need-custom").getInt("quantity"), 3);
});

test("a need can reach exactly 99 people and 500 note characters", () => {
  const existing = record("crew_needs", {
    id: "need-limits",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "",
    quantity: 98,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "a".repeat(498),
    created: "2026-11-07T08:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [existing] });

  addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "", quantity: 1, notes: "b", customTimes: false },
  ]);

  assert.equal(records.crew_needs.get("need-limits").getInt("quantity"), 99);
  assert.equal(records.crew_needs.get("need-limits").getString("notes").length, 500);
});

test("notes over 500 characters are rejected without changing the need", () => {
  const existing = record("crew_needs", {
    id: "need-notes",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "",
    quantity: 1,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "a".repeat(500),
    created: "2026-11-07T08:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [existing] });

  assert.throws(
    () => addCrewNeeds(app, "org-1", "job-1", [{ period: "period-1", role: "role-1", level: "", quantity: 1, notes: "b" }]),
    /Combined crew notes cannot exceed 500 characters/,
  );
  assert.equal(records.crew_needs.size, 1);
  assert.equal(records.crew_needs.get("need-notes").getString("notes"), "a".repeat(500));
});

test("a failed consolidation write rolls back need and assignment changes", () => {
  const oldest = record("crew_needs", {
    id: "need-old",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "",
    quantity: 1,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "",
    created: "2026-11-07T07:00:00Z",
  });
  const newer = record("crew_needs", {
    ...oldest.fields,
    id: "need-new",
    created: "2026-11-07T08:00:00Z",
  });
  const assigned = record("job_crew", {
    id: "crew-new",
    job: "job-1",
    need: "need-new",
    person: "person-1",
    created: "2026-11-07T09:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [oldest, newer], job_crew: [assigned] }, "need-new");

  assert.throws(
    () => addCrewNeeds(app, "org-1", "job-1", [{ period: "period-1", role: "role-1", level: "", quantity: 1 }]),
    /write failed/,
  );
  assert.equal(records.crew_needs.size, 2);
  assert.equal(records.crew_needs.get("need-old").getInt("quantity"), 1);
  assert.equal(records.job_crew.get("crew-new").getString("need"), "need-new");
});

test("a failed later draft leaves earlier additions from the same request unapplied", () => {
  const { app, records } = crewApp();

  assert.throws(
    () =>
      addCrewNeeds(app, "org-1", "job-1", [
        { period: "period-1", role: "role-1", level: "", quantity: 1, customTimes: false },
        { period: "period-1", role: "role-1", level: "", quantity: 100, customTimes: false },
      ]),
    /Crew quantity must be from 1 to 99/,
  );

  assert.equal(records.crew_needs.size, 0);
});

test("a quantity limit failure leaves historical needs and assignments unchanged", () => {
  const oldest = record("crew_needs", {
    id: "need-old",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "",
    quantity: 50,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "a".repeat(499),
    created: "2026-11-07T07:00:00Z",
  });
  const newer = record("crew_needs", {
    ...oldest.fields,
    id: "need-new",
    quantity: 49,
    notes: "a".repeat(499),
    created: "2026-11-07T08:00:00Z",
  });
  const assigned = record("job_crew", {
    id: "crew-existing",
    job: "job-1",
    need: "need-new",
    person: "person-1",
    created: "2026-11-07T09:00:00Z",
  });
  const { app, records } = crewApp({ crew_needs: [oldest, newer], job_crew: [assigned] });

  assert.throws(
    () => addCrewNeeds(app, "org-1", "job-1", [{ period: "period-1", role: "role-1", level: "", quantity: 1, notes: "b" }]),
    /Combined crew quantity cannot exceed 99/,
  );
  assert.equal(records.crew_needs.size, 2);
  assert.equal(records.crew_needs.get("need-old").getInt("quantity"), 50);
  assert.equal(records.job_crew.get("crew-existing").getString("need"), "need-new");

  assert.throws(
    () => addCrewNeeds(app, "org-1", "job-1", [{ period: "period-1", role: "role-1", level: "", quantity: 0, notes: "b" }]),
    /Crew quantity must be from 1 to 99/,
  );
});

test("historical matches keep the oldest need and preserve distinct assignments and notes", () => {
  const oldest = record("crew_needs", {
    id: "need-oldest",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "Stage hands\nPPE",
    created: "2026-11-07T07:00:00Z",
  });
  const newer = record("crew_needs", {
    ...oldest.fields,
    id: "need-newer",
    quantity: 3,
    notes: "PPE\nLate call",
    created: "2026-11-07T08:00:00Z",
  });
  const differentWindow = record("crew_needs", {
    ...newer.fields,
    id: "need-other-window",
    start: "2026-11-07 09:00:00.000Z",
    end: "2026-11-07 11:00:00.000Z",
    created: "2026-11-07T09:00:00Z",
  });
  const jobCrew = [
    record("job_crew", { id: "crew-archived", job: "job-1", need: "need-oldest", person: "person-archived", created: "2026-11-07T08:01:00Z" }),
    record("job_crew", { id: "crew-duplicate", job: "job-1", need: "need-newer", person: "person-archived", created: "2026-11-07T08:02:00Z" }),
    record("job_crew", { id: "crew-distinct", job: "job-1", need: "need-newer", person: "person-2", created: "2026-11-07T08:03:00Z" }),
    record("job_crew", { id: "crew-whole-project", job: "job-1", need: "", person: "person-whole", created: "2026-11-07T08:04:00Z" }),
    record("job_crew", { id: "crew-other-window", job: "job-1", need: "need-other-window", person: "person-3", created: "2026-11-07T08:05:00Z" }),
  ];
  const { app, records } = crewApp({
    crew_needs: [oldest, newer, differentWindow],
    job_crew: jobCrew,
    crew_people: [record("crew_people", { id: "person-archived", archived: true })],
  });

  const added = addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "Basic", quantity: 1, notes: " Late call ", customTimes: false },
    { period: "period-1", role: "role-1", level: "Basic", quantity: 1, notes: "  ", customTimes: false },
  ]);

  assert.deepEqual(added.map((need) => need.id), ["need-oldest"]);
  assert.equal(records.crew_needs.size, 2);
  assert.equal(records.crew_needs.get("need-oldest").getInt("quantity"), 7);
  assert.equal(records.crew_needs.get("need-oldest").getString("notes"), "Stage hands\nPPE\nLate call");
  assert.deepEqual(
    [...records.job_crew.values()]
      .filter((crew) => crew.getString("need") === "need-oldest")
      .map((crew) => [crew.id, crew.getString("person")]),
    [
      ["crew-archived", "person-archived"],
      ["crew-distinct", "person-2"],
    ],
  );
  assert.equal(records.job_crew.get("crew-whole-project").getString("need"), "");
  assert.equal(records.job_crew.get("crew-other-window").getString("need"), "need-other-window");
});

test("different levels, roles, schedule items, and time windows stay separate", () => {
  const base = record("crew_needs", {
    id: "need-base",
    org: "org-1",
    job: "job-1",
    period: "period-1",
    role: "role-1",
    level: "Basic",
    quantity: 2,
    customTimes: false,
    start: periodStart,
    end: periodEnd,
    notes: "",
    created: "2026-11-07T07:00:00Z",
  });
  const periodOther = record("job_periods", {
    id: "period-2",
    job: "job-1",
    kind: "other",
    start: periodStart,
    end: periodEnd,
  });
  const otherRole = record("crew_roles", { id: "role-2", org: "org-1", name: "Stage manager", levels: '["Basic"]' });
  const { app, records } = crewApp({
    crew_needs: [base],
    job_periods: [
      record("job_periods", { id: "period-1", job: "job-1", kind: "other", start: periodStart, end: periodEnd }),
      periodOther,
    ],
    crew_roles: [
      record("crew_roles", { id: "role-1", org: "org-1", name: "Audio operator", levels: '["Basic","Advanced"]' }),
      otherRole,
    ],
  });

  const added = addCrewNeeds(app, "org-1", "job-1", [
    { period: "period-1", role: "role-1", level: "Basic", quantity: 1 },
    { period: "period-1", role: "role-1", level: "Advanced", quantity: 1 },
    { period: "period-1", role: "role-2", level: "Basic", quantity: 1 },
    { period: "period-2", role: "role-1", level: "Basic", quantity: 1 },
    { period: "period-1", role: "role-1", level: "Basic", quantity: 1, customTimes: true, start: "2026-11-07 09:00:00.000Z", end: "2026-11-07 11:00:00.000Z" },
  ]);

  assert.equal(added.length, 5);
  assert.equal(records.crew_needs.size, 5);
  assert.equal(records.crew_needs.get("need-base").getInt("quantity"), 3);
});
