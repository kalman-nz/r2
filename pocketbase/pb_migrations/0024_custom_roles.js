/// <reference path="../pb_data/types.d.ts" />

// Roles become each organisation's own: a name plus a list of permissions
// (pb_hooks/lib/permissions.js has the catalogue). Memberships and
// invitations point at a role record instead of the fixed
// admin / planner / tech choice. Every organisation gets Admin (locked:
// always every permission), Planner and Tech, which is what everyone had
// before, so nobody's access changes here.
//
// Collection rules check a permission through ONE membership row: the
// @collection.memberships join matches user, organisation and the role's
// permissions on the same row, so a permission held in one organisation
// never counts in another (tested in scripts/smoke-api.mjs). This replaces
// 0022's plannerOrg/adminOrg copies.

// The catalogue as it stands at this migration (lib/permissions.js may grow).
const ALL = [
  "items.create", "items.edit", "items.delete", "items.kits",
  "units.create", "units.edit", "units.delete", "units.flag",
  "categories.create", "categories.edit", "categories.delete",
  "locations.create", "locations.edit", "locations.delete",
  "jobs.create", "jobs.edit", "jobs.delete", "jobs.lines",
  "prices.view", "quotes.view", "quotes.issue", "quotes.status",
  "scan.out", "scan.in",
  "contacts.create", "contacts.edit", "contacts.delete",
  "venues.create", "venues.edit", "venues.delete",
  "labels.print", "templates.create", "templates.edit", "templates.delete",
  "import.csv", "import.rentman", "export.xero",
  "settings.edit", "calendar.manage", "team.manage", "roles.manage", "logs.view",
];
const ADMIN_ONLY = ["settings.edit", "calendar.manage", "team.manage", "roles.manage", "logs.view", "import.rentman"];
const PLANNER = ALL.filter((p) => ADMIN_ONLY.indexOf(p) === -1 && p.indexOf("templates.") !== 0);
const TECH = ["units.flag", "scan.out", "scan.in", "labels.print"];
const DEFAULTS = [
  { key: "admin", name: "Admin", description: "Everything, always. Every organisation keeps at least one.", locked: true, permissions: ALL },
  { key: "planner", name: "Planner", description: "Runs jobs and quotes, and looks after inventory and contacts", locked: false, permissions: PLANNER },
  { key: "tech", name: "Tech", description: "Looks things up, scans kit out and in, flags broken gear, prints labels", locked: false, permissions: TECH },
];

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

// collection → permission prefix for create / edit / delete
const CRUD = {
  categories: "categories",
  locations: "locations",
  items: "items",
  serials: "units",
  contacts: "contacts",
  venues: "venues",
  jobs: "jobs",
};

// 0022's rules, for rolling back.
const OLD_PLANNER = "(@request.auth.memberships_via_user.plannerOrg ?= org && org.suspended = false)";
const OLD_ADMIN = "(@request.auth.memberships_via_user.adminOrg ?= org && org.suspended = false)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const roles = new Collection({
      type: "base",
      name: "roles",
      // Members can see their organisation's roles; only the routes change
      // them (routes_roles.pb.js).
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 60 },
        { type: "text", name: "description", max: 300 },
        { type: "json", name: "permissions", maxSize: 20000 },
        { type: "bool", name: "locked" },
        { type: "number", name: "sortOrder" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_roles_org_name ON roles (org, name COLLATE NOCASE)"],
    });
    app.save(roles);

    // org id → { admin, planner, tech } role ids
    const roleIds = {};
    for (const org of app.findAllRecords(orgs)) {
      roleIds[org.id] = {};
      DEFAULTS.forEach((def, i) => {
        const role = new Record(roles, {
          org: org.id,
          name: def.name,
          description: def.description,
          locked: def.locked,
          permissions: def.permissions,
          sortOrder: (i + 1) * 10,
        });
        app.save(role);
        roleIds[org.id][def.key] = role.id;
      });
    }

    // Memberships and invitations: the old select value → that
    // organisation's role of the same name.
    for (const name of ["memberships", "invitations"]) {
      const collection = app.findCollectionByNameOrId(name);
      const old = app.findAllRecords(collection).map((r) => ({ id: r.id, org: r.getString("org"), role: r.getString("role") || "tech" }));
      collection.fields.removeByName("role");
      if (name === "memberships") {
        collection.fields.removeByName("plannerOrg");
        collection.fields.removeByName("adminOrg");
      }
      app.save(collection);
      collection.fields.add(new RelationField({ name: "role", required: true, collectionId: roles.id, maxSelect: 1 }));
      app.save(collection);
      for (const row of old) {
        app.db()
          .newQuery("UPDATE " + name + " SET role = {:role} WHERE id = {:id}")
          .bind({ role: roleIds[row.org][row.role] || roleIds[row.org].tech, id: row.id })
          .execute();
      }
    }

    for (const name of Object.keys(CRUD)) {
      const c = app.findCollectionByNameOrId(name);
      c.createRule = can(CRUD[name] + ".create");
      c.updateRule = can(CRUD[name] + ".edit") + " && " + SAME_ORG;
      c.deleteRule = can(CRUD[name] + ".delete");
      app.save(c);
    }
    const components = app.findCollectionByNameOrId("item_components");
    components.createRule = can("items.kits");
    components.updateRule = can("items.kits") + " && " + SAME_ORG;
    components.deleteRule = can("items.kits");
    app.save(components);
    const quotes = app.findCollectionByNameOrId("quotes");
    quotes.listRule = can("quotes.view");
    quotes.viewRule = quotes.listRule;
    app.save(quotes);
    const runs = app.findCollectionByNameOrId("import_runs");
    runs.listRule = "(" + can("import.csv") + " || " + can("import.rentman") + ")";
    runs.viewRule = runs.listRule;
    app.save(runs);
    const logs = app.findCollectionByNameOrId("logs");
    logs.listRule = "(org != '' && " + can("logs.view") + ") || @request.auth.isPlatformAdmin = true";
    logs.viewRule = logs.listRule;
    app.save(logs);
  },
  (app) => {
    // Back to admin / planner / tech: the locked role is admin, a role that
    // can edit jobs is planner, anything else tech.
    const kindOf = {};
    for (const role of app.findAllRecords("roles")) {
      const perms = JSON.parse(role.getString("permissions") || "[]");
      kindOf[role.id] = role.getBool("locked") ? "admin" : perms.indexOf("jobs.edit") !== -1 ? "planner" : "tech";
    }
    const orgs = app.findCollectionByNameOrId("organisations");
    for (const name of ["memberships", "invitations"]) {
      const collection = app.findCollectionByNameOrId(name);
      const old = app.findAllRecords(collection).map((r) => ({ id: r.id, org: r.getString("org"), kind: kindOf[r.getString("role")] || "tech" }));
      collection.fields.removeByName("role");
      app.save(collection);
      collection.fields.add(new SelectField({ name: "role", required: true, values: ["admin", "planner", "tech"], maxSelect: 1 }));
      if (name === "memberships") {
        collection.fields.add(new RelationField({ name: "plannerOrg", collectionId: orgs.id, maxSelect: 1 }));
        collection.fields.add(new RelationField({ name: "adminOrg", collectionId: orgs.id, maxSelect: 1 }));
      }
      app.save(collection);
      for (const row of old) {
        const sets = name === "memberships" ? ", plannerOrg = {:planner}, adminOrg = {:admin}" : "";
        app.db()
          .newQuery("UPDATE " + name + " SET role = {:role}" + sets + " WHERE id = {:id}")
          .bind({
            role: row.kind,
            planner: row.kind === "tech" ? "" : row.org,
            admin: row.kind === "admin" ? row.org : "",
            id: row.id,
          })
          .execute();
      }
    }
    app.delete(app.findCollectionByNameOrId("roles"));

    for (const name of [...Object.keys(CRUD), "item_components"]) {
      const c = app.findCollectionByNameOrId(name);
      c.createRule = OLD_PLANNER;
      c.updateRule = OLD_PLANNER + " && " + SAME_ORG;
      c.deleteRule = OLD_PLANNER;
      app.save(c);
    }
    const quotes = app.findCollectionByNameOrId("quotes");
    quotes.listRule = OLD_PLANNER;
    quotes.viewRule = OLD_PLANNER;
    app.save(quotes);
    const runs = app.findCollectionByNameOrId("import_runs");
    runs.listRule = OLD_ADMIN;
    runs.viewRule = OLD_ADMIN;
    app.save(runs);
    const logs = app.findCollectionByNameOrId("logs");
    logs.listRule = "(org != '' && @request.auth.memberships_via_user.adminOrg ?= org) || @request.auth.isPlatformAdmin = true";
    logs.viewRule = logs.listRule;
    app.save(logs);
  },
);
