/// <reference path="../pb_data/types.d.ts" />

// Multi-tenancy: one shared database where every business record belongs to
// an organisation, so one person can be in several organisations and a
// platform admin can see them all (the alternative, a PocketBase per
// customer, can't share logins without a separate identity service).
//
// - organisations: the tenants. Platform admins create them
//   (routes_admin.pb.js) and can suspend them, which locks their members out.
// - memberships: user × organisation with a role (admin / planner / tech).
//   Roles used to sit on the user; now someone can be an admin in one
//   organisation and a tech in another.
// - invitations: an org admin invites an email address; whoever signs up or
//   signs in with that (verified) address can accept (routes_me.pb.js).
// - users.isPlatformAdmin: R2's own operators. Only a platform admin or a
//   superuser can grant it; anyone can sign up as a plain user.
//
// Collection rules all key off the signed-in user's memberships through the
// back-relation @request.auth.memberships_via_user. Each check reads ONE
// field, so it can't be satisfied by two different memberships: plannerOrg
// and adminOrg are copies of org that records_validation.pb.js sets only when
// the role is high enough. (Tested: an admin in one organisation gets nothing
// beyond tech access in another where they're a tech.)
//
// Existing data moves into one organisation named after the business; each
// user keeps their role there, and existing admins become platform admins
// (before this, "admin" meant "runs this whole install").
//
// Rolling back only works while there's a single organisation.

const SCOPED = [
  "categories",
  "locations",
  "items",
  "serials",
  "item_components",
  "contacts",
  "venues",
  "jobs",
  "job_lines",
  "quotes",
  "scans",
  "custom_fields",
  "import_runs",
  "settings",
  "label_templates",
  "equipment_views",
  "logs",
];

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const PLANNER = "(@request.auth.memberships_via_user.plannerOrg ?= org && org.suspended = false)";
const ADMIN = "(@request.auth.memberships_via_user.adminOrg ?= org && org.suspended = false)";
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

const RULES = {
  categories: "catalogue",
  locations: "catalogue",
  items: "catalogue",
  serials: "catalogue",
  item_components: "catalogue",
  contacts: "catalogue",
  venues: "catalogue",
  jobs: "catalogue",
};

// Unique per organisation now (barcodes, job numbers, setting keys…).
const INDEXES = {
  categories: ["CREATE UNIQUE INDEX idx_categories_rentmanId ON categories (org, rentmanId) WHERE rentmanId != ''"],
  locations: ["CREATE UNIQUE INDEX idx_locations_rentmanId ON locations (org, rentmanId) WHERE rentmanId != ''"],
  items: [
    "CREATE UNIQUE INDEX idx_items_rentmanId ON items (org, rentmanId) WHERE rentmanId != ''",
    "CREATE UNIQUE INDEX idx_items_barcode ON items (org, barcode) WHERE barcode != ''",
    "CREATE INDEX idx_items_category ON items (category)",
    "CREATE INDEX idx_items_org ON items (org, kind)",
  ],
  serials: [
    "CREATE UNIQUE INDEX idx_serials_rentmanId ON serials (org, rentmanId) WHERE rentmanId != ''",
    "CREATE UNIQUE INDEX idx_serials_barcode ON serials (org, barcode) WHERE barcode != ''",
    "CREATE INDEX idx_serials_item ON serials (item)",
  ],
  contacts: ["CREATE UNIQUE INDEX idx_contacts_rentmanId ON contacts (org, rentmanId) WHERE rentmanId != ''"],
  jobs: [
    "CREATE UNIQUE INDEX idx_jobs_number ON jobs (org, number)",
    "CREATE INDEX idx_jobs_window ON jobs (org, status, prepAt, returnAt)",
    "CREATE UNIQUE INDEX idx_jobs_rentmanId ON jobs (org, rentmanId) WHERE rentmanId != ''",
  ],
  custom_fields: ["CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields (org, key)"],
  settings: ["CREATE UNIQUE INDEX idx_settings_key ON settings (org, key)"],
  logs: ["CREATE INDEX idx_logs_type_created ON logs (org, type, createdAt)"],
  label_templates: ["CREATE INDEX idx_label_templates_org ON label_templates (org)"],
  equipment_views: ["CREATE INDEX idx_equipment_views_owner ON equipment_views (owner, org)"],
};

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const timestamps = () => [
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];

    const orgs = new Collection({
      type: "base",
      name: "organisations",
      fields: [
        { type: "text", name: "name", required: true, max: 200 },
        // Suspended organisations stay intact but their members can't get in.
        { type: "bool", name: "suspended" },
        // Per-organisation switches for features as they arrive (billing,
        // modules…). Empty for now.
        { type: "json", name: "features", maxSize: 100000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        ...timestamps(),
      ],
    });
    app.save(orgs);

    const memberships = new Collection({
      type: "base",
      name: "memberships",
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
        { type: "select", name: "role", required: true, values: ["admin", "planner", "tech"], maxSelect: 1 },
        // Copies of org, set only when the role is high enough (see header).
        { type: "relation", name: "plannerOrg", collectionId: orgs.id, maxSelect: 1 },
        { type: "relation", name: "adminOrg", collectionId: orgs.id, maxSelect: 1 },
        ...timestamps(),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_memberships_org_user ON memberships (org, user)",
        "CREATE INDEX idx_memberships_user ON memberships (user)",
      ],
    });
    app.save(memberships);

    // Read and written only by the routes (rules unset = superuser only).
    const invitations = new Collection({
      type: "base",
      name: "invitations",
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "email", name: "email", required: true },
        { type: "select", name: "role", required: true, values: ["admin", "planner", "tech"], maxSelect: 1 },
        { type: "select", name: "status", required: true, values: ["pending", "accepted", "declined", "revoked"], maxSelect: 1 },
        { type: "relation", name: "invitedBy", collectionId: users.id, maxSelect: 1 },
        { type: "relation", name: "acceptedBy", collectionId: users.id, maxSelect: 1 },
        ...timestamps(),
      ],
      indexes: [
        "CREATE INDEX idx_invitations_email ON invitations (email, status)",
        "CREATE INDEX idx_invitations_org ON invitations (org, status)",
      ],
    });
    app.save(invitations);

    // Rules that need the memberships back-relation to exist first.
    orgs.listRule = "@request.auth.memberships_via_user.org ?= id || @request.auth.isPlatformAdmin = true";
    orgs.viewRule = orgs.listRule;
    app.save(orgs);
    memberships.listRule = "user = @request.auth.id || @request.auth.isPlatformAdmin = true";
    memberships.viewRule = memberships.listRule;
    app.save(memberships);

    // The default organisation for everything that's already here. A
    // brand-new install has nothing but 0009's empty placeholder settings, so
    // it gets no organisation here — first-run setup makes its first one.
    const hasData =
      app.countRecords("users") > 0 ||
      app.findRecordsByFilter("settings", "value != ''", "", 1, 0).length > 0 ||
      SCOPED.some((name) => name !== "settings" && app.countRecords(name) > 0);
    let org = null;
    if (hasData) {
      const businessName = app.findRecordsByFilter("settings", "key = 'businessName'", "", 1, 0)[0];
      org = new Record(orgs, {
        name: (businessName && businessName.getString("value").trim()) || "My organisation",
        suspended: false,
        features: {},
      });
      app.save(org);
    } else {
      app.db().newQuery("DELETE FROM settings").execute();
    }

    for (const name of SCOPED) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.add(new RelationField({ name: "org", collectionId: orgs.id, maxSelect: 1, cascadeDelete: true }));
      app.save(collection);
      // Straight SQL, not app.save() per record: no hooks, and fast.
      if (org) app.db().newQuery("UPDATE " + name + " SET org = {:org}").bind({ org: org.id }).execute();
      // Platform-level log entries (sign-ups, logins) have no organisation.
      if (name !== "logs") collection.fields.getByName("org").required = true;
      if (INDEXES[name]) collection.indexes = INDEXES[name];
      if (RULES[name] === "catalogue") {
        collection.listRule = MEMBER;
        collection.viewRule = MEMBER;
        collection.createRule = PLANNER;
        collection.updateRule = PLANNER + " && " + SAME_ORG;
        collection.deleteRule = PLANNER;
      }
      app.save(collection);
    }

    const rules = {
      job_lines: [MEMBER, MEMBER],
      quotes: [PLANNER, PLANNER],
      scans: [MEMBER, MEMBER],
      custom_fields: [MEMBER, MEMBER],
      import_runs: [ADMIN, ADMIN],
      label_templates: [MEMBER, MEMBER],
    };
    for (const name of Object.keys(rules)) {
      const c = app.findCollectionByNameOrId(name);
      c.listRule = rules[name][0];
      c.viewRule = rules[name][1];
      c.createRule = null;
      c.updateRule = null;
      c.deleteRule = null;
      app.save(c);
    }
    // Settings hold secrets (Rentman token, calendar address) and were
    // readable by any signed-in user through the REST API until now. Only
    // the routes read them from here on.
    const settings = app.findCollectionByNameOrId("settings");
    settings.listRule = null;
    settings.viewRule = null;
    settings.createRule = null;
    settings.updateRule = null;
    settings.deleteRule = null;
    app.save(settings);
    // Saved views: your own (or shared ones) in organisations you're in.
    const views = app.findCollectionByNameOrId("equipment_views");
    views.listRule = "(owner = @request.auth.id || shared = true) && " + MEMBER;
    views.viewRule = views.listRule;
    views.createRule = "owner = @request.auth.id && " + MEMBER;
    views.updateRule = "owner = @request.auth.id && " + SAME_ORG;
    views.deleteRule = "owner = @request.auth.id";
    app.save(views);
    // Activity log: an organisation's admins see its entries; platform
    // admins see the platform-wide ones. Only server code writes it.
    const logs = app.findCollectionByNameOrId("logs");
    logs.listRule = "(org != '' && @request.auth.memberships_via_user.adminOrg ?= org) || @request.auth.isPlatformAdmin = true";
    logs.viewRule = logs.listRule;
    logs.createRule = null;
    app.save(logs);

    // Users: roles move onto memberships.
    users.fields.add(new BoolField({ name: "isPlatformAdmin" }));
    app.save(users);
    for (const user of app.findAllRecords(users)) {
      const role = user.getString("role") || "tech";
      app.save(
        new Record(memberships, {
          org: org.id,
          user: user.id,
          role: role,
          plannerOrg: role === "admin" || role === "planner" ? org.id : "",
          adminOrg: role === "admin" ? org.id : "",
        }),
      );
      if (role === "admin") {
        user.set("isPlatformAdmin", true);
        app.save(user);
      }
    }
    users.fields.removeByName("role");
    // Anyone can sign up (and then sees only what they're invited into);
    // nobody can make themselves a platform admin. People edit only their
    // own account here — platform admins manage others through their routes.
    users.createRule = "@request.body.isPlatformAdmin:isset = false";
    users.updateRule = "id = @request.auth.id && @request.body.isPlatformAdmin:isset = false";
    users.deleteRule = null;
    // You can see yourself and anyone you share an organisation with.
    users.listRule =
      "id = @request.auth.id || @request.auth.isPlatformAdmin = true || @request.auth.memberships_via_user.org ?= memberships_via_user.org";
    users.viewRule = users.listRule;
    app.save(users);
  },
  (app) => {
    const orgs = app.findAllRecords("organisations");
    if (orgs.length > 1) throw new Error("Can't roll back with more than one organisation");

    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new SelectField({ name: "role", values: ["admin", "planner", "tech"], maxSelect: 1 }));
    app.save(users);
    for (const user of app.findAllRecords(users)) {
      const membership = app.findRecordsByFilter("memberships", "user = {:u}", "", 1, 0, { u: user.id })[0];
      user.set("role", user.getBool("isPlatformAdmin") ? "admin" : membership ? membership.getString("role") : "tech");
      app.save(user);
    }
    users.fields.getByName("role").required = true;
    users.fields.removeByName("isPlatformAdmin");
    users.createRule = "@request.auth.role = 'admin'";
    users.updateRule =
      "(id = @request.auth.id || @request.auth.role = 'admin') && (@request.body.role:isset = false || @request.auth.role = 'admin')";
    users.deleteRule = "@request.auth.role = 'admin'";
    users.listRule = "@request.auth.id != ''";
    users.viewRule = "@request.auth.id != ''";
    app.save(users);

    const auth = "@request.auth.id != ''";
    const planner = "(@request.auth.role = 'admin' || @request.auth.role = 'planner')";
    const admin = "@request.auth.role = 'admin'";
    const oldIndexes = {
      categories: ["CREATE UNIQUE INDEX idx_categories_rentmanId ON categories (rentmanId) WHERE rentmanId != ''"],
      locations: ["CREATE UNIQUE INDEX idx_locations_rentmanId ON locations (rentmanId) WHERE rentmanId != ''"],
      items: [
        "CREATE UNIQUE INDEX idx_items_rentmanId ON items (rentmanId) WHERE rentmanId != ''",
        "CREATE UNIQUE INDEX idx_items_barcode ON items (barcode) WHERE barcode != ''",
        "CREATE INDEX idx_items_category ON items (category)",
      ],
      serials: [
        "CREATE UNIQUE INDEX idx_serials_rentmanId ON serials (rentmanId) WHERE rentmanId != ''",
        "CREATE UNIQUE INDEX idx_serials_barcode ON serials (barcode) WHERE barcode != ''",
        "CREATE INDEX idx_serials_item ON serials (item)",
      ],
      contacts: ["CREATE UNIQUE INDEX idx_contacts_rentmanId ON contacts (rentmanId) WHERE rentmanId != ''"],
      jobs: [
        "CREATE UNIQUE INDEX idx_jobs_number ON jobs (number)",
        "CREATE INDEX idx_jobs_window ON jobs (status, prepAt, returnAt)",
        "CREATE UNIQUE INDEX idx_jobs_rentmanId ON jobs (rentmanId) WHERE rentmanId != ''",
      ],
      custom_fields: ["CREATE UNIQUE INDEX idx_custom_fields_key ON custom_fields (key)"],
      settings: ["CREATE UNIQUE INDEX idx_settings_key ON settings (key)"],
      logs: ["CREATE INDEX idx_logs_type_created ON logs (type, createdAt)"],
      label_templates: [],
      equipment_views: ["CREATE INDEX idx_equipment_views_owner ON equipment_views (owner)"],
    };
    // [list, view, create, update, delete] as they were before 0022.
    const catalogue = [auth, auth, planner, planner, planner];
    const oldRules = {
      categories: catalogue,
      locations: catalogue,
      items: catalogue,
      serials: catalogue,
      item_components: catalogue,
      contacts: catalogue,
      venues: catalogue,
      jobs: catalogue,
      job_lines: [auth, auth, null, null, null],
      quotes: [planner, planner, null, null, null],
      scans: [auth, auth, null, null, null],
      custom_fields: [auth, auth, null, null, null],
      import_runs: [admin, admin, null, null, null],
      settings: [auth, auth, auth, auth, null],
      label_templates: [auth, auth, auth, auth, auth],
      equipment_views: [
        "owner = @request.auth.id || shared = true",
        "owner = @request.auth.id || shared = true",
        "@request.auth.id != '' && owner = @request.auth.id",
        "owner = @request.auth.id",
        "owner = @request.auth.id",
      ],
      logs: [admin, admin, auth, null, null],
    };
    // Rules first, in the same save: a rule can't mention a field that's gone.
    for (const name of SCOPED) {
      const c = app.findCollectionByNameOrId(name);
      const r = oldRules[name];
      c.listRule = r[0];
      c.viewRule = r[1];
      c.createRule = r[2];
      c.updateRule = r[3];
      c.deleteRule = r[4];
      c.indexes = oldIndexes[name] || [];
      c.fields.removeByName("org");
      app.save(c);
    }

    app.delete(app.findCollectionByNameOrId("invitations"));
    app.delete(app.findCollectionByNameOrId("memberships"));
    app.delete(app.findCollectionByNameOrId("organisations"));
  },
);
