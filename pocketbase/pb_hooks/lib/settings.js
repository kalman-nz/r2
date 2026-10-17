// Each organisation's settings are rows of { org, key, value } — adding a
// new setting is just reading/writing its key through these functions, no
// schema migration needed. Every value is stored as text.
function getAllSettings(org) {
  const rows = $app.findRecordsByFilter("settings", "org = {:org}", "", 0, 0, { org: org });
  const result = {};
  for (const row of rows) result[row.get("key")] = row.get("value");
  return result;
}

function setSetting(org, key, value) {
  const existing = $app.findRecordsByFilter("settings", "org = {:org} && key = {:key}", "", 1, 0, { org: org, key: key })[0];
  if (existing) {
    existing.set("value", value);
    $app.save(existing);
  } else {
    $app.save(new Record($app.findCollectionByNameOrId("settings"), { org: org, key: key, value: value }));
  }
}

// Known settings and their defaults when no row exists for that key yet.
// The pricing ones are placeholders for each business to change in
// Settings > Pricing, not researched figures (GST at 15% is NZ law).
const DEFAULTS = {
  printerHost: "",
  businessName: "",
  businessShortName: "",
  defaultTemplateId: "",
  // Printed in the quote header.
  businessAddress: "",
  businessPhone: "",
  businessEmail: "",
  gstNumber: "",
  // Percent.
  gstRate: "15",
  // Multiplier on the day rate for 1, 2, 3... days; each day past the end
  // of the list adds extraDayFactor. The default makes a week cost 3 days.
  dayFactors: "1, 1.5, 2, 2.5, 3, 3, 3",
  extraDayFactor: "0.5",
  // Turnaround after every job's return before kit can go out again, on
  // top of any per-item buffer.
  bufferHours: "0",
  quoteValidityDays: "30",
  quoteTerms: "",
  // Dates printed on PDFs use this zone (screens use the browser's own).
  timezone: "Pacific/Auckland",
  // Xero CSV export (lib/xero.js). The account code and tax rate name must
  // match ones in the customer's Xero organisation.
  xeroAccountCode: "200",
  xeroTaxType: "15% GST on Income",
  xeroDueDays: "20",
  invoicePrefix: "R2-",
};

// Zones R2 offers (NZ/AU first). Anything else falls back to the default.
const TIMEZONES = [
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Perth",
  "Australia/Hobart",
  "UTC",
];

// Stored like any other setting but never sent to the browser: GET only
// says whether one is set. An admin can replace or clear it.
const SECRET_KEYS = ["rentmanApiToken"];

// What GET /api/app-settings returns to any member of the organisation.
function publicSettings(org) {
  const all = getAllSettings(org);
  const result = Object.assign({}, DEFAULTS);
  for (const key of Object.keys(DEFAULTS)) {
    if (all[key] !== undefined) result[key] = all[key];
  }
  result.rentmanApiTokenSet = !!all.rentmanApiToken;
  return result;
}

function getSecret(org, key) {
  return getAllSettings(org)[key] || "";
}

// The organisation whose calendar feed address has this token (or "").
function orgForIcalToken(token) {
  if (!token) return "";
  const row = $app.findRecordsByFilter("settings", "key = 'icalToken' && value = {:token}", "", 1, 0, { token: token })[0];
  return row ? row.getString("org") : "";
}

// Throws an Error with a user-facing message if a value can't be used.
function validateSetting(key, value) {
  const { parseFactors } = require(`${__hooks}/lib/pricing.js`);
  const num = Number(value);
  switch (key) {
    case "gstRate":
      if (value.trim() === "" || !Number.isFinite(num) || num < 0 || num > 100) throw new Error("GST rate must be a percentage between 0 and 100");
      break;
    case "dayFactors":
      parseFactors(value);
      break;
    case "extraDayFactor":
    case "bufferHours":
      if (value.trim() === "" || !Number.isFinite(num) || num < 0) throw new Error(key + " must be a number, 0 or more");
      break;
    case "quoteValidityDays":
      if (value.trim() === "" || !Number.isInteger(num) || num < 0) throw new Error("Quote validity must be a whole number of days");
      break;
    case "xeroDueDays":
      if (value.trim() === "" || !Number.isInteger(num) || num < 0) throw new Error("Payment terms must be a whole number of days");
      break;
    case "timezone":
      if (TIMEZONES.indexOf(value) === -1) throw new Error("Unsupported time zone: " + value);
      break;
    case "xeroAccountCode":
    case "xeroTaxType":
      if (!value.trim()) throw new Error(key === "xeroAccountCode" ? "Xero needs an account code" : "Xero needs a tax rate name");
      break;
  }
}

// Parsed pricing settings for lib/pricing.js and the availability engine.
// Values are validated on save; a bad row slipping in some other way falls
// back to the default rather than breaking every job page.
function pricingSettings(org) {
  const { parseFactors } = require(`${__hooks}/lib/pricing.js`);
  const s = publicSettings(org);
  const numberOr = (value, fallback) => {
    const n = Number(value);
    return value !== "" && Number.isFinite(n) && n >= 0 ? n : Number(fallback);
  };
  let factors;
  try {
    factors = parseFactors(s.dayFactors);
  } catch (_) {
    factors = parseFactors(DEFAULTS.dayFactors);
  }
  return {
    gstRate: numberOr(s.gstRate, DEFAULTS.gstRate),
    factors: factors,
    extraDayFactor: numberOr(s.extraDayFactor, DEFAULTS.extraDayFactor),
    bufferHours: numberOr(s.bufferHours, DEFAULTS.bufferHours),
    quoteValidityDays: numberOr(s.quoteValidityDays, DEFAULTS.quoteValidityDays),
  };
}

module.exports = {
  getAllSettings,
  setSetting,
  DEFAULTS,
  TIMEZONES,
  SECRET_KEYS,
  publicSettings,
  getSecret,
  orgForIcalToken,
  validateSetting,
  pricingSettings,
};
