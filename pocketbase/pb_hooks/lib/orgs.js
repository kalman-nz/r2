// Organisation access for the custom routes (collection rules cover the REST
// API — see pb_migrations/0024_custom_roles.js). Every route that touches
// an organisation's data calls one of these first, inside its handler:
//
//   const ctx = requireOrg(e);                         // any member; org from the X-Org header
//   const ctx = requireOrg(e, "settings.edit");        // …whose role allows this
//   const ctx = requireRecordOrg(e, job, "jobs.lines"); // org of a record
//   const ctx = requireOrg(e, ["import.csv", "import.rentman"]); // any of these
//
// Both throw unless the signed-in user is a member, the organisation isn't
// suspended, and their role there has the permission (lib/permissions.js)
// and the organisation hasn't turned off the feature it belongs to
// (lib/features.js). They return { orgId, org, membership, role,
// permissions, can(p), isAdmin, features }.

function membershipOf(app, userId, orgId) {
  if (!userId || !orgId) return null;
  return app.findRecordsByFilter("memberships", "user = {:user} && org = {:org}", "", 1, 0, { user: userId, org: orgId })[0] || null;
}

// What a role allows, as { permissions, can, isAdmin }.
function access(role) {
  const { decodeJson } = require("./records.js");
  const { ALL } = require("./permissions.js");
  const isAdmin = !!role && role.getBool("locked");
  const permissions = isAdmin ? ALL.slice() : role ? decodeJson(role.get("permissions"), []) : [];
  const held = {};
  for (const p of permissions) held[p] = true;
  return { permissions: permissions, can: (p) => isAdmin || held[p] === true, isAdmin: isAdmin };
}

function requireMember(e, orgId, permission) {
  const { LABELS } = require("./permissions.js");
  const { featuresOf, blockingFeature } = require("./features.js");
  if (!e.auth) throw new UnauthorizedError("Sign in first");
  if (!orgId) throw new BadRequestError("Choose an organisation first");
  let org;
  try {
    org = $app.findRecordById("organisations", orgId);
  } catch (_) {
    throw new NotFoundError("Organisation not found");
  }
  const membership = membershipOf($app, e.auth.id, orgId);
  if (!membership) throw new ForbiddenError("You're not a member of this organisation");
  if (org.getBool("suspended")) throw new ForbiddenError("This organisation is suspended");
  let role = null;
  try {
    role = $app.findRecordById("roles", membership.getString("role"));
  } catch (_) {
    // a missing role allows nothing beyond membership
  }
  const allowed = access(role);
  const features = featuresOf(org);
  const can = (p) => allowed.can(p) && !blockingFeature(features, p);
  if (permission) {
    const wanted = Array.isArray(permission) ? permission : [permission];
    if (!wanted.some(can)) {
      const off = blockingFeature(features, wanted[0]);
      if (off && wanted.every((p) => blockingFeature(features, p))) {
        throw new ForbiddenError(off.label + " is turned off for this organisation (Settings → Features)");
      }
      throw new ForbiddenError("Your role doesn't allow that (" + wanted.map((p) => LABELS[p] || p).join(" or ").toLowerCase() + ")");
    }
  }
  return {
    orgId: orgId,
    org: org,
    membership: membership,
    role: role,
    permissions: allowed.permissions.filter(can),
    can: can,
    isAdmin: allowed.isAdmin,
    features: features,
  };
}

// The organisation the app is working in: the X-Org header the web app
// sends with every API call (or ?org= for links that can't set headers).
function requestOrg(e) {
  return e.request.header.get("X-Org") || e.requestInfo().query.org || "";
}

function requireOrg(e, permission) {
  return requireMember(e, requestOrg(e), permission);
}

// For routes acting on one record: that record's own organisation decides,
// whatever the app's current organisation is.
function requireRecordOrg(e, record, permission) {
  return requireMember(e, record.getString("org"), permission);
}

// What a job summary may include for this person (lib/jobs.js buildSummary).
function summaryAccess(ctx) {
  return { prices: ctx.can("prices.view"), quotes: ctx.can("quotes.view") };
}

module.exports = { membershipOf, access, requireMember, requestOrg, requireOrg, requireRecordOrg, summaryAccess };
