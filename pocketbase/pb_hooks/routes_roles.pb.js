/// <reference path="../pb_data/types.d.ts" />
// Settings → Roles: each organisation's own roles, made of the permissions
// in lib/permissions.js. Members can list them (the team page shows who has
// what); changing them needs roles.manage, and lib/members.js stops anyone
// giving a role more than their own has. The locked Admin role can't be
// changed or deleted.

// The permission catalogue, for the role editor.
routerAdd(
  "GET",
  "/api/permissions",
  (e) => {
    const { GROUPS, REQUIRES } = require(`${__hooks}/lib/permissions.js`);
    return e.json(200, {
      groups: GROUPS.map((g) => ({ name: g.name, permissions: g.permissions.map(([key, label]) => ({ key: key, label: label })) })),
      requires: REQUIRES,
    });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "GET",
  "/api/orgs/{id}/roles",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { listRoles } = require(`${__hooks}/lib/members.js`);
    const ctx = requireMember(e, e.request.pathValue("id"));
    return e.json(200, listRoles($app, ctx.orgId));
  },
  $apis.requireAuth("users"),
);

// body: { name, description, permissions: [...] }
routerAdd(
  "POST",
  "/api/orgs/{id}/roles",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { saveRole, roleJson } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "roles.manage");
    const role = saveRole($app, ctx.orgId, "", e.requestInfo().body || {}, ctx);
    logEvent(ctx.orgId, "role_created", whoName(e.auth), { role: role.id, name: role.getString("name") });
    return e.json(200, roleJson(role));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/orgs/{id}/roles/{role}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { saveRole, roleJson } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "roles.manage");
    const role = saveRole($app, ctx.orgId, e.request.pathValue("role"), e.requestInfo().body || {}, ctx);
    logEvent(ctx.orgId, "role_changed", whoName(e.auth), { role: role.id, name: role.getString("name") });
    return e.json(200, roleJson(role));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/orgs/{id}/roles/{role}",
  (e) => {
    const { requireMember } = require(`${__hooks}/lib/orgs.js`);
    const { deleteRole } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const ctx = requireMember(e, e.request.pathValue("id"), "roles.manage");
    const role = deleteRole($app, ctx.orgId, e.request.pathValue("role"), ctx);
    logEvent(ctx.orgId, "role_deleted", whoName(e.auth), { name: role.getString("name") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);
