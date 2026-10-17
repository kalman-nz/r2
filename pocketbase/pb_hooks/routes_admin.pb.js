/// <reference path="../pb_data/types.d.ts" />
// The platform admin panel (web/src/pages/admin): R2's own operators
// managing every organisation and every account. Platform admins don't see
// organisations' business data from here, only who's in what.
//
// requirePlatformAdmin is wrapped in an IIFE purely to avoid colliding with
// other routes_*.pb.js files' consts — see routes_labels.pb.js.
(function () {
const { requirePlatformAdmin } = require(`${__hooks}/lib/auth.js`);

routerAdd(
  "GET",
  "/api/admin/orgs",
  (e) => {
    const counts = (table, where) => {
      const rows = arrayOf(new DynamicModel({ org: "", n: 0 }));
      $app.db().newQuery("SELECT org, COUNT(*) AS n FROM " + table + (where ? " WHERE " + where : "") + " GROUP BY org").all(rows);
      const map = {};
      for (const r of rows) map[r.org] = r.n;
      return map;
    };
    const members = counts("memberships");
    const admins = counts("memberships", "role IN (SELECT id FROM roles WHERE locked = TRUE)");
    const invites = counts("invitations", "status = 'pending'");
    const items = counts("items");
    const jobs = counts("jobs");
    const orgs = $app.findRecordsByFilter("organisations", "", "name", 0, 0).map((o) => ({
      id: o.id,
      name: o.getString("name"),
      suspended: o.getBool("suspended"),
      created: o.getString("created"),
      members: members[o.id] || 0,
      admins: admins[o.id] || 0,
      pendingInvitations: invites[o.id] || 0,
      items: items[o.id] || 0,
      jobs: jobs[o.id] || 0,
    }));
    return e.json(200, orgs);
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

// body: { name, adminEmail? } — creates the organisation and, if given,
// invites its first admin.
routerAdd(
  "POST",
  "/api/admin/orgs",
  (e) => {
    const { invite } = require(`${__hooks}/lib/members.js`);
    const { createDefaultRoles } = require(`${__hooks}/lib/permissions.js`);
    const { setSetting } = require(`${__hooks}/lib/settings.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const body = e.requestInfo().body || {};
    const name = String(body.name || "").trim();
    if (!name) throw new BadRequestError("The organisation needs a name");
    const org = new Record($app.findCollectionByNameOrId("organisations"), { name: name, suspended: false, features: {}, createdBy: e.auth.id });
    $app.save(org);
    const roles = createDefaultRoles($app, org.id);
    setSetting(org.id, "businessName", name);
    logEvent("", "org_created", whoName(e.auth), { org: org.id, name: name });
    let result = { invitation: null, emailed: false };
    if (String(body.adminEmail || "").trim()) result = invite($app, org, body.adminEmail, roles.Admin.id, e.auth, null);
    return e.json(200, { id: org.id, name: name, invitation: result.invitation, emailed: result.emailed });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "GET",
  "/api/admin/orgs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { listMembers, pendingInvitations, listRoles } = require(`${__hooks}/lib/members.js`);
    const org = findOrNull($app, "organisations", e.request.pathValue("id"));
    if (!org) throw new NotFoundError("Organisation not found");
    return e.json(200, {
      id: org.id,
      name: org.getString("name"),
      suspended: org.getBool("suspended"),
      created: org.getString("created"),
      members: listMembers($app, org.id, true),
      invitations: pendingInvitations($app, org.id),
      roles: listRoles($app, org.id),
    });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

// body: { name?, suspended? }. Suspending locks every member out until
// it's lifted; nothing is deleted.
routerAdd(
  "PATCH",
  "/api/admin/orgs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const org = findOrNull($app, "organisations", e.request.pathValue("id"));
    if (!org) throw new NotFoundError("Organisation not found");
    const body = e.requestInfo().body || {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestError("The organisation needs a name");
      org.set("name", name);
    }
    if (body.suspended !== undefined) {
      org.set("suspended", body.suspended === true);
      logEvent("", body.suspended === true ? "org_suspended" : "org_unsuspended", whoName(e.auth), { org: org.id, name: org.getString("name") });
    }
    $app.save(org);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

// Deletes the organisation and everything in it, for good. body: { confirm }
// must be the organisation's exact name.
routerAdd(
  "DELETE",
  "/api/admin/orgs/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const org = findOrNull($app, "organisations", e.request.pathValue("id"));
    if (!org) throw new NotFoundError("Organisation not found");
    if ((e.requestInfo().body || {}).confirm !== org.getString("name")) {
      throw new BadRequestError("Type the organisation's name exactly to confirm");
    }
    $app.runInTransaction((tx) => {
      // Children before parents, so no required reference is left dangling.
      for (const table of [
        "scans",
        "quotes",
        "job_lines",
        "jobs",
        "serials",
        "item_components",
        "custom_fields",
        "import_runs",
        "settings",
        "label_templates",
        "equipment_views",
        "logs",
        "invitations",
        "memberships",
        "roles",
        "contacts",
        "venues",
        "locations",
        "categories",
      ]) {
        tx.db().newQuery("DELETE FROM " + table + " WHERE org = {:org}").bind({ org: org.id }).execute();
      }
      // Items one by one so their photos are deleted from storage too.
      for (const item of tx.findRecordsByFilter("items", "org = {:org}", "", 0, 0, { org: org.id })) tx.delete(item);
      tx.delete(org);
    });
    logEvent("", "org_deleted", whoName(e.auth), { org: org.id, name: org.getString("name") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "POST",
  "/api/admin/orgs/{id}/invitations",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { invite } = require(`${__hooks}/lib/members.js`);
    const org = findOrNull($app, "organisations", e.request.pathValue("id"));
    if (!org) throw new NotFoundError("Organisation not found");
    const body = e.requestInfo().body || {};
    return e.json(200, invite($app, org, body.email, body.roleId, e.auth, null));
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "DELETE",
  "/api/admin/orgs/{id}/invitations/{invitation}",
  (e) => {
    const { requireInvitation } = require(`${__hooks}/lib/members.js`);
    const invitation = requireInvitation($app, e.request.pathValue("id"), e.request.pathValue("invitation"));
    invitation.set("status", "revoked");
    $app.save(invitation);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "PATCH",
  "/api/admin/orgs/{id}/members/{member}",
  (e) => {
    const { setRole } = require(`${__hooks}/lib/members.js`);
    setRole($app, e.request.pathValue("id"), e.request.pathValue("member"), (e.requestInfo().body || {}).roleId, null);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "DELETE",
  "/api/admin/orgs/{id}/members/{member}",
  (e) => {
    const { removeMember } = require(`${__hooks}/lib/members.js`);
    removeMember($app, e.request.pathValue("id"), e.request.pathValue("member"), null);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

// Every account, with the organisations each belongs to.
routerAdd(
  "GET",
  "/api/admin/users",
  (e) => {
    const users = $app.findRecordsByFilter("users", "", "email", 0, 0);
    const orgNames = {};
    for (const o of $app.findRecordsByFilter("organisations", "", "", 0, 0)) orgNames[o.id] = o.getString("name");
    const roleNames = {};
    for (const r of $app.findRecordsByFilter("roles", "", "", 0, 0)) roleNames[r.id] = r.getString("name");
    const byUser = {};
    for (const m of $app.findRecordsByFilter("memberships", "", "", 0, 0)) {
      (byUser[m.getString("user")] = byUser[m.getString("user")] || []).push({
        orgId: m.getString("org"),
        orgName: orgNames[m.getString("org")] || "",
        roleName: roleNames[m.getString("role")] || "",
      });
    }
    return e.json(
      200,
      users.map((u) => ({
        id: u.id,
        name: u.getString("name"),
        email: u.getString("email"),
        verified: u.getBool("verified"),
        isPlatformAdmin: u.getBool("isPlatformAdmin"),
        created: u.getString("created"),
        memberships: byUser[u.id] || [],
      })),
    );
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

// body: { name?, verified?, isPlatformAdmin? }. Marking an address verified
// by hand is for when someone can't get the verification email.
routerAdd(
  "PATCH",
  "/api/admin/users/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const user = findOrNull($app, "users", e.request.pathValue("id"));
    if (!user) throw new NotFoundError("User not found");
    const body = e.requestInfo().body || {};
    if (typeof body.name === "string") user.set("name", body.name.trim());
    if (typeof body.verified === "boolean") user.set("verified", body.verified);
    if (typeof body.isPlatformAdmin === "boolean") {
      if (!body.isPlatformAdmin && user.id === e.auth.id) throw new BadRequestError("You can't remove your own platform admin access");
      user.set("isPlatformAdmin", body.isPlatformAdmin);
      logEvent("", "platform_admin_" + (body.isPlatformAdmin ? "granted" : "revoked"), whoName(e.auth), { user: user.id, email: user.getString("email") });
    }
    $app.save(user);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);

routerAdd(
  "DELETE",
  "/api/admin/users/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { adminCount } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const user = findOrNull($app, "users", e.request.pathValue("id"));
    if (!user) throw new NotFoundError("User not found");
    if (user.id === e.auth.id) throw new BadRequestError("You can't delete your own account here");
    for (const m of $app.findRecordsByFilter("memberships", "user = {:user} && role.locked = true", "", 0, 0, { user: user.id })) {
      if (adminCount($app, m.getString("org")) <= 1) {
        const org = findOrNull($app, "organisations", m.getString("org"));
        throw new BadRequestError("They're the only admin of " + (org ? org.getString("name") : "an organisation") + " — make someone else admin first");
      }
    }
    $app.delete(user);
    logEvent("", "user_deleted", whoName(e.auth), { user: user.id, email: user.getString("email") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
  requirePlatformAdmin,
);
})();
