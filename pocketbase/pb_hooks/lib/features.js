// What an organisation uses R2 for (Settings → Features). A theatre with a
// small crew might not scan kit or log repairs; a touring production
// company does both. Every feature is on until the organisation turns it
// off (organisations.features holds { key: false } for those).
//
// Turning one off hides it in the app and stops it on the server: the
// permissions that belong to it count for nobody (lib/orgs.js), and the
// routes that aren't behind a permission of their own check with
// requireFeature().

const FEATURES = [
  {
    key: "scanning",
    label: "Equipment tracking",
    hint: "Scanning kit through your steps (prepped, loaded, returned) so every bit of equipment on a project has its own status",
    permissions: ["scan.out", "scan.in"],
  },
  {
    key: "repairs",
    label: "Repairs",
    hint: "Repair jobs for broken kit, with statuses, files and costs. Off, units are just flagged In repair",
    permissions: [],
  },
  {
    key: "maintenance",
    label: "Maintenance plans",
    hint: "Scheduled and repeating work: inspections, test & tag, services",
    permissions: ["maintenance.plans"],
  },
  {
    key: "labels",
    label: "Labels and printing",
    hint: "Barcode and QR labels, label templates and the label printer",
    permissions: ["labels.print", "templates.create", "templates.edit", "templates.delete"],
  },
  {
    key: "pricing",
    label: "Prices and quotes",
    hint: "Day rates, project totals, quotes and their PDFs. Off for kit that's only used in house",
    permissions: ["prices.view", "quotes.view", "quotes.issue", "quotes.status", "export.xero"],
  },
  {
    key: "integrations",
    label: "Live sync",
    hint: "Keeping R2 in step with Rentman, or with event bookings in Momentus (Settings → Integrations)",
    permissions: ["integrations.manage"],
  },
  {
    key: "xero",
    label: "Xero export",
    hint: "Invoices for Xero from accepted quotes",
    permissions: ["export.xero"],
    needs: "pricing",
  },
];

const BY_KEY = {};
for (const f of FEATURES) BY_KEY[f.key] = f;

// { key: true/false } for every feature. A feature that needs another is
// off while that one is.
function featuresOf(org) {
  const { decodeJson } = require("./records.js");
  const stored = org ? decodeJson(org.get("features"), {}) : {};
  const on = {};
  for (const f of FEATURES) on[f.key] = stored[f.key] !== false;
  for (const f of FEATURES) if (f.needs && !on[f.needs]) on[f.key] = false;
  return on;
}

// The feature that turns this permission off for everyone, if one does.
function blockingFeature(features, permission) {
  for (const f of FEATURES) if (!features[f.key] && f.permissions.indexOf(permission) !== -1) return f;
  return null;
}

function requireFeature(org, key) {
  if (!featuresOf(org)[key]) throw new ForbiddenError(BY_KEY[key].label + " is turned off for this organisation (Settings → Features)");
}

// Changes some features: { key: boolean }. Returns the new state.
function setFeatures(app, org, changes) {
  const { decodeJson } = require("./records.js");
  if (!changes || typeof changes !== "object") throw new BadRequestError("Say which features to change");
  const stored = decodeJson(org.get("features"), {});
  for (const key in changes) {
    if (!BY_KEY[key]) throw new BadRequestError("Unknown feature: " + key);
    if (changes[key] === false) stored[key] = false;
    else delete stored[key];
  }
  org.set("features", stored);
  app.save(org);
  return featuresOf(org);
}

module.exports = { FEATURES, featuresOf, blockingFeature, requireFeature, setFeatures };
