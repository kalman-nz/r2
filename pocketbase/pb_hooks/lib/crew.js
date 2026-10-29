// Crew rostering (pb_migrations/0041_crew_rostering.js): each organisation's
// crew roles, the people who can be rostered (members and freelancers),
// what each schedule item needs (crew_needs) and who fills it (job_crew).
//
// What always holds, whoever's asking:
// - a member's crew_people record follows their membership and their name
// - a need's times are its schedule item's, unless it has its own
// - someone fills a slot once, a need has no more people than it asks for,
//   and everything is in the project's organisation

const DEFAULT_ROLES = ["Audio operator", "Lighting operator", "Video operator", "Stage manager", "Rigger", "Technical labour", "Driver"];
const MAX_ROLES = 100;

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function find(app, collection, id) {
  const { findOrNull } = require("./records.js");
  return findOrNull(app, collection, id);
}

function rolesOf(app, org) {
  return app.findRecordsByFilter("crew_roles", "org = {:org}", "sortOrder,created", 0, 0, { org: org });
}

function createDefaultCrewRoles(app, org) {
  if (rolesOf(app, org).length > 0) return;
  const collection = app.findCollectionByNameOrId("crew_roles");
  DEFAULT_ROLES.forEach((name, i) => app.save(new Record(collection, { org: org, name: name, sortOrder: (i + 1) * 10 })));
}

// Settings → Crew roles: the whole list, in order ([{ id?, name }]). A role
// a schedule item needs stays until it's taken off; removing one takes it off
// people's skills.
function saveCrewRoles(app, org, list) {
  if (!Array.isArray(list)) throw new BadRequestError("Send the list of crew roles");
  if (list.length > MAX_ROLES) throw new BadRequestError("There can be up to " + MAX_ROLES + " crew roles");
  const seen = {};
  const clean = list.map((r) => {
    const name = text(r && r.name, 60);
    if (!name) throw new BadRequestError("Every crew role needs a name");
    if (seen[name.toLowerCase()]) throw new BadRequestError("There are two crew roles called " + name);
    seen[name.toLowerCase()] = true;
    return { id: r && r.id ? String(r.id) : "", name: name };
  });
  app.runInTransaction((tx) => {
    const existing = {};
    for (const r of rolesOf(tx, org)) existing[r.id] = r;
    const collection = tx.findCollectionByNameOrId("crew_roles");
    const kept = {};
    clean.forEach((r, i) => {
      let record;
      if (r.id) {
        record = existing[r.id];
        if (!record) throw new BadRequestError("One of those crew roles doesn't exist");
      } else {
        record = new Record(collection, { org: org });
      }
      record.set("name", r.name);
      record.set("sortOrder", (i + 1) * 10);
      tx.save(record);
      kept[record.id] = true;
    });
    for (const id in existing) {
      if (kept[id]) continue;
      const used = tx.findRecordsByFilter("crew_needs", "role = {:id}", "", 1, 0, { id: id });
      if (used.length > 0) throw new BadRequestError(existing[id].getString("name") + " is needed on a schedule item, so it stays. Take it off there first");
      tx.delete(existing[id]);
    }
  });
  return rolesOf(app, org);
}

// A member's crew record, made the first time it's wanted.
function ensurePerson(app, org, userId) {
  const found = app.findRecordsByFilter("crew_people", "org = {:org} && user = {:user}", "", 1, 0, { org: org, user: userId });
  if (found.length > 0) {
    if (found[0].getBool("archived")) {
      found[0].set("archived", false);
      app.save(found[0]);
    }
    return found[0];
  }
  const user = find(app, "users", userId);
  const record = new Record(app.findCollectionByNameOrId("crew_people"), { org: org, user: userId, name: user ? nameOfUser(user) : "Someone" });
  app.save(record);
  return record;
}

function nameOfUser(user) {
  return user.getString("name") || user.getString("email").split("@")[0] || "Someone";
}

// They've left: they stay on the projects they worked, but can't be
// rostered again.
function leavePerson(app, org, userId) {
  for (const p of app.findRecordsByFilter("crew_people", "org = {:org} && user = {:user}", "", 0, 0, { org: org, user: userId })) {
    p.set("archived", true);
    app.save(p);
  }
}

// Members' crew records carry their name.
function renamePeople(app, user) {
  for (const p of app.findRecordsByFilter("crew_people", "user = {:user}", "", 0, 0, { user: user.id })) {
    if (p.getString("name") === nameOfUser(user)) continue;
    p.set("name", nameOfUser(user));
    app.save(p);
  }
}

function sameOrgOf(record, target, what) {
  if (!target) throw new BadRequestError("That " + what + " doesn't exist");
  if (target.getString("org") !== record.getString("org")) throw new BadRequestError("That " + what + " belongs to another organisation");
  return target;
}

function validatePerson(app, record) {
  if (!record.getString("org")) return;
  const userId = record.getString("user");
  if (userId) {
    const user = find(app, "users", userId);
    if (user) record.set("name", nameOfUser(user));
  }
  record.set("name", text(record.getString("name"), 120));
  if (!record.getString("name")) throw new BadRequestError("Give them a name");
  record.set("phone", text(record.getString("phone"), 40));
  record.set("notes", text(record.getString("notes"), 2000));
  for (const id of record.getStringSlice("skills")) sameOrgOf(record, find(app, "crew_roles", id), "crew role");
}

// A need: one of this project's schedule items, one of the organisation's
// crew roles, and the item's times unless it has its own.
function validateNeed(app, record) {
  const { toMs } = require("./time.js");
  if (!record.getString("org")) return;
  const job = sameOrgOf(record, find(app, "jobs", record.getString("job")), "project");
  const period = find(app, "job_periods", record.getString("period"));
  if (!period || period.getString("job") !== job.id) throw new BadRequestError("That schedule item isn't on this project");
  sameOrgOf(record, find(app, "crew_roles", record.getString("role")), "crew role");
  if (!record.getBool("customTimes") || !record.getString("start") || !record.getString("end")) {
    record.set("customTimes", false);
    record.set("start", period.getString("start"));
    record.set("end", period.getString("end"));
  }
  if (!(toMs(record.getString("start")) < toMs(record.getString("end")))) throw new BadRequestError("The crew's finish has to be after their start");
  record.set("notes", text(record.getString("notes"), 500));
  if (record.id) {
    const filled = app.findRecordsByFilter("job_crew", "need = {:id}", "", 0, 0, { id: record.id }).length;
    if (filled > record.getInt("quantity")) throw new BadRequestError(filled + " people are on it already: take some off first");
  }
}

// A schedule item's moved: its crew needs move with it (the ones on its
// times).
function syncNeedTimes(app, period) {
  for (const n of app.findRecordsByFilter("crew_needs", "period = {:id} && customTimes = false", "", 0, 0, { id: period.id })) {
    if (n.getString("start") === period.getString("start") && n.getString("end") === period.getString("end")) continue;
    n.set("start", period.getString("start"));
    n.set("end", period.getString("end"));
    app.save(n);
  }
}

// Someone on a project: on one of its crew needs (a slot), or the whole
// project when need is "". Each once, and a need takes as many as it asks.
function validateCrew(app, record) {
  const { membershipOf } = require("./orgs.js");
  const org = record.getString("org");
  if (!org) return;
  const job = sameOrgOf(record, find(app, "jobs", record.getString("job")), "project");
  const person = sameOrgOf(record, find(app, "crew_people", record.getString("person")), "person");
  const userId = person.getString("user");
  if (userId && !membershipOf(app, userId, org)) throw new BadRequestError("They're not in this organisation any more");
  if (person.getBool("archived") && record.isNew()) throw new BadRequestError(person.getString("name") + " is archived: bring them back on the Crew page first");
  record.set("user", userId);
  record.set("function", text(record.getString("function"), 60));

  const needId = record.getString("need");
  let need = null;
  if (needId) {
    need = find(app, "crew_needs", needId);
    if (!need || need.getString("job") !== job.id) throw new BadRequestError("That crew need isn't on this project");
  }
  // (An empty {:need} doesn't match an empty relation, so say it outright.)
  const others = app
    .findRecordsByFilter("job_crew", needId ? "job = {:job} && need = {:need}" : "job = {:job} && need = ''", "", 0, 0, { job: job.id, need: needId })
    .filter((c) => c.id !== record.id);
  if (others.some((c) => c.getString("person") === person.id)) {
    throw new BadRequestError(person.getString("name") + (need ? " is already on that" : " is already on the project"));
  }
  if (need && others.length >= need.getInt("quantity")) {
    const role = find(app, "crew_roles", need.getString("role"));
    throw new BadRequestError("All " + need.getInt("quantity") + " " + (role ? role.getString("name") : "") + " spots are filled");
  }
}

// Someone who's been rostered stays, so the projects they worked keep them.
function guardPersonDelete(app, record) {
  const n = app.findRecordsByFilter("job_crew", "person = {:id}", "", 1, 0, { id: record.id }).length;
  if (n > 0) throw new BadRequestError(record.getString("name") + " has been on projects: archive them instead");
}

module.exports = {
  DEFAULT_ROLES,
  rolesOf,
  createDefaultCrewRoles,
  saveCrewRoles,
  ensurePerson,
  leavePerson,
  renamePeople,
  validatePerson,
  validateNeed,
  syncNeedTimes,
  validateCrew,
  guardPersonDelete,
};
