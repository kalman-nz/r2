// Memberships, invitations and roles, shared by the organisation admins'
// routes (routes_orgs.pb.js, routes_roles.pb.js), people's own
// (routes_me.pb.js) and the platform admin panel (routes_admin.pb.js).
// Callers check who's allowed first; these enforce what must always hold:
// - every organisation keeps at least one member with the locked Admin role
// - nobody hands out more than they have: giving someone a role, or making
//   or changing a role, needs every permission in it (only admins can make
//   admins). `actor` is the caller's access from lib/orgs.js, or null for a
//   platform admin, who isn't limited.
// - an invitation is accepted by the person whose address it is, and only
//   once that address is verified (otherwise anyone could sign up as
//   someone else's email and take their seat)
const { findOrNull, decodeJson } = require("./records.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Local development has no mail server to verify addresses with, so
// scripts/dev-pocketbase.sh sets this to trust them. Never set it in
// production.
function emailsTrusted() {
  return $os.getenv("R2_DEV_TRUST_EMAILS") === "1";
}

function permissionsOf(role) {
  const { ALL } = require("./permissions.js");
  if (!role) return [];
  return role.getBool("locked") ? ALL.slice() : decodeJson(role.get("permissions"), []);
}

function roleJson(role, counts) {
  return {
    id: role.id,
    name: role.getString("name"),
    description: role.getString("description"),
    locked: role.getBool("locked"),
    permissions: permissionsOf(role),
    members: counts ? counts.members[role.id] || 0 : undefined,
    invitations: counts ? counts.invitations[role.id] || 0 : undefined,
  };
}

function rolesById(app, orgId) {
  const map = {};
  for (const r of app.findRecordsByFilter("roles", "org = {:org}", "sortOrder,name", 0, 0, { org: orgId })) map[r.id] = r;
  return map;
}

// One of this organisation's roles, or an error.
function requireRole(app, orgId, roleId) {
  const role = roleId ? findOrNull(app, "roles", roleId) : null;
  if (!role || role.getString("org") !== orgId) throw new BadRequestError("Choose one of this organisation's roles");
  return role;
}

function adminRoleOf(app, orgId) {
  return app.findRecordsByFilter("roles", "org = {:org} && locked = true", "", 1, 0, { org: orgId })[0] || null;
}

function adminCount(app, orgId) {
  return app.findRecordsByFilter("memberships", "org = {:org} && role.locked = true", "", 0, 0, { org: orgId }).length;
}

// The no-escalation rule (see the top of this file).
function assertMayGrant(actor, permissions, locked) {
  const { LABELS } = require("./permissions.js");
  if (!actor || actor.isAdmin) return;
  if (locked) throw new ForbiddenError("Only admins can make someone an admin");
  const missing = permissions.filter((p) => !actor.can(p));
  if (missing.length) {
    throw new ForbiddenError(
      "You can't hand out permissions your own role doesn't have: " + missing.slice(0, 3).map((p) => (LABELS[p] || p).toLowerCase()).join(", ") + (missing.length > 3 ? "…" : ""),
    );
  }
}

function memberJson(membership, user, role, includeEmail) {
  return {
    id: membership.id,
    userId: membership.getString("user"),
    name: user ? user.getString("name") : "",
    email: includeEmail && user ? user.getString("email") : "",
    verified: user ? user.getBool("verified") : false,
    roleId: membership.getString("role"),
    roleName: role ? role.getString("name") : "",
    isAdmin: !!role && role.getBool("locked"),
    created: membership.getString("created"),
  };
}

function listMembers(app, orgId, includeEmail) {
  const roles = rolesById(app, orgId);
  const memberships = app.findRecordsByFilter("memberships", "org = {:org}", "created", 0, 0, { org: orgId });
  const users = {};
  for (const u of app.findRecordsByIds("users", memberships.map((m) => m.getString("user")))) if (u) users[u.id] = u;
  return memberships
    .map((m) => memberJson(m, users[m.getString("user")], roles[m.getString("role")], includeEmail))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

function invitationJson(invitation, org, inviter, role) {
  return {
    id: invitation.id,
    orgId: invitation.getString("org"),
    orgName: org ? org.getString("name") : "",
    email: invitation.getString("email"),
    roleId: invitation.getString("role"),
    roleName: role ? role.getString("name") : "",
    status: invitation.getString("status"),
    invitedBy: inviter ? inviter.getString("name") || inviter.getString("email") : "",
    created: invitation.getString("created"),
  };
}

function pendingInvitations(app, orgId) {
  const roles = rolesById(app, orgId);
  return app
    .findRecordsByFilter("invitations", "org = {:org} && status = 'pending'", "-created", 0, 0, { org: orgId })
    .map((i) => invitationJson(i, null, findOrNull(app, "users", i.getString("invitedBy")), roles[i.getString("role")]));
}

// Invites an address (or updates the role on a pending invitation to it).
// Returns { invitation, emailed }.
function invite(app, org, email, roleId, inviter, actor) {
  const { sendInvitation } = require("./mail.js");
  const address = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(address)) throw new BadRequestError("That doesn't look like an email address");
  const role = requireRole(app, org.id, roleId);
  assertMayGrant(actor, permissionsOf(role), role.getBool("locked"));
  const existingUser = app.findRecordsByFilter("users", "email = {:email}", "", 1, 0, { email: address })[0];
  if (existingUser && app.findRecordsByFilter("memberships", "org = {:org} && user = {:user}", "", 1, 0, { org: org.id, user: existingUser.id }).length) {
    throw new BadRequestError(address + " is already a member");
  }
  let invitation = app.findRecordsByFilter("invitations", "org = {:org} && email = {:email} && status = 'pending'", "", 1, 0, {
    org: org.id,
    email: address,
  })[0];
  if (!invitation) {
    invitation = new Record(app.findCollectionByNameOrId("invitations"), { org: org.id, email: address, status: "pending" });
  }
  invitation.set("role", role.id);
  invitation.set("invitedBy", inviter ? inviter.id : "");
  app.save(invitation);
  let emailed = false;
  try {
    emailed = sendInvitation(address, org.getString("name"), inviter ? inviter.getString("name") || inviter.getString("email") : "", role.getString("name"));
  } catch (err) {
    console.warn("[invite] couldn't send email to " + address + ": " + err);
  }
  return { invitation: invitationJson(invitation, org, inviter, role), emailed: emailed };
}

function requireInvitation(app, orgId, invitationId) {
  const invitation = findOrNull(app, "invitations", invitationId);
  if (!invitation || invitation.getString("org") !== orgId) throw new NotFoundError("Invitation not found");
  return invitation;
}

function requireMembership(app, orgId, membershipId) {
  const membership = findOrNull(app, "memberships", membershipId);
  if (!membership || membership.getString("org") !== orgId) throw new NotFoundError("Member not found");
  return membership;
}

const LAST_ADMIN = "Every organisation needs an admin — make someone else admin first";

function setRole(app, orgId, membershipId, roleId, actor) {
  const role = requireRole(app, orgId, roleId);
  const membership = requireMembership(app, orgId, membershipId);
  const current = findOrNull(app, "roles", membership.getString("role"));
  const wasAdmin = !!current && current.getBool("locked");
  if (wasAdmin && actor && !actor.isAdmin) throw new ForbiddenError("Only admins can change an admin's role");
  assertMayGrant(actor, permissionsOf(role), role.getBool("locked"));
  if (wasAdmin && !role.getBool("locked") && adminCount(app, orgId) <= 1) throw new BadRequestError(LAST_ADMIN);
  membership.set("role", role.id);
  app.save(membership);
  return { membership: membership, role: role };
}

function removeMember(app, orgId, membershipId, actor) {
  const membership = requireMembership(app, orgId, membershipId);
  const current = findOrNull(app, "roles", membership.getString("role"));
  const isAdmin = !!current && current.getBool("locked");
  if (isAdmin && actor && !actor.isAdmin) throw new ForbiddenError("Only admins can remove an admin");
  if (isAdmin && adminCount(app, orgId) <= 1) throw new BadRequestError(LAST_ADMIN);
  app.delete(membership);
  return membership;
}

// The signed-in user accepting an invitation sent to their address.
function acceptInvitation(app, invitationId, user) {
  const invitation = findOrNull(app, "invitations", invitationId);
  if (!invitation || invitation.getString("email") !== user.getString("email").toLowerCase()) {
    throw new NotFoundError("Invitation not found");
  }
  if (invitation.getString("status") !== "pending") throw new BadRequestError("This invitation has already been " + invitation.getString("status"));
  if (!user.getBool("verified") && !emailsTrusted()) {
    throw new ForbiddenError("Verify your email address first — check your inbox for the link");
  }
  const org = findOrNull(app, "organisations", invitation.getString("org"));
  if (!org) throw new NotFoundError("That organisation no longer exists");
  if (org.getBool("suspended")) throw new ForbiddenError("This organisation is suspended");
  const role = findOrNull(app, "roles", invitation.getString("role"));
  app.runInTransaction((tx) => {
    const existing = tx.findRecordsByFilter("memberships", "org = {:org} && user = {:user}", "", 1, 0, { org: org.id, user: user.id })[0];
    if (!existing) {
      tx.save(new Record(tx.findCollectionByNameOrId("memberships"), { org: org.id, user: user.id, role: invitation.getString("role") }));
    }
    invitation.set("status", "accepted");
    invitation.set("acceptedBy", user.id);
    tx.save(invitation);
  });
  return { invitation: invitation, org: org, role: role };
}

// --- roles (Settings → Roles) ---

function listRoles(app, orgId) {
  const count = (collection, extra) => {
    const map = {};
    for (const r of app.findRecordsByFilter(collection, "org = {:org}" + extra, "", 0, 0, { org: orgId })) {
      map[r.getString("role")] = (map[r.getString("role")] || 0) + 1;
    }
    return map;
  };
  const counts = { members: count("memberships", ""), invitations: count("invitations", " && status = 'pending'") };
  return Object.values(rolesById(app, orgId)).map((r) => roleJson(r, counts));
}

// Creates (roleId empty) or updates a role. data: { name, description, permissions }.
function saveRole(app, orgId, roleId, data, actor) {
  const { normalise } = require("./permissions.js");
  const permissions = normalise(data.permissions);
  let role;
  if (roleId) {
    role = requireRole(app, orgId, roleId);
    if (role.getBool("locked")) throw new BadRequestError("The Admin role always has every permission, so it can't be changed");
    // Changing a role at all — even taking permissions away — needs
    // everything it gives now, as well as everything it will.
    assertMayGrant(actor, permissionsOf(role), false);
  } else {
    const last = app.findRecordsByFilter("roles", "org = {:org}", "-sortOrder", 1, 0, { org: orgId })[0];
    role = new Record(app.findCollectionByNameOrId("roles"), { org: orgId, locked: false, sortOrder: (last ? last.getInt("sortOrder") : 0) + 10 });
  }
  assertMayGrant(actor, permissions, false);
  if (data.name !== undefined) role.set("name", String(data.name || ""));
  if (data.description !== undefined) role.set("description", String(data.description || "").trim());
  role.set("permissions", permissions);
  const clash = app.findRecordsByFilter("roles", "org = {:org} && name:lower = {:name} && id != {:id}", "", 1, 0, {
    org: orgId,
    name: role.getString("name").trim().toLowerCase(),
    id: role.id || "",
  })[0];
  if (clash) throw new BadRequestError("There's already a role called " + clash.getString("name"));
  app.save(role);
  return role;
}

function deleteRole(app, orgId, roleId, actor) {
  const role = requireRole(app, orgId, roleId);
  if (role.getBool("locked")) throw new BadRequestError("The Admin role can't be deleted");
  assertMayGrant(actor, permissionsOf(role), false);
  const members = app.findRecordsByFilter("memberships", "role = {:role}", "", 0, 0, { role: role.id }).length;
  const invites = app.findRecordsByFilter("invitations", "role = {:role} && status = 'pending'", "", 0, 0, { role: role.id }).length;
  if (members || invites) {
    const parts = [];
    if (members) parts.push(members + (members === 1 ? " person has" : " people have"));
    if (invites) parts.push(invites + (invites === 1 ? " invitation is" : " invitations are") + " waiting with");
    throw new BadRequestError(parts.join(" and ") + " this role — give them another one first");
  }
  // Old, answered invitations still point at it; they don't need it.
  app.db().newQuery("DELETE FROM invitations WHERE role = {:role} AND status != 'pending'").bind({ role: role.id }).execute();
  app.delete(role);
  return role;
}

module.exports = {
  emailsTrusted,
  permissionsOf,
  roleJson,
  rolesById,
  requireRole,
  adminRoleOf,
  adminCount,
  listMembers,
  invitationJson,
  pendingInvitations,
  invite,
  requireInvitation,
  setRole,
  removeMember,
  acceptInvitation,
  listRoles,
  saveRole,
  deleteRole,
};
