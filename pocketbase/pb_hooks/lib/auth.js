// Route middleware for platform admins (R2's own operators — see
// routes_admin.pb.js). Organisation roles are checked inside each handler
// with lib/orgs.js instead, because the organisation comes from the request.
//
// Middleware must stay self-contained: PocketBase runs route middleware from
// its source text in a separate VM, so calling any other function from this
// module fails with "is not defined" at request time (only globals like
// ForbiddenError survive).
function requirePlatformAdmin(e) {
  if (!e.auth || e.auth.get("isPlatformAdmin") !== true) throw new ForbiddenError("Platform admins only");
  e.next();
}

function whoName(auth) {
  return auth ? auth.get("name") || auth.get("email") : "";
}

module.exports = { requirePlatformAdmin, whoName };
