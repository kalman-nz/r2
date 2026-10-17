const test = require("node:test");
const assert = require("node:assert/strict");
const { luhnDigit, makeBarcode, isGeneratedBarcode, typedCode } = require("../pb_hooks/lib/codes.js");

test("Luhn check digit matches the textbook example", () => {
  assert.equal(luhnDigit("7992739871"), "3");
});

test("barcodes are 10 digits, never start with 0, and check out", () => {
  let n = 0;
  const lowest = () => 0;
  const highest = () => 0.999999;
  const cycling = () => ((n = (n + 0.137) % 1));
  for (const random of [lowest, highest, cycling, Math.random]) {
    const code = makeBarcode(random);
    assert.match(code, /^[1-9]\d{9}$/);
    assert.ok(isGeneratedBarcode(code), code);
  }
});

test("a single mistyped digit fails the check", () => {
  const code = makeBarcode(Math.random);
  for (let i = 0; i < 10; i++) {
    const wrong = code.slice(0, i) + String((Number(code[i]) + 1) % 10) + code.slice(i + 1);
    assert.ok(!isGeneratedBarcode(wrong) || wrong[0] === "0", wrong);
  }
});

test("typed codes lose their spaces and dashes, other tags are left alone", () => {
  assert.equal(typedCode(" 123 456-7890 "), "1234567890");
  assert.equal(typedCode("AV DESK 2"), "AV DESK 2");
});
