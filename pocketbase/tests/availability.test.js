// Run with `pnpm test` from the repo root. A double-booking bug is the
// fastest way to lose a customer's trust, so the engine gets the most
// thorough tests in the codebase.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  freeSegments,
  itemAvailability,
  kitFree,
  kitSegments,
  jobShortages,
} = require("../pb_hooks/lib/availability.js");

const H = 3600000;
// Hours from an arbitrary epoch keep the fixtures readable.
const h = (n) => n * H;

function booking(jobId, qty, startH, endH, status = "confirmed", itemId = "desk") {
  return { itemId, qty, start: h(startH), end: h(endH), jobId, status };
}

test("no bookings: everything is free across the whole window", () => {
  const r = itemAvailability("desk", h(0), h(10), { stock: 4, bookings: [] });
  assert.equal(r.free, 4);
  assert.deepEqual(r.segments, [{ start: h(0), end: h(10), free: 4 }]);
});

test("a booking inside the window reduces the minimum, not the average", () => {
  const r = itemAvailability("desk", h(0), h(100), {
    stock: 4,
    bookings: [booking("A", 3, 50, 51)],
  });
  assert.equal(r.free, 1);
  assert.deepEqual(r.segments, [
    { start: h(0), end: h(50), free: 4 },
    { start: h(50), end: h(51), free: 1 },
    { start: h(51), end: h(100), free: 4 },
  ]);
});

test("back-to-back jobs do not overlap (half-open intervals)", () => {
  const r = itemAvailability("desk", h(10), h(20), {
    stock: 2,
    bookings: [booking("A", 2, 0, 10), booking("B", 2, 20, 30)],
  });
  assert.equal(r.free, 2);
});

test("overlapping jobs stack", () => {
  const r = itemAvailability("desk", h(0), h(30), {
    stock: 5,
    bookings: [booking("A", 2, 0, 20), booking("B", 2, 10, 30), booking("C", 2, 15, 16)],
  });
  // 15h–16h: A + B + C = 6 of 5
  assert.equal(r.free, -1);
});

test("overbooking stays negative instead of clamping to zero", () => {
  const r = itemAvailability("desk", h(0), h(10), { stock: 1, bookings: [booking("A", 3, 0, 10)] });
  assert.equal(r.free, -2);
});

test("enquiries, returned and cancelled jobs hold nothing", () => {
  const r = itemAvailability("desk", h(0), h(10), {
    stock: 2,
    bookings: [
      booking("A", 2, 0, 10, "enquiry"),
      booking("B", 2, 0, 10, "returned"),
      booking("C", 2, 0, 10, "cancelled"),
    ],
  });
  assert.equal(r.free, 2);
});

test("provisional holds count, but freeFirm ignores them", () => {
  const r = itemAvailability("desk", h(0), h(10), {
    stock: 4,
    bookings: [booking("A", 1, 0, 10, "confirmed"), booking("B", 2, 0, 10, "provisional")],
  });
  assert.equal(r.free, 1);
  assert.equal(r.freeFirm, 3);
});

test("turnaround buffer extends every booking's end", () => {
  // A returns at 10h; with a 4h buffer the desk isn't back on the shelf
  // until 14h, so a job prepping at 12h clashes.
  const opts = { stock: 1, bufferMs: h(4), bookings: [booking("A", 1, 0, 10)] };
  assert.equal(itemAvailability("desk", h(12), h(20), opts).free, 0);
  assert.equal(itemAvailability("desk", h(14), h(20), opts).free, 1);
});

test("bookings for other items are ignored", () => {
  const r = itemAvailability("desk", h(0), h(10), {
    stock: 1,
    bookings: [booking("A", 1, 0, 10, "confirmed", "mic")],
  });
  assert.equal(r.free, 1);
});

test("excludeJobId leaves a job's own bookings out", () => {
  const r = itemAvailability("desk", h(0), h(10), {
    stock: 2,
    bookings: [booking("A", 2, 0, 10)],
    excludeJobId: "A",
  });
  assert.equal(r.free, 2);
});

test("stock changes add or remove capacity for their interval", () => {
  const r = itemAvailability("desk", h(0), h(30), {
    stock: 2,
    bookings: [booking("A", 3, 10, 20)],
    // A subhire of 1 covers the job, but a unit away for repair from 15h
    // takes it back below zero.
    stockChanges: [
      { itemId: "desk", qty: 1, start: h(5), end: h(25) },
      { itemId: "desk", qty: -1, start: h(15), end: h(30) },
    ],
  });
  assert.equal(r.free, -1);
});

test("a booking and a change cancelling out at the same instant don't split segments", () => {
  const segs = freeSegments(3, [
    { start: h(0), end: h(5), qty: -1 },
    { start: h(5), end: h(10), qty: -1 },
  ], h(0), h(10));
  assert.deepEqual(segs, [{ start: h(0), end: h(10), free: 2 }]);
});

test("zero-length or inverted bookings are ignored", () => {
  const r = itemAvailability("desk", h(0), h(10), {
    stock: 1,
    bookings: [booking("A", 1, 5, 5), booking("B", 1, 8, 2)],
  });
  assert.equal(r.free, 1);
});

test("an empty or inverted window returns no segments", () => {
  assert.deepEqual(freeSegments(3, [], h(5), h(5)), []);
  assert.deepEqual(freeSegments(3, [], h(6), h(5)), []);
});

test("kits are limited by their scarcest component", () => {
  // A "DJ package" = 2 CDJs + 1 mixer
  const components = [
    { itemId: "cdj", qty: 2 },
    { itemId: "mixer", qty: 1 },
  ];
  assert.equal(kitFree(components, { cdj: 5, mixer: 4 }), 2);
  assert.equal(kitFree(components, { cdj: 8, mixer: 1 }), 1);
  assert.equal(kitFree(components, { cdj: 1, mixer: 4 }), 0);
  assert.equal(kitFree(components, { cdj: -2, mixer: 4 }), -1);
  assert.equal(kitFree([], { cdj: 5 }), 0);
});

test("kit timelines take the scarcest component at every instant", () => {
  const cdj = itemAvailability("cdj", h(0), h(30), {
    stock: 4,
    bookings: [booking("A", 2, 10, 20, "confirmed", "cdj")],
  }).segments; // 4, then 2 from 10h–20h, then 4
  const mixer = itemAvailability("mixer", h(0), h(30), {
    stock: 2,
    bookings: [booking("B", 1, 15, 25, "confirmed", "mixer")],
  }).segments; // 2, then 1 from 15h–25h, then 2
  const kit = kitSegments(
    [
      { qty: 2, segments: cdj },
      { qty: 1, segments: mixer },
    ],
    h(0),
    h(30),
  );
  assert.deepEqual(kit, [
    { start: h(0), end: h(10), free: 2 },
    { start: h(10), end: h(25), free: 1 },
    { start: h(25), end: h(30), free: 2 },
  ]);
  assert.deepEqual(kitSegments([], h(0), h(5)), [{ start: h(0), end: h(5), free: 0 }]);
});

test("jobShortages checks each item against other jobs only", () => {
  const bookings = [
    booking("this", 3, 0, 10),
    booking("other", 2, 5, 15, "confirmed"),
    booking("pencil", 1, 0, 10, "provisional"),
  ];
  const result = jobShortages({ id: "this", start: h(0), end: h(10) }, { desk: 3 }, {
    stockByItem: { desk: 4 },
    bookings,
  });
  assert.deepEqual(result.desk, { needed: 3, free: 1, freeFirm: 2, short: 2, shortFirm: 1 });
});

test("jobShortages includes the turnaround buffer in the job's own window", () => {
  // Other job preps 2h after we return; a 4h buffer means our desk won't
  // be back in time.
  const bookings = [booking("other", 1, 12, 20)];
  const opts = { stockByItem: { desk: 1 }, bufferMsByItem: { desk: h(4) }, bookings };
  const r = jobShortages({ id: "this", start: h(0), end: h(10) }, { desk: 1 }, opts);
  assert.equal(r.desk.short, 1);
  const noBuffer = jobShortages({ id: "this", start: h(0), end: h(10) }, { desk: 1 }, {
    stockByItem: { desk: 1 },
    bookings,
  });
  assert.equal(noBuffer.desk.short, 0);
});

test("items with no stock record count as zero owned", () => {
  const r = jobShortages({ id: "this", start: h(0), end: h(10) }, { ghost: 2 }, { stockByItem: {}, bookings: [] });
  assert.equal(r.ghost.short, 2);
});
