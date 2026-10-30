// What a role can be allowed to do. Each organisation defines its own roles
// (Settings → Roles) as a name plus a set of these; every organisation
// starts with Admin alone (locked: always everything).
//
// Seeing the organisation's inventory, jobs, contacts and venues comes with
// being a member at all; everything else is one of these. The server checks
// them in collection rules (pb_migrations/0024_custom_roles.js) and in the
// routes (requireOrg/requireRecordOrg in lib/orgs.js).
//
// Adding a permission: add it here, give it to the locked Admin roles in a
// migration (Admin's list is kept complete on every save, see
// records_validation.pb.js), and check it where it applies.

const GROUPS = [
  {
    name: "Inventory",
    permissions: [
      ["items.create", "Add items and kits"],
      ["items.edit", "Edit items and kits"],
      ["items.delete", "Delete items and kits"],
      ["items.kits", "Change kit contents and accessories"],
      ["units.create", "Add units"],
      ["units.edit", "Edit units"],
      ["units.delete", "Delete units"],
      ["units.flag", "Report repairs and record maintenance, and flag units lost or stock out of service"],
      ["maintenance.plans", "Set up repeating maintenance, like inspections and test & tag"],
      ["categories.create", "Add categories"],
      ["categories.edit", "Rename and move categories"],
      ["categories.delete", "Delete categories"],
      ["locations.create", "Add stock locations"],
      ["locations.edit", "Edit stock locations"],
      ["locations.delete", "Delete stock locations"],
    ],
  },
  {
    name: "Projects",
    permissions: [
      ["jobs.create", "Create projects"],
      ["jobs.edit", "Edit project details, dates and status"],
      ["jobs.delete", "Delete projects"],
      ["jobs.lines", "Add and change a project's equipment and services"],
    ],
  },
  {
    name: "Crew",
    permissions: [["crew.manage", "Add freelancers to the crew list and set people's crew skills"]],
  },
  {
    name: "Prices and quotes",
    permissions: [
      ["prices.view", "See prices and totals"],
      ["quotes.view", "See quotes"],
      ["quotes.issue", "Issue quotes"],
      ["quotes.status", "Mark quotes accepted, declined or void"],
    ],
  },
  {
    name: "Warehouse",
    permissions: [
      ["scan.out", "Track kit going out (prep, load)"],
      ["scan.in", "Track kit coming back"],
    ],
  },
  {
    name: "Contacts and locations",
    permissions: [
      ["contacts.create", "Add contacts"],
      ["contacts.edit", "Edit contacts"],
      ["contacts.delete", "Delete contacts"],
      ["venues.create", "Add locations"],
      ["venues.edit", "Edit locations"],
      ["venues.delete", "Delete locations"],
    ],
  },
  {
    name: "Labels",
    permissions: [
      ["labels.print", "Print labels"],
      ["templates.create", "Add label templates"],
      ["templates.edit", "Edit label templates"],
      ["templates.delete", "Delete label templates"],
    ],
  },
  {
    name: "Imports and exports",
    permissions: [
      ["import.csv", "Import spreadsheets"],
      ["integrations.manage", "Set up live sync with Rentman and Momentus"],
      ["export.xero", "Export invoices for Xero"],
    ],
  },
  {
    name: "Administration",
    permissions: [
      ["settings.edit", "Change business, pricing, accounting and printing settings"],
      ["calendar.manage", "See and reset the calendar feed address"],
      ["team.manage", "Invite and remove people, and give them roles"],
      ["roles.manage", "Create and edit roles"],
      ["logs.view", "See the audit log and stats"],
      ["views.publish", "Share dashboards and views with everyone"],
    ],
  },
];

const LABELS = {};
const ALL = [];
for (const group of GROUPS) {
  for (const [key, label] of group.permissions) {
    LABELS[key] = label;
    ALL.push(key);
  }
}

// Some permissions only make sense with another: you can't issue a quote
// you can't see, or see a quote without its prices.
const REQUIRES = {
  "quotes.view": ["prices.view"],
  "quotes.issue": ["quotes.view"],
  "quotes.status": ["quotes.view"],
  "export.xero": ["quotes.view"],
};

// Known permissions only, with their prerequisites, in catalogue order.
function normalise(list) {
  const wanted = {};
  const add = (key) => {
    if (!LABELS[key] || wanted[key]) return;
    wanted[key] = true;
    for (const need of REQUIRES[key] || []) add(need);
  };
  for (const key of Array.isArray(list) ? list : []) add(String(key));
  return ALL.filter((key) => wanted[key]);
}

// A new organisation starts with Admin alone: it makes the roles it needs
// (Settings → Users & access).
const DEFAULT_ROLES = [{ name: "Admin", description: "", locked: true, permissions: ALL }];

// A new organisation's starting roles. Returns { Admin }.
function createDefaultRoles(app, orgId) {
  const collection = app.findCollectionByNameOrId("roles");
  const made = {};
  DEFAULT_ROLES.forEach((def, i) => {
    const role = new Record(collection, {
      org: orgId,
      name: def.name,
      description: def.description,
      locked: def.locked,
      permissions: def.permissions,
      sortOrder: (i + 1) * 10,
    });
    app.save(role);
    made[def.name] = role;
  });
  return made;
}

module.exports = { GROUPS, LABELS, ALL, REQUIRES, normalise, DEFAULT_ROLES, createDefaultRoles };
