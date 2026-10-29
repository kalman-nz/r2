// Everyone's own dashboards and saved list views (pb_migrations/0036),
// shared through lib/sharing.js. A dashboard is a Home page: panels in
// order, which the web app knows (web/src/lib/home.ts); the server only
// checks their shape. A list view is a page's saved filters.

const { sharingJson } = require("./sharing.js");

// What every organisation starts with (the same as migration 0036).
const DEFAULT_DASHBOARDS = [
  { name: "Overview", isDefault: true, panels: ["glance", "going-out", "coming-back", "confirm", "maintenance", "repairs", "quotes"] },
  { name: "Workshop", panels: ["prep", "going-out", "coming-back", "maintenance", "repairs"] },
  { name: "My projects", panels: ["mine"] },
];
// List pages with saved views (each view keeps that page's filters and
// column settings, as the page itself defines them).
const PAGES = ["projects", "inventory", "contacts", "locations", "crew", "rostering", "maintenance", "repairs", "maintenance-history"];

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function createDefaultDashboards(app, org) {
  if (app.findRecordsByFilter("dashboards", "org = {:org} && owner = ''", "", 1, 0, { org: org }).length > 0) return;
  const collection = app.findCollectionByNameOrId("dashboards");
  for (const d of DEFAULT_DASHBOARDS) {
    app.save(new Record(collection, { org: org, owner: "", name: d.name, panels: d.panels.map((id) => ({ id: id })), public: true, isDefault: !!d.isDefault }));
  }
}

// [{ id }] in order, no repeats.
function cleanPanels(value) {
  if (!Array.isArray(value)) throw new BadRequestError("Pick the panels it shows");
  const out = [];
  const seen = {};
  for (const p of value) {
    const id = p && typeof p === "object" ? p.id : p;
    if (typeof id !== "string" || !/^[a-z][a-z-]{0,29}$/.test(id)) throw new BadRequestError("Not a panel: " + id);
    if (seen[id]) continue;
    seen[id] = true;
    out.push({ id: id });
  }
  if (out.length > 30) throw new BadRequestError("That's a lot of panels: up to 30");
  return out;
}

function cleanName(value) {
  const name = text(value, 60);
  if (!name) throw new BadRequestError("Give it a name");
  return name;
}

// A page's saved filters: a plain object, kept small.
function cleanConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestError("A view needs its settings");
  const json = JSON.stringify(value);
  if (json.length > 10000) throw new BadRequestError("That view has too much in it");
  return JSON.parse(json);
}

function dashboardJson(ctx, me, record, names) {
  const { decodeJson } = require("./records.js");
  const out = sharingJson(ctx, me, record, names);
  out.id = record.id;
  out.name = record.getString("name");
  out.panels = decodeJson(record.get("panels"), []);
  out.isDefault = record.getBool("isDefault");
  return out;
}

function listViewJson(ctx, me, record, names) {
  const { decodeJson } = require("./records.js");
  const out = sharingJson(ctx, me, record, names);
  out.id = record.id;
  out.page = record.getString("page");
  out.name = record.getString("name");
  out.config = decodeJson(record.get("config"), {});
  // The organisation's default for its page.
  out.isDefault = record.getBool("isDefault");
  return out;
}

module.exports = { DEFAULT_DASHBOARDS, PAGES, createDefaultDashboards, cleanPanels, cleanName, cleanConfig, dashboardJson, listViewJson };
