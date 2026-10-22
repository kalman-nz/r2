/// <reference path="../pb_data/types.d.ts" />
// The signed-in person's own view: which organisations they're in, which
// they've been invited to, and accepting/declining/leaving. Invitations are
// matched on the account's email address (see lib/members.js for why it
// has to be verified to accept).

routerAdd(
  "GET",
  "/api/me",
  (e) => {
    const { invitationJson, emailsTrusted, permissionsOf } = require(`${__hooks}/lib/members.js`);
    const { featuresOf, blockingFeature } = require(`${__hooks}/lib/features.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const user = e.auth;
    const memberships = $app.findRecordsByFilter("memberships", "user = {:user}", "", 0, 0, { user: user.id });
    const orgs = {};
    for (const o of $app.findRecordsByIds("organisations", memberships.map((m) => m.getString("org")))) if (o) orgs[o.id] = o;
    const invitations = $app
      .findRecordsByFilter("invitations", "email = {:email} && status = 'pending'", "-created", 0, 0, {
        email: user.getString("email").toLowerCase(),
      })
      .map((i) => {
        const org = findOrNull($app, "organisations", i.getString("org"));
        if (!org || org.getBool("suspended")) return null;
        return invitationJson(i, org, findOrNull($app, "users", i.getString("invitedBy")), findOrNull($app, "roles", i.getString("role")));
      })
      .filter(Boolean);
    return e.json(200, {
      user: {
        id: user.id,
        name: user.getString("name"),
        email: user.getString("email"),
        verified: user.getBool("verified"),
        isPlatformAdmin: user.getBool("isPlatformAdmin"),
      },
      memberships: memberships
        .filter((m) => orgs[m.getString("org")])
        .map((m) => {
          const org = orgs[m.getString("org")];
          const role = findOrNull($app, "roles", m.getString("role"));
          const features = featuresOf(org);
          return {
            org: { id: org.id, name: org.getString("name"), suspended: org.getBool("suspended"), features: features },
            role: { id: role ? role.id : "", name: role ? role.getString("name") : "", locked: !!role && role.getBool("locked") },
            // What the app shows and hides (less whatever the organisation
            // has turned off); the server checks again anyway.
            permissions: permissionsOf(role).filter((p) => !blockingFeature(features, p)),
          };
        })
        .sort((a, b) => a.org.name.localeCompare(b.org.name)),
      invitations: invitations,
      // Whether accepting an invitation needs a verified address here.
      verificationRequired: !emailsTrusted(),
    });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/invitations/{id}/accept",
  (e) => {
    const { acceptInvitation } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const result = acceptInvitation($app, e.request.pathValue("id"), e.auth);
    logEvent(result.org.id, "invite_accepted", whoName(e.auth), { email: e.auth.getString("email"), role: result.role ? result.role.getString("name") : "" });
    return e.json(200, { ok: true, orgId: result.org.id });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "POST",
  "/api/invitations/{id}/decline",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const invitation = findOrNull($app, "invitations", e.request.pathValue("id"));
    if (!invitation || invitation.getString("email") !== e.auth.getString("email").toLowerCase()) throw new NotFoundError("Invitation not found");
    if (invitation.getString("status") !== "pending") throw new BadRequestError("This invitation has already been " + invitation.getString("status"));
    invitation.set("status", "declined");
    $app.save(invitation);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// Leaving an organisation (the last admin can't — see lib/members.js).
routerAdd(
  "DELETE",
  "/api/me/memberships/{org}",
  (e) => {
    const { removeMember } = require(`${__hooks}/lib/members.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const orgId = e.request.pathValue("org");
    const membership = $app.findRecordsByFilter("memberships", "user = {:user} && org = {:org}", "", 1, 0, { user: e.auth.id, org: orgId })[0];
    if (!membership) throw new NotFoundError("You're not a member of that organisation");
    removeMember($app, orgId, membership.id);
    logEvent(orgId, "member_left", whoName(e.auth), { email: e.auth.getString("email") });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);
