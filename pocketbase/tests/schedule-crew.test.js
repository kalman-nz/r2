const test = require("node:test");
const assert = require("node:assert/strict");

const workflow = import("../../web/src/lib/scheduleCrew.ts");

test("inline crew drafts are submitted together on the saved schedule item's times", async () => {
  const { createPeriodWithCrew } = await workflow;
  const submitted = [];
  const period = { id: "period-1", name: "Show day" };

  const result = await createPeriodWithCrew({
    jobId: "job-1",
    crew: [
      { role: "audio", level: "2F", quantity: 2 },
      { role: "audio", level: "2F", quantity: 3 },
      { role: "lighting", level: "", quantity: 1 },
    ],
    createPeriod: async () => period,
    addCrewNeeds: async (jobId, needs) => {
      submitted.push({ jobId, needs });
      return [];
    },
  });

  assert.equal(result.period, period);
  assert.equal(result.crewError, undefined);
  assert.deepEqual(submitted, [
    {
      jobId: "job-1",
      needs: [
        { period: "period-1", role: "audio", level: "2F", quantity: 2, customTimes: false, notes: "" },
        { period: "period-1", role: "audio", level: "2F", quantity: 3, customTimes: false, notes: "" },
        { period: "period-1", role: "lighting", level: "", quantity: 1, customTimes: false, notes: "" },
      ],
    },
  ]);
});

test("the schedule item remains available when the batch crew addition fails", async () => {
  const { createPeriodWithCrew } = await workflow;
  const savedPeriods = [];
  const period = { id: "period-2", name: "Pack out" };
  const crewError = new Error("Quantity cannot exceed 99");

  const result = await createPeriodWithCrew({
    jobId: "job-1",
    crew: [
      { role: "audio", level: "", quantity: 1 },
      { role: "audio", level: "", quantity: 99 },
    ],
    createPeriod: async () => {
      savedPeriods.push(period);
      return period;
    },
    addCrewNeeds: async () => {
      throw crewError;
    },
  });

  assert.deepEqual(savedPeriods, [period]);
  assert.equal(result.period, period);
  assert.equal(result.crewError, crewError);
});

test("a schedule item without inline crew needs is saved without a crew submission", async () => {
  const { createPeriodWithCrew } = await workflow;
  const period = { id: "period-3", name: "Rehearsal" };

  const result = await createPeriodWithCrew({
    jobId: "job-1",
    crew: [],
    createPeriod: async () => period,
    addCrewNeeds: async () => assert.fail("no crew needs should be submitted"),
  });

  assert.equal(result.period, period);
  assert.equal(result.crewError, undefined);
});
