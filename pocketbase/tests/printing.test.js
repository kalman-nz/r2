const test = require("node:test");
const assert = require("node:assert/strict");

// PocketBase's JSVM provides BadRequestError; stand in for it here.
global.BadRequestError = class BadRequestError extends Error {};
const { validatePrintingBody, findPrinter, DEFAULT_SIZES } = require("../pb_hooks/lib/printing.js");

const printer = (over) => ({ id: "p1", name: "Bay 3", host: "192.168.1.50", model: "QL-810W", sizeId: "tape-62", locationId: "", isDefault: true, enabled: true, ...over });

test("a valid setup comes back cleaned", () => {
  const out = validatePrintingBody({ sizes: DEFAULT_SIZES, printers: [printer({ name: "  Bay 3  " })] });
  assert.equal(out.printers[0].name, "Bay 3");
  assert.equal(out.sizes.length, DEFAULT_SIZES.length);
});

test("bad setups are refused", () => {
  const bad = [
    { sizes: DEFAULT_SIZES, printers: [printer({ sizeId: "nope" })] },
    { sizes: DEFAULT_SIZES, printers: [printer({ model: "LaserJet" })] },
    { sizes: DEFAULT_SIZES, printers: [printer({ host: "x; rm -rf /" })] },
    { sizes: DEFAULT_SIZES, printers: [printer(), printer({ id: "p2" })] }, // two defaults
    { sizes: [...DEFAULT_SIZES, DEFAULT_SIZES[0]], printers: [] }, // duplicate size id
    { sizes: [{ id: "s", name: "S", widthMm: 10, lengthMm: 10, brother: "999" }], printers: [] },
  ];
  for (const body of bad) assert.throws(() => validatePrintingBody(body), BadRequestError);
});

test("a job goes to the printer asked for, else the default, never one that's off", () => {
  const config = {
    sizes: DEFAULT_SIZES,
    printers: [printer({ id: "a", isDefault: false }), printer({ id: "b" }), printer({ id: "c", isDefault: false, enabled: false })],
  };
  assert.equal(findPrinter(config, "a").id, "a");
  assert.equal(findPrinter(config, "").id, "b");
  assert.equal(findPrinter(config, "c"), null);
});

test("a printer can go through one of the organisation's print agents, and only theirs", () => {
  const through = validatePrintingBody({ sizes: DEFAULT_SIZES, printers: [printer({ agentId: " a1 " })] }, ["a1", "a2"]);
  assert.equal(through.printers[0].agentId, "a1");
  const direct = validatePrintingBody({ sizes: DEFAULT_SIZES, printers: [printer()] }, ["a1"]);
  assert.equal(direct.printers[0].agentId, "", "no agent: the server sends to it itself");
  assert.throws(() => validatePrintingBody({ sizes: DEFAULT_SIZES, printers: [printer({ agentId: "someone-elses" })] }, ["a1"]), BadRequestError);
});
