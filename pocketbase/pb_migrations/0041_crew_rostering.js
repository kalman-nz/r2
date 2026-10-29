/// <reference path="../pb_data/types.d.ts" />

// Crew rostering: what each schedule item needs, and who's doing it.
//
// crew_roles    The organisation's own list of crew roles ("Audio operator",
//               "Technical labour"): Settings → Crew roles, changed only
//               through PUT /api/crew-roles. Not the same as the permission
//               roles in Settings → Roles.
// crew_people   Everyone who can be rostered: each member of the
//               organisation (user set, kept by the server: lib/crew.js), and
//               freelancers who don't log in (name, phone, email). skills are
//               the crew roles they do, which rostering offers first.
//               crew.manage adds freelancers and sets skills.
// crew_needs    A schedule item's crew: a role and how many ("3× Technical
//               labour"). start/end are the item's times, kept in step with
//               it, unless customTimes (audio in an hour early). Planners
//               (jobs.edit) change them.
// job_crew      Gains person (who) and need (the slot they fill; "" for the
//               whole project, like everyone on a crew until now). user stays,
//               filled in from the person, so "My projects" still reads it.
//
// Every organisation starts with a list of crew roles, and every member gets
// their crew_people record. crew.manage goes to Admin and Planner roles.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

const DEFAULT_ROLES = ["Audio operator", "Lighting operator", "Video operator", "Stage manager", "Rigger", "Technical labour", "Driver"];

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const jobs = app.findCollectionByNameOrId("jobs");
    const users = app.findCollectionByNameOrId("users");
    const periods = app.findCollectionByNameOrId("job_periods");

    const roles = new Collection({
      type: "base",
      name: "crew_roles",
      listRule: MEMBER,
      viewRule: MEMBER,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 60 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_crew_roles_org ON crew_roles (org, sortOrder)"],
    });
    app.save(roles);

    const people = new Collection({
      type: "base",
      name: "crew_people",
      listRule: MEMBER,
      viewRule: MEMBER,
      // Freelancers only: members' records are the server's.
      createRule: can("crew.manage") + " && (@request.body.user:isset = false || @request.body.user = '')",
      updateRule: can("crew.manage") + " && " + SAME_ORG + " && @request.body.user:isset = false",
      deleteRule: can("crew.manage") + " && user = ''",
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "user", collectionId: users.id, maxSelect: 1 },
        { type: "text", name: "name", required: true, max: 120 },
        { type: "text", name: "phone", max: 40 },
        { type: "email", name: "email" },
        { type: "relation", name: "skills", collectionId: roles.id, maxSelect: 50 },
        { type: "text", name: "notes", max: 2000 },
        { type: "bool", name: "archived" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_crew_people_org ON crew_people (org, name)", "CREATE INDEX idx_crew_people_user ON crew_people (user)"],
    });
    app.save(people);

    const needs = new Collection({
      type: "base",
      name: "crew_needs",
      listRule: MEMBER,
      viewRule: MEMBER,
      createRule: can("jobs.edit") + " && " + SAME_ORG,
      updateRule: can("jobs.edit") + " && " + SAME_ORG + " && (@request.body.job:isset = false || @request.body.job = job)",
      deleteRule: can("jobs.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "job", required: true, collectionId: jobs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "period", required: true, collectionId: periods.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "role", required: true, collectionId: roles.id, maxSelect: 1 },
        { type: "number", name: "quantity", required: true, onlyInt: true, min: 1, max: 99 },
        { type: "date", name: "start", required: true },
        { type: "date", name: "end", required: true },
        { type: "bool", name: "customTimes" },
        { type: "text", name: "notes", max: 500 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_crew_needs_job ON crew_needs (job, start)",
        "CREATE INDEX idx_crew_needs_period ON crew_needs (period)",
        "CREATE INDEX idx_crew_needs_org_time ON crew_needs (org, start, end)",
      ],
    });
    app.save(needs);

    const crew = app.findCollectionByNameOrId("job_crew");
    crew.fields.add(new RelationField({ name: "person", collectionId: people.id, maxSelect: 1 }));
    crew.fields.add(new RelationField({ name: "need", collectionId: needs.id, maxSelect: 1, cascadeDelete: true }));
    crew.fields.getByName("user").required = false;
    // One per person per slot (or per project), checked by lib/crew.js.
    crew.indexes = [
      "CREATE INDEX idx_job_crew_job ON job_crew (job)",
      "CREATE INDEX idx_job_crew_user ON job_crew (user)",
      "CREATE INDEX idx_job_crew_person ON job_crew (person)",
      "CREATE INDEX idx_job_crew_need ON job_crew (need)",
    ];
    app.save(crew);

    // Each organisation's crew roles and crew list, and its crew's people.
    const userRows = arrayOf(new DynamicModel({ id: "", name: "", email: "" }));
    app.db().newQuery("SELECT id, name, email FROM users").all(userRows);
    const userById = {};
    for (const u of userRows) userById[u.id] = u;
    for (const org of app.findAllRecords("organisations")) {
      DEFAULT_ROLES.forEach((name, i) => app.save(new Record(roles, { org: org.id, name: name, sortOrder: (i + 1) * 10 })));
      const personOf = {};
      for (const m of app.findRecordsByFilter("memberships", "org = {:org}", "", 0, 0, { org: org.id })) {
        const u = userById[m.getString("user")];
        if (!u || personOf[u.id]) continue;
        const person = new Record(people, { org: org.id, user: u.id, name: u.name || u.email.split("@")[0] || "Someone" });
        app.save(person);
        personOf[u.id] = person.id;
      }
      for (const c of app.findRecordsByFilter("job_crew", "org = {:org}", "", 0, 0, { org: org.id })) {
        const person = personOf[c.getString("user")];
        if (person) {
          c.set("person", person);
          app.saveNoValidate(c);
        } else {
          // Not a member any more: nobody to roster.
          app.delete(c);
        }
      }

      // crew.manage for admins (who have everything) and planners.
      for (const role of app.findRecordsByFilter("roles", "org = {:org}", "", 0, 0, { org: org.id })) {
        const permissions = JSON.parse(role.getString("permissions") || "[]");
        const planner = role.getString("name").toLowerCase() === "planner" && permissions.indexOf("jobs.edit") !== -1;
        if ((role.getBool("locked") || planner) && permissions.indexOf("crew.manage") === -1) {
          permissions.push("crew.manage");
          role.set("permissions", permissions);
          app.saveNoValidate(role);
        }
      }
    }

    const fresh = app.findCollectionByNameOrId("job_crew");
    fresh.fields.getByName("person").required = true;
    app.save(fresh);

    // The Crew list and Rostering have saved views too.
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.getByName("page").values = ["projects", "inventory", "contacts", "locations", "crew", "rostering"];
    app.save(listViews);
  },
  (app) => {
    app.db().newQuery("DELETE FROM list_views WHERE page IN ('crew', 'rostering')").execute();
    const listViews = app.findCollectionByNameOrId("list_views");
    listViews.fields.getByName("page").values = ["projects", "inventory", "contacts", "locations"];
    app.save(listViews);
    // Back to one row per person per project, members only.
    app.db().newQuery("DELETE FROM job_crew WHERE user = '' OR user IS NULL").execute();
    app.db().newQuery("DELETE FROM job_crew WHERE rowid NOT IN (SELECT MIN(rowid) FROM job_crew GROUP BY job, user)").execute();
    const crew = app.findCollectionByNameOrId("job_crew");
    crew.fields.removeByName("person");
    crew.fields.removeByName("need");
    crew.fields.getByName("user").required = true;
    crew.indexes = ["CREATE UNIQUE INDEX idx_job_crew_job_user ON job_crew (job, user)", "CREATE INDEX idx_job_crew_user ON job_crew (user)"];
    app.save(crew);
    app.delete(app.findCollectionByNameOrId("crew_needs"));
    app.delete(app.findCollectionByNameOrId("crew_people"));
    app.delete(app.findCollectionByNameOrId("crew_roles"));
    for (const role of app.findAllRecords("roles")) {
      const permissions = JSON.parse(role.getString("permissions") || "[]");
      const i = permissions.indexOf("crew.manage");
      if (i === -1) continue;
      permissions.splice(i, 1);
      role.set("permissions", permissions);
      app.saveNoValidate(role);
    }
  },
);
