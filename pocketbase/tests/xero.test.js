const test = require("node:test");
const assert = require("node:assert/strict");
const { HEADERS, buildXeroCsv, invoiceLines, csvCell } = require("../pb_hooks/lib/xero.js");
const { quoteTotals } = require("../pb_hooks/lib/pricing.js");

// A small snapshot shaped like lib/jobs.js issueQuote() makes: a kit with
// free contents, a chargeable accessory, a per-day item with a line
// discount, a flat custom line, and a job discount. 2 days at factor 1.5.
const lines = [
  { id: "kit", parentLine: "", lineType: "item", name: "Small PA", description: "Two tops and a desk", quantity: 1, unitPrice: 300, priceMode: "per_day", discountPct: 0, group: "Audio" },
  { id: "k1", parentLine: "kit", lineType: "component", name: "Speaker", quantity: 2, unitPrice: 0, priceMode: "per_day", discountPct: 0 },
  { id: "k2", parentLine: "kit", lineType: "component", name: "Mixer", quantity: 1, unitPrice: 0, priceMode: "per_day", discountPct: 0 },
  { id: "mic", parentLine: "", lineType: "item", name: "Vocal mic", quantity: 4, unitPrice: 15, priceMode: "per_day", discountPct: 10 },
  { id: "boom", parentLine: "mic", lineType: "accessory", name: "Boom stand", quantity: 4, unitPrice: 5, priceMode: "per_day", discountPct: 0 },
  { id: "del", parentLine: "", lineType: "custom", name: "Delivery, local", quantity: 1, unitPrice: 150, priceMode: "fixed", discountPct: 0 },
];
const factor = 1.5;
const totals = quoteTotals(lines, { factor, discountPct: 5, gstRate: 15 });
const snapshot = {
  lines,
  pricing: {
    days: 2,
    factor,
    discountPct: 5,
    gstRate: 15,
    totals: { gross: totals.gross / 100, lineDiscount: totals.lineDiscount / 100, jobDiscount: totals.jobDiscount / 100, exGst: totals.exGst / 100 },
  },
};

test("free kit contents fold into the kit line; per-day prices carry the factor", () => {
  const out = invoiceLines(snapshot);
  assert.deepEqual(
    out.map((l) => [l.description, l.quantity, l.unitAmount, l.discountPct]),
    [
      ["Small PA — Two tops and a desk (2 days). Includes 2× Speaker, 1× Mixer", 1, 450, 0],
      ["Vocal mic (2 days)", 4, 22.5, 10],
      ["Boom stand (2 days)", 4, 7.5, 0],
      ["Delivery, local", 1, 150, 0],
      ["Discount (5%)", 1, -totals.jobDiscount / 100, 0],
    ],
  );
});

test("Xero's line maths lands on R2's ex-GST total", () => {
  const xeroTotal = invoiceLines(snapshot).reduce(
    (sum, l) => sum + Math.round(l.quantity * l.unitAmount * (1 - l.discountPct / 100) * 100) / 100,
    0,
  );
  assert.equal(Math.round(xeroTotal * 100), totals.exGst);
});

test("the CSV has Xero's headers, one row per line, and escapes properly", () => {
  const csv = buildXeroCsv(
    [
      {
        invoiceNumber: "R2-1042",
        reference: "PO 77",
        invoiceDate: { day: 3, month: 11, year: 2026 },
        dueDate: { day: 23, month: 11, year: 2026 },
        contact: { name: 'Kōwhai "Events", Ltd', email: "a@example.com", billingAddress: "PO Box 1\nTown\nRegion\n1234\nNew Zealand" },
        snapshot,
      },
    ],
    { accountCode: "200", taxType: "15% GST on Income" },
  );
  const rows = csv.trimEnd().split("\r\n");
  assert.equal(rows[0], HEADERS.join(","));
  assert.equal(rows.length, 1 + 5);
  assert.ok(rows[1].startsWith('"Kōwhai ""Events"", Ltd",a@example.com,PO Box 1,Town,Region,"1234, New Zealand",,,,,R2-1042,PO 77,3/11/2026,23/11/2026,,'));
  assert.ok(rows[1].endsWith(",1,450,,200,15% GST on Income,,,,,NZD,"));
  assert.ok(rows[4].includes(',"Delivery, local",1,150,,'));
});

test("csvCell quotes only when it has to", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(null), "");
});
