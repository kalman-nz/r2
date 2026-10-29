/// <reference path="../pb_data/types.d.ts" />
// An organisation's own team management: who's in it, their roles, and
// invitations. (Platform admins do the same for any organisation from
// routes_admin.pb.js; roles themselves are in routes_roles.pb.js.) Members
// can see the team list; email addresses and invitations need team.manage.
// lib/members.js stops anyone handing out more than their own role has.

routerAdd(
  "GET",
  "/api/orgs/{id}/members",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { listMembers } = require(`${__hooks}/lib/members.js`);
    const ctx = requireMember(e, e.request.pathValue("id"));
    return e.json(200, listMembers($app, ctx.orgId, ctx.can("team.manage")));
  },
  $apis.requireAuth("users"),
);

// body: { roleId }
routerAdd(
  "PATCH",
  "/api/orgs/{id}/members/{member}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { setRole } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "team.manage");
    const result = setRole($app, ctx.orgId, e.request.pathValue("member"), (e.requestInfo().body || {}).roleId, ctx);
    logEvent(ctx.orgId, "member_role", whoName(e.auth), { member: result.membership.getString("user"), role: result.role.getString("name") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/orgs/{id}/members/{member}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { removeMember } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "team.manage");
    const membership = removeMember($app, ctx.orgId, e.request.pathValue("member"), ctx);
    logEvent(ctx.orgId, "member_removed", whoName(e.auth), { member: membership.getString("user") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/orgs/{id}/invitations",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { pendingInvitations } = require(`${__hooks}/lib/members.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "team.manage");
    return e.json(200, pendingInvitations($app, ctx.orgId));
  },
  $apis.requireAuth("users"),
);

// body: { email, roleId }. Says whether an email went out (it needs SMTP).
routerAdd(
  "POST",
  "/api/orgs/{id}/invitations",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { invite } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "team.manage");
    const body = e.requestInfo().body || {};
    const result = invite($app, ctx.org, body.email, body.roleId, e.auth, ctx);
    logEvent(ctx.orgId, "member_invited", whoName(e.auth), { email: result.invitation.email, role: result.invitation.roleName });
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/orgs/{id}/invitations/{invitation}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { requireInvitation } = require(`${__hooks}/lib/members.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "team.manage");
    const invitation = requireInvitation($app, ctx.orgId, e.request.pathValue("invitation"));
    invitation.set("status", "revoked");
    $app.save(invitation);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// Renaming the organisation (what people see in the organisation switcher).
routerAdd(
  "PATCH",
  "/api/orgs/{id}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "settings.edit");
    const name = String((e.requestInfo().body || {}).name || "").trim();
    if (!name) throw new BadRequestError("The organisation needs a name");
    ctx.org.set("name", name);
    $app.save(ctx.org);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// An organisation's features are the platform admin's to set (what it's
// paying for): PATCH /api/admin/orgs/{id}/features in routes_admin.pb.js.
