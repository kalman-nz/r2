const test = require("node:test");
const assert = require("node:assert/strict");
const { MAPS, outFields } = require("../pb_hooks/lib/rentmanMap.js");
const { statusFor, wallTime, orderItemsFor } = require("../pb_hooks/lib/momentusSync.js");
const { kindOf } = require("../pb_hooks/lib/rentmanSync.js");
const { merge } = require("../pb_hooks/lib/merge.js");

const refs = { categoryFor: (folder) => ({ 12: "cat12" })[folder] || "", folderFor: (cat) => ({ cat12: "12" })[cat] || "" };

test("equipment round-trips Rentman → R2 → Rentman without drifting", () => {
  const eq = { id: 5, name: "K12", code: "K12", folder: "/folders/12", price: 85, weight: 17.5, power: 2000, location_in_warehouse: "A1", external_remark: "Speaker", internal_remark: "", in_archive: false };
  const r2 = MAPS.items.fromRentman(eq, refs);
  assert.equal(r2.category, "cat12");
  const back = MAPS.items.toRentman(r2, refs);
  assert.equal(back.folder, "/folders/12");
  assert.deepEqual(MAPS.items.fromRentman({ id: 5, ...back }, refs), r2);
});

test("only changed fields are sent, under Rentman's names", () => {
  assert.deepEqual(MAPS.items.toRentman({ price: 99, notes: "x" }, refs), { price: 99, internal_remark: "x" });
  assert.deepEqual(MAPS.contacts.toRentman({ email: "a@b.co", kind: "person" }), { email_1: "a@b.co", type: "private" });
});

test("a contact's email falls back to its contact person, and junk isn't an email", () => {
  assert.equal(MAPS.contacts.fromRentman({ id: 1, name: "A", email_1: "not an email" }, null, { email: "p@x.co" }).email, "p@x.co");
});

test("the two-way fields are exactly the mapped ones", () => {
  assert.deepEqual(outFields("venues"), ["name", "phone"]);
  assert.ok(outFields("items").includes("category"));
  assert.deepEqual(outFields("jobs"), []);
});

test("a Rentman-only field changed in R2 stays in R2 even with two-way sync on", () => {
  const base = { name: "A", stockQty: 4 };
  const m = merge(base, { name: "A", stockQty: 6 }, { name: "A", stockQty: 4 }, { direction: "both", outFields: outFields("items") });
  assert.deepEqual(m.toRemote, {});
});

test("webhook item types, however Rentman spells them", () => {
  assert.equal(kindOf("Equipment"), "equipment");
  assert.equal(kindOf("serialnumbers"), "equipment");
  assert.equal(kindOf("ContactPerson"), "contacts");
  assert.equal(kindOf("Project"), "projects");
  assert.equal(kindOf("ProjectEquipment"), "lines");
  assert.equal(kindOf("Invoice"), null);
});

test("Momentus statuses: the venue's mapping first, then by name", () => {
  assert.equal(statusFor("40", "Definite", {}), "confirmed");
  assert.equal(statusFor("30", "Tentative", {}), "provisional");
  assert.equal(statusFor("35", "First option", {}), "provisional");
  assert.equal(statusFor("80", "Cancelled", {}), "cancelled");
  assert.equal(statusFor("10", "Prospect", {}), "enquiry");
  assert.equal(statusFor("40", "Definite", { 40: "provisional" }), "provisional");
});

test("Momentus dates and times in separate fields combine", () => {
  assert.deepEqual(wallTime("2026-11-02T00:00:00", "1900-01-01T18:30:00"), [2026, 11, 2, 18, 30]);
  assert.deepEqual(wallTime("2026-11-02T09:15:00", undefined), [2026, 11, 2, 9, 15]);
  assert.deepEqual(wallTime("2026-11-02", "7:05"), [2026, 11, 2, 7, 5]);
  assert.equal(wallTime("", "10:00"), null);
});

test("quote lines become order items whose totals match the quote", () => {
  const lines = [
    { name: "K12", code: "K12", quantity: 4, amount: 510 },
    { name: "Cable", code: "", parentLine: "x", quantity: 4, amount: 0 },
    { name: "Tech", code: "", quantity: 1, amount: 300, description: "8 hours" },
  ];
  const plan = orderItemsFor(lines, (l) => (l.code === "K12" ? "K12" : ""), "AV-MISC");
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.items[0], { resource: "K12", quantity: 4, price: 127.5, note: "K12" });
  assert.equal(plan.items[1].resource, "AV-MISC");
  assert.equal(plan.items[1].note, "Tech: 8 hours");
  assert.deepEqual(orderItemsFor(lines, () => "", "").missing, ["K12", "Tech"]);
});
