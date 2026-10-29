// What an organisation uses R2 for (Settings → Features). A theatre with a
// small crew might not scan kit or log repairs; a touring production
// company does both. Every feature is on until the organisation turns it
// off (organisations.features holds { key: false } for those).
//
// Turning one off hides it in the app and stops it on the server: the
// permissions that belong to it count for nobody (lib/orgs.js), the routes
// that aren't behind a permission of their own check with requireFeature(),
// and records_features.pb.js keeps its records from being written through
// the API. A feature that needs another (equipment tracking needs projects)
// is off while that one is.
//
// Projects is the big one: off, R2 is inventory, maintenance and labels (a
// venue that plans its shows in Momentus, say). Contacts and locations are
// a project's clients and venues, so they go with it.

const FEATURES = [
  {
    key: "projects",
    label: "Projects",
    hint: "Projects with their schedules, equipment and status, availability, contacts and locations. Off, R2 is for looking after your inventory",
    permissions: [
      "jobs.create",
      "jobs.edit",
      "jobs.delete",
      "jobs.lines",
      "calendar.manage",
      "contacts.create",
      "contacts.edit",
      "contacts.delete",
      "venues.create",
      "venues.edit",
      "venues.delete",
    ],
  },
  {
    key: "scanning",
    label: "Equipment tracking",
    hint: "Scanning kit through your steps (prepped, loaded, returned) so every bit of equipment on a project has its own status",
    permissions: ["scan.out", "scan.in"],
    needs: "projects",
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
    needs: "projects",
  },
  {
    key: "crew",
    label: "Crew rostering",
    hint: "Crew needs on schedule items (2× Audio operator for the pack in), a crew list with skills and freelancers, and rostering people onto them",
    permissions: ["crew.manage"],
    needs: "projects",
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

// Starting points for a new organisation (first-run setup, the admin
// panel) and Settings → Features: what's on. Each feature can still be
// changed on its own afterwards. Must match PRESETS in web/src/lib/workflow.ts.
const PRESETS = [
  { key: "hire", label: "Hire and production company", on: FEATURES.map((f) => f.key) },
  { key: "venue", label: "Venue with its own shows", on: ["projects", "scanning", "repairs", "maintenance", "labels", "crew"] },
  { key: "inventory", label: "Inventory and maintenance", on: ["repairs", "maintenance", "labels"] },
];

// A preset as the stored form: { key: false } for everything it leaves off.
function presetFeatures(key) {
  const preset = PRESETS.find((p) => p.key === key);
  if (!preset) throw new BadRequestError("Unknown starting point: " + key);
  const stored = {};
  for (const f of FEATURES) if (preset.on.indexOf(f.key) === -1) stored[f.key] = false;
  return stored;
}

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

// Collections whose records belong to a feature: written through the API
// only while it's on (records_features.pb.js).
const FEATURE_OF_COLLECTION = {
  jobs: "projects",
  job_periods: "projects",
  subprojects: "projects",
  job_crew: "projects",
  contacts: "projects",
  venues: "projects",
  crew_needs: "crew",
  crew_people: "crew",
};
const GUARDED_COLLECTIONS = Object.keys(FEATURE_OF_COLLECTION);

function guardWrite(app, record) {
  const { findOrNull } = require("./records.js");
  const key = FEATURE_OF_COLLECTION[record.collection().name];
  const orgId = record.getString("org");
  if (!key || !orgId) return;
  const org = findOrNull(app, "organisations", orgId);
  if (org) requireFeature(org, key);
}

module.exports = { FEATURES, PRESETS, GUARDED_COLLECTIONS, featuresOf, blockingFeature, requireFeature, setFeatures, presetFeatures, guardWrite };
