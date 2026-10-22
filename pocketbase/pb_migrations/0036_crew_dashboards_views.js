/// <reference path="../pb_data/types.d.ts" />

// Who's working on what, and everyone's own dashboards and views.
//
// job_crew      People on a project, with what they're doing ("Sound op",
//               "Driver"). Members of the organisation only. "My projects"
//               on dashboards and the Projects list come from here.
//               Planners (jobs.edit) change it.
// dashboards    Home pages anyone can design: panels in order (the web
//               app's lib/home.ts knows them). Like saved views, each is
//               its owner's, shared with the people they pick, or with
//               everyone ("public") — which needs views.publish, an admin's
//               by default (lib/sharing.js). Ones with no owner are the
//               organisation's own: everyone starts with Overview (the
//               default Home), Workshop and My projects.
// list_views    Saved views of a list (the Projects list for now): its
//               filters, shared the same way.
// equipment_views  The Inventory's saved views: "shared" (everyone) becomes
//               public, and they can be shared with people too.
// memberships.homeDashboard  The dashboard someone picked as their Home.
//
// Every organisation also gets a view-only Crew role, for event crew.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";
const SEEN = "(owner = @request.auth.id || public = true || sharedWith.id ?= @request.auth.id)";

const DASHBOARDS = [
  { name: "Overview", isDefault: true, panels: ["glance", "going-out", "coming-back", "confirm", "maintenance", "repairs", "quotes"] },
  { name: "Workshop", panels: ["prep", "going-out", "coming-back", "maintenance", "repairs"] },
  { name: "My projects", panels: ["mine"] },
];
const CREW = { name: "Crew", description: "Sees the projects they're working on, and can look things up", permissions: [] };

function sharing(users) {
  return [
    { type: "bool", name: "public" },
    { type: "relation", name: "sharedWith", collectionId: users.id, maxSelect: 999 },
  ];
}

// fields before the sharing ones, then after: [...before, ...sharing, ...after]
function withSharing(users, before, after) {
  return before.concat(sharing(users), after);
}

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const jobs = app.findCollectionByNameOrId("jobs");
    const users = app.findCollectionByNameOrId("users");

    app.save(
      new Collection({
        type: "base",
        name: "job_crew",
        listRule: MEMBER,
        viewRule: MEMBER,
        createRule: can("jobs.edit") + " && " + SAME_ORG,
        updateRule: can("jobs.edit") + " && " + SAME_ORG,
        deleteRule: can("jobs.edit"),
        fields: [
          { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
          { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
          { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
          { type: "text", name: "function", max: 60 },
          { type: "number", name: "sortOrder", onlyInt: true },
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE UNIQUE INDEX idx_job_crew_job_user ON job_crew (job, user)", "CREATE INDEX idx_job_crew_user ON job_crew (user)"],
      }),
    );

    const dashboards = new Collection({
      type: "base",
      name: "dashboards",
      listRule: MEMBER + " && " + SEEN,
      viewRule: MEMBER + " && " + SEEN,
      fields: withSharing(
        users,
        [
          { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
          { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
          { type: "text", name: "name", required: true, max: 60 },
          { type: "json", name: "panels", maxSize: 20000 },
        ],
        [
          { type: "bool", name: "isDefault" },
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
      ),
      indexes: ["CREATE INDEX idx_dashboards_org ON dashboards (org, owner)"],
    });
    app.save(dashboards);

    app.save(
      new Collection({
        type: "base",
        name: "list_views",
        listRule: MEMBER + " && " + SEEN,
        viewRule: MEMBER + " && " + SEEN,
        fields: withSharing(
          users,
          [
            { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
            { type: "relation", name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
            { type: "select", name: "page", required: true, values: ["projects"], maxSelect: 1 },
            { type: "text", name: "name", required: true, max: 60 },
            { type: "json", name: "config", maxSize: 20000 },
          ],
          [
            { type: "autodate", name: "created", onCreate: true },
            { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
          ],
        ),
        indexes: ["CREATE INDEX idx_list_views_org ON list_views (org, page)"],
      }),
    );

    const equipmentViews = app.findCollectionByNameOrId("equipment_views");
    equipmentViews.fields.add(new BoolField({ name: "public" }));
    equipmentViews.fields.add(new RelationField({ name: "sharedWith", collectionId: users.id, maxSelect: 999 }));
    app.save(equipmentViews);
    app.db().newQuery("UPDATE equipment_views SET public = shared").execute();
    equipmentViews.fields.removeByName("shared");
    equipmentViews.listRule = "owner = @request.auth.id || public = true || sharedWith.id ?= @request.auth.id";
    equipmentViews.viewRule = equipmentViews.listRule;
    app.save(equipmentViews);

    const memberships = app.findCollectionByNameOrId("memberships");
    memberships.fields.add(new RelationField({ name: "homeDashboard", collectionId: dashboards.id, maxSelect: 1 }));
    app.save(memberships);

    const roles = app.findCollectionByNameOrId("roles");
    for (const org of app.findAllRecords("organisations")) {
      DASHBOARDS.forEach((d) => {
        app.save(new Record(dashboards, { org: org.id, owner: "", name: d.name, panels: d.panels.map((id) => ({ id: id })), public: true, isDefault: !!d.isDefault }));
      });
      const existing = app.findRecordsByFilter("roles", "org = {:org}", "-sortOrder", 0, 0, { org: org.id });
      for (const role of existing) {
        // Sharing with everyone is an admin's, like the rest of the permissions they always have.
        if (!role.getBool("locked")) continue;
        const permissions = JSON.parse(role.getString("permissions") || "[]");
        if (permissions.indexOf("views.publish") === -1) {
          permissions.push("views.publish");
          role.set("permissions", permissions);
          app.saveNoValidate(role);
        }
      }
      if (existing.some((r) => r.getString("name").toLowerCase() === "crew")) continue;
      app.saveNoValidate(
        new Record(roles, {
          org: org.id,
          name: CREW.name,
          description: CREW.description,
          locked: false,
          permissions: CREW.permissions,
          sortOrder: (existing.length > 0 ? existing[0].getInt("sortOrder") : 0) + 10,
        }),
      );
    }
  },
  (app) => {
    const memberships = app.findCollectionByNameOrId("memberships");
    memberships.fields.removeByName("homeDashboard");
    app.save(memberships);
    const equipmentViews = app.findCollectionByNameOrId("equipment_views");
    equipmentViews.fields.add(new BoolField({ name: "shared" }));
    app.save(equipmentViews);
    app.db().newQuery("UPDATE equipment_views SET shared = public").execute();
    equipmentViews.fields.removeByName("public");
    equipmentViews.fields.removeByName("sharedWith");
    equipmentViews.listRule = "owner = @request.auth.id || shared = true";
    equipmentViews.viewRule = equipmentViews.listRule;
    app.save(equipmentViews);
    app.delete(app.findCollectionByNameOrId("list_views"));
    app.delete(app.findCollectionByNameOrId("dashboards"));
    app.delete(app.findCollectionByNameOrId("job_crew"));
  },
);
