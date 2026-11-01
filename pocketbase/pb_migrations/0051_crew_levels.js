/// <reference path="../pb_data/types.d.ts" />

// Crew skills can have levels (Settings → Crew roles): Driver 1F, 2F, 4F;
// Audio operator Basic, Advanced.
//   crew_roles.levels        the role's levels, lowest first
//   crew_people.skillLevels  { roleId: level } for the roles they do
//   crew_needs.level         the lowest level a slot takes ("" for any)
// Rostering suggests people at the level or above who are free then.

migrate(
  (app) => {
    const roles = app.findCollectionByNameOrId("crew_roles");
    roles.fields.add(new JSONField({ name: "levels", maxSize: 4000 }));
    app.save(roles);
    const people = app.findCollectionByNameOrId("crew_people");
    people.fields.add(new JSONField({ name: "skillLevels", maxSize: 20000 }));
    app.save(people);
    const needs = app.findCollectionByNameOrId("crew_needs");
    needs.fields.add(new TextField({ name: "level", max: 60 }));
    app.save(needs);
  },
  (app) => {
    const roles = app.findCollectionByNameOrId("crew_roles");
    roles.fields.removeByName("levels");
    app.save(roles);
    const people = app.findCollectionByNameOrId("crew_people");
    people.fields.removeByName("skillLevels");
    app.save(people);
    const needs = app.findCollectionByNameOrId("crew_needs");
    needs.fields.removeByName("level");
    app.save(needs);
  },
);
