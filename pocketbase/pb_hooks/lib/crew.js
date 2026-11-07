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
// A role's levels (migration 0051): Driver 1F, 2F, 4F, lowest first.
const MAX_LEVELS = 10;

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function find(app, collection, id) {
  const { findOrNull } = require("./records.js");
  return findOrNull(app, collection, id);
}

// A role's levels, lowest first ([] for none).
function levelsOf(role) {
  const { decodeJson } = require("./records.js");
  const list = role ? decodeJson(role.get("levels"), []) : [];
  return Array.isArray(list) ? list.filter((l) => typeof l === "string" && l) : [];
}

function cleanLevels(raw, roleName) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestError(roleName + "'s levels need to be a list");
  const seen = {};
  const out = [];
  for (const l of raw) {
    const level = text(l, 30);
    if (!level || seen[level.toLowerCase()]) continue;
    seen[level.toLowerCase()] = true;
    out.push(level);
  }
  if (out.length > MAX_LEVELS) throw new BadRequestError(roleName + " can have up to " + MAX_LEVELS + " levels");
  return out;
}

function rolesOf(app, org) {
  return app.findRecordsByFilter("crew_roles", "org = {:org}", "sortOrder,created", 0, 0, { org: org });
}

function createDefaultCrewRoles(app, org) {
  if (rolesOf(app, org).length > 0) return;
  const collection = app.findCollectionByNameOrId("crew_roles");
  DEFAULT_ROLES.forEach((name, i) => app.save(new Record(collection, { org: org, name: name, sortOrder: (i + 1) * 10 })));
}

// Settings → Crew roles: the whole list, in order ([{ id?, name, levels? }]).
// A role a schedule item needs stays until it's taken off; removing one
// takes it off people's skills.
function saveCrewRoles(app, org, list) {
  if (!Array.isArray(list)) throw new BadRequestError("Send the list of crew roles");
  if (list.length > MAX_ROLES) throw new BadRequestError("There can be up to " + MAX_ROLES + " crew roles");
  const seen = {};
  const clean = list.map((r) => {
    const name = text(r && r.name, 60);
    if (!name) throw new BadRequestError("Every crew role needs a name");
    if (seen[name.toLowerCase()]) throw new BadRequestError("There are two crew roles called " + name);
    seen[name.toLowerCase()] = true;
    return { id: r && r.id ? String(r.id) : "", name: name, levels: cleanLevels(r && r.levels, name) };
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
      record.set("levels", r.levels);
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
  // Their level at each role they do, one of the role's own. Only a level
  // being changed is checked: one a role's since renamed stays as it was
  // until someone picks another (so renaming them, say, still saves).
  const { decodeJson } = require("./records.js");
  const given = decodeJson(record.get("skillLevels"), {});
  const before = record.isNew() ? {} : decodeJson(record.original().get("skillLevels"), {});
  const levels = {};
  for (const id of record.getStringSlice("skills")) {
    const role = sameOrgOf(record, find(app, "crew_roles", id), "crew role");
    const level = given && typeof given === "object" ? text(given[id], 30) : "";
    if (!level) continue;
    const unchanged = before && typeof before === "object" && before[id] === level;
    if (!unchanged && levelsOf(role).indexOf(level) === -1) throw new BadRequestError(level + " isn't one of " + role.getString("name") + "'s levels");
    levels[id] = level;
  }
  record.set("skillLevels", levels);
}

// A need: one of this project's schedule items, one of the organisation's
// crew roles, and the item's times unless it has its own.
function validateNeed(app, record) {
  const { toMs } = require("./time.js");
  if (!record.getString("org")) return;
  const job = sameOrgOf(record, find(app, "jobs", record.getString("job")), "project");
  const period = find(app, "job_periods", record.getString("period"));
  if (!period || period.getString("job") !== job.id) throw new BadRequestError("That schedule item isn't on this project");
  const role = sameOrgOf(record, find(app, "crew_roles", record.getString("role")), "crew role");
  // The lowest level it takes: one of the role's, or "" for any.
  const level = text(record.getString("level"), 30);
  const unchanged = !record.isNew() && level === record.original().getString("level") && role.id === record.original().getString("role");
  if (level && !unchanged && levelsOf(role).indexOf(level) === -1) throw new BadRequestError(level + " isn't one of " + role.getString("name") + "'s levels");
  record.set("level", level);
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
  if (!record.isNew() && !needMatches(record.original(), record)) {
    const matches = app
      .findRecordsByFilter("crew_needs", "job = {:job}", "", 0, 0, { job: record.getString("job") })
      .some((need) => need.id !== record.id && needMatches(need, record));
    if (matches) throw new BadRequestError("That change would create a matching crew need; edit the existing need instead");
  }
}

function needMatches(a, b) {
  const { toMs } = require("./time.js");
  return (
    a.getString("job") === b.getString("job") &&
    a.getString("period") === b.getString("period") &&
    a.getString("role") === b.getString("role") &&
    a.getString("level") === b.getString("level") &&
    toMs(a.getString("start")) === toMs(b.getString("start")) &&
    toMs(a.getString("end")) === toMs(b.getString("end"))
  );
}

function needNotes(needs, addition) {
  const notes = [];
  const seen = new Set();
  const append = (value) => {
    for (const note of value.split("\n")) {
      const trimmed = note.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        notes.push(trimmed);
      }
    }
  };
  for (const need of needs) {
    append(need.getString("notes"));
  }
  append(addition);
  const combined = notes.join("\n");
  if (combined.length > 500) throw new BadRequestError("Combined crew notes cannot exceed 500 characters");
  return combined;
}

function oldestFirst(a, b) {
  return a.getString("created").localeCompare(b.getString("created")) || a.id.localeCompare(b.id);
}

function addCrewNeeds(app, orgId, jobId, drafts) {
  if (!Array.isArray(drafts) || drafts.length === 0) throw new BadRequestError("Add at least one crew need");
  const ids = [];
  app.runInTransaction((tx) => {
    for (const draft of drafts) {
      if (!draft || typeof draft !== "object") throw new BadRequestError("Each crew need must be an object");
      const quantity = draft && draft.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw new BadRequestError("Crew quantity must be from 1 to 99");
      }
      if (draft.notes !== undefined && draft.notes !== null && typeof draft.notes !== "string") {
        throw new BadRequestError("Crew notes must be text");
      }
      const note = typeof draft.notes === "string" ? draft.notes.trim() : "";
      const candidate = new Record(tx.findCollectionByNameOrId("crew_needs"), {
        org: orgId,
        job: jobId,
        period: draft.period,
        role: draft.role,
        level: draft.level || "",
        quantity: quantity,
        customTimes: draft.customTimes === true,
        start: draft.customTimes === true ? draft.start : "",
        end: draft.customTimes === true ? draft.end : "",
        notes: note,
      });
      validateNeed(tx, candidate);

      const matches = tx
        .findRecordsByFilter("crew_needs", "job = {:job}", "created", 0, 0, { job: jobId })
        .filter((need) => needMatches(need, candidate))
        .sort(oldestFirst);
      const combinedQuantity = quantity + matches.reduce((total, need) => total + need.getInt("quantity"), 0);
      if (combinedQuantity > 99) throw new BadRequestError("Combined crew quantity cannot exceed 99");
      const notes = needNotes(matches, note);

      let survivor = matches[0] || candidate;
      survivor.set("quantity", combinedQuantity);
      survivor.set("notes", notes);
      tx.save(survivor);

      if (matches.length > 0) {
        const matchingIds = new Set(matches.map((need) => need.id));
        const assigned = tx
          .findRecordsByFilter("job_crew", "job = {:job}", "created", 0, 0, { job: jobId })
          .filter((crew) => matchingIds.has(crew.getString("need")))
          .sort(oldestFirst);
        const people = new Set();
        for (const crew of assigned) {
          if (people.has(crew.getString("person"))) {
            tx.delete(crew);
            continue;
          }
          people.add(crew.getString("person"));
          if (crew.getString("need") !== survivor.id) {
            crew.set("need", survivor.id);
            tx.saveNoValidate(crew);
          }
        }
        for (const need of matches) {
          if (need.id !== survivor.id) tx.delete(need);
        }
      }
      ids.push(survivor.id);
    }
  });
  return [...new Set(ids)].map((id) => app.findRecordById("crew_needs", id));
}

// A schedule item's moved: its crew needs move with it (the ones on its
// times).
function syncNeedTimes(app, period) {
  for (const n of app.findRecordsByFilter("crew_needs", "period = {:id} && customTimes = false", "", 0, 0, { id: period.id })) {
    if (n.getString("start") === period.getString("start") && n.getString("end") === period.getString("end")) continue;
    n.set("start", period.getString("start"));
    n.set("end", period.getString("end"));
    app.saveNoValidate(n);
  }
}

// Someone fills one of this project's crew needs once, up to its headcount.
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
  if (!needId) throw new BadRequestError("Choose a crew need for this assignment");
  const need = find(app, "crew_needs", needId);
  if (!need || need.getString("job") !== job.id) throw new BadRequestError("That crew need isn't on this project");
  const others = app
    .findRecordsByFilter("job_crew", "job = {:job} && need = {:need}", "", 0, 0, { job: job.id, need: needId })
    .filter((c) => c.id !== record.id);
  if (others.some((c) => c.getString("person") === person.id)) {
    throw new BadRequestError(person.getString("name") + " is already on that");
  }
  if (others.length >= need.getInt("quantity")) {
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
  levelsOf,
  rolesOf,
  createDefaultCrewRoles,
  saveCrewRoles,
  ensurePerson,
  leavePerson,
  renamePeople,
  validatePerson,
  validateNeed,
  addCrewNeeds,
  syncNeedTimes,
  validateCrew,
  guardPersonDelete,
};
