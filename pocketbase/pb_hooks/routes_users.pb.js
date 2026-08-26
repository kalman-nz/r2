/// <reference path="../pb_data/types.d.ts" />
// requireAdmin is wrapped in an IIFE purely to avoid colliding with the same
// const name declared in other routes_*.pb.js files — see routes_labels.pb.js.
(function () {
const { requireAdmin } = require(`${__hooks}/lib/auth.js`);

// All admin-only — see pb_migrations/0011_admin_manages_users.js for the
// PocketBase-side rules this relies on (an app-admin's own token can
// create/edit/delete other users' accounts, not just their own).
routerAdd(
  "GET",
  "/api/users",
  (e) => {
    const { toUserJson } = require(`${__hooks}/lib/users.js`);
    const records = $app.findAllRecords("users");
    records.sort((a, b) => String(a.get("name")).localeCompare(String(b.get("name"))));
    return e.json(200, records.map(toUserJson));
  },
  $apis.requireAuth(),
  requireAdmin,
);

routerAdd(
  "POST",
  "/api/users",
  (e) => {
    const { toUserJson, validateCreateBody } = require(`${__hooks}/lib/users.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const data = validateCreateBody(e.requestInfo().body);
    const collection = $app.findCollectionByNameOrId("users");
    const record = new Record(collection, {
      name: data.name,
      email: data.email,
      isAdmin: data.isAdmin,
      // Otherwise blank for everyone but the account itself.
      emailVisibility: true,
    });
    record.set("password", data.password);
    record.set("passwordConfirm", data.password);
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("user_created", who, { id: record.id, name: record.get("name"), email: record.get("email") });
    return e.json(200, toUserJson(record));
  },
  $apis.requireAuth(),
  requireAdmin,
);

routerAdd(
  "PUT",
  "/api/users/{id}",
  (e) => {
    const { toUserJson, validateUpdateBody } = require(`${__hooks}/lib/users.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const data = validateUpdateBody(e.requestInfo().body);
    let record;
    try {
      record = $app.findRecordById("users", e.request.pathValue("id"));
    } catch (err) {
      throw new NotFoundError("User not found");
    }
    if (data.name !== undefined) record.set("name", data.name);
    if (data.email !== undefined) record.set("email", data.email);
    if (data.isAdmin !== undefined) record.set("isAdmin", data.isAdmin);
    if (data.password !== undefined) {
      record.set("password", data.password);
      record.set("passwordConfirm", data.password);
    }
    $app.save(record);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("user_updated", who, { id: record.id, name: record.get("name") });
    return e.json(200, toUserJson(record));
  },
  $apis.requireAuth(),
  requireAdmin,
);

// Accurate per-user counts via findRecordsByFilter's totalItems-equivalent
// (length of an unlimited filtered fetch) rather than filtering the capped
// /api/activity feed client-side, which undercounts anyone whose activity
// wasn't in the 200 most-recent rows.
routerAdd(
  "GET",
  "/api/users/{id}/activity",
  (e) => {
    const { summarizeLogs } = require(`${__hooks}/lib/logSummary.js`);
    const id = e.request.pathValue("id");
    let user;
    try {
      user = $app.findRecordById("users", id);
    } catch (err) {
      throw new NotFoundError("User not found");
    }
    const who = user.get("name") || user.get("email");

    const countFor = (type) =>
      $app.findRecordsByFilter("logs", "who = {:who} && type = {:type}", "", 0, 0, { who: who, type: type }).length;

    const recentRecords = $app.findRecordsByFilter("logs", "who = {:who}", "-createdAt", 100, 0, { who: who });
    const recentRows = recentRecords.map((r) => ({
      id: r.id,
      type: r.get("type"),
      who: r.get("who"),
      createdAt: r.get("createdAt"),
      details: r.get("details"),
    }));

    return e.json(200, {
      stats: { prints: countFor("print"), logins: countFor("login"), pageViews: countFor("page_view") },
      recent: summarizeLogs(recentRows),
    });
  },
  $apis.requireAuth(),
  requireAdmin,
);

routerAdd(
  "DELETE",
  "/api/users/{id}",
  (e) => {
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const id = e.request.pathValue("id");
    if (id === e.auth.id) throw new BadRequestError("Can't delete your own account");
    let existing = null;
    try {
      existing = $app.findRecordById("users", id);
    } catch (err) {
      existing = null;
    }
    if (existing) $app.delete(existing);
    const who = e.auth.get("name") || e.auth.get("email");
    logEvent("user_deleted", who, { id: id, name: existing ? existing.get("name") : id });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth(),
  requireAdmin,
);
})();
