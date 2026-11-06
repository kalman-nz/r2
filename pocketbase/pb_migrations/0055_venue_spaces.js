/// <reference path="../pb_data/types.d.ts" />

// Spaces inside a location: Baycourt Theatre's Addison Theatre, X Space and
// Terrace Room. A space belongs to one location and is managed on its page.
//
//   jobs.spaces         the spaces a project uses, all at its location;
//                       none means the whole location
//   job_periods.space   where a schedule item happens, at the project's
//                       location
//
// Deleting a space takes it off the projects and schedule items that had it.

const MEMBER = "(@request.auth.memberships_via_user.org ?= org && org.suspended = false)";
const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;
const SAME_ORG = "(@request.body.org:isset = false || @request.body.org = org)";

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const venues = app.findCollectionByNameOrId("venues");
    const spaces = new Collection({
      type: "base",
      name: "venue_spaces",
      listRule: MEMBER,
      viewRule: MEMBER,
      createRule: can("venues.edit"),
      updateRule: can("venues.edit") + " && " + SAME_ORG + " && (@request.body.venue:isset = false || @request.body.venue = venue)",
      deleteRule: can("venues.edit"),
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "venue", required: true, collectionId: venues.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 200 },
        { type: "text", name: "notes", max: 2000 },
        { type: "number", name: "sortOrder", onlyInt: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_venue_spaces_venue ON venue_spaces (venue, sortOrder)",
        "CREATE UNIQUE INDEX idx_venue_spaces_name ON venue_spaces (venue, name COLLATE NOCASE)",
      ],
    });
    app.save(spaces);

    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.add(new RelationField({ name: "spaces", collectionId: spaces.id, maxSelect: 50 }));
    app.save(jobs);

    const periods = app.findCollectionByNameOrId("job_periods");
    periods.fields.add(new RelationField({ name: "space", collectionId: spaces.id, maxSelect: 1 }));
    app.save(periods);
  },
  (app) => {
    const periods = app.findCollectionByNameOrId("job_periods");
    periods.fields.removeByName("space");
    app.save(periods);
    const jobs = app.findCollectionByNameOrId("jobs");
    jobs.fields.removeByName("spaces");
    app.save(jobs);
    app.delete(app.findCollectionByNameOrId("venue_spaces"));
  },
);
