const test = require("node:test");
const assert = require("node:assert/strict");
const { merge, same } = require("../pb_hooks/lib/merge.js");

const base = { name: "Speaker", price: 50, notes: "" };

test("nothing changed: nothing to write", () => {
  const m = merge(base, { ...base }, { ...base });
  assert.deepEqual(m.toLocal, {});
  assert.deepEqual(m.toRemote, {});
  assert.deepEqual(m.conflicts, []);
});

test("a field changed in R2 goes out; one changed remotely comes in", () => {
  const m = merge(base, { ...base, price: 60 }, { ...base, name: "Speaker K12" });
  assert.deepEqual(m.toRemote, { price: 60 });
  assert.deepEqual(m.toLocal, { name: "Speaker K12" });
  assert.deepEqual(m.conflicts, []);
  assert.deepEqual(m.base, { name: "Speaker K12", price: 60, notes: "" });
});

test("both sides changing the same field is a conflict settled by the rule", () => {
  const local = { ...base, price: 60 };
  const remote = { ...base, price: 70 };
  assert.deepEqual(merge(base, local, remote, { rule: "remote" }).toLocal, { price: 70 });
  assert.deepEqual(merge(base, local, remote, { rule: "local" }).toRemote, { price: 60 });
  const newest = merge(base, local, remote, { rule: "newest", localNewer: true });
  assert.deepEqual(newest.toRemote, { price: 60 });
  assert.equal(newest.conflicts.length, 1);
  assert.equal(newest.conflicts[0].winner, "local");
  assert.deepEqual(merge(base, local, remote, { rule: "newest", localNewer: false }).toLocal, { price: 70 });
});

test("both sides making the same change isn't a conflict", () => {
  const m = merge(base, { ...base, price: 60 }, { ...base, price: 60 });
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.base.price, 60);
});

test("inbound only: R2 edits stay in R2 and aren't sent, remote edits still come in", () => {
  const m = merge(base, { ...base, notes: "R2 note" }, { ...base, name: "New" }, { direction: "in" });
  assert.deepEqual(m.toRemote, {});
  assert.deepEqual(m.toLocal, { name: "New" });
  // base keeps the agreed value, so a later Rentman edit to notes still lands
  assert.equal(m.base.notes, "");
});

test("fields the other system won't take stay local", () => {
  const m = merge(base, { ...base, notes: "x", price: 60 }, { ...base }, { outFields: ["price"] });
  assert.deepEqual(m.toRemote, { price: 60 });
  assert.equal(m.base.notes, "");
});

test("first sync: the remote copy wins unless told otherwise", () => {
  assert.deepEqual(merge(null, { name: "A" }, { name: "B" }).toLocal, { name: "B" });
  assert.deepEqual(merge(null, { name: "A" }, { name: "B" }, { firstSync: "local" }).toRemote, { name: "A" });
});

test("a record only in R2 sends everything it's allowed to", () => {
  const m = merge(null, { name: "A", price: 5, notes: "" }, null, { outFields: ["name", "price", "notes"] });
  assert.deepEqual(m.toRemote, { name: "A", price: 5 });
});

test("a record only in the other system comes in whole", () => {
  assert.deepEqual(merge(null, null, { name: "B", price: 2 }).toLocal, { name: "B", price: 2 });
});

test("blank values and key order don't count as changes", () => {
  assert.ok(same("", null));
  assert.ok(same(undefined, ""));
  assert.ok(same({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(same({}, null));
  assert.ok(same(" x ", "x"));
  assert.ok(same(1.0000001, 1));
  assert.ok(!same("a", "b"));
});
