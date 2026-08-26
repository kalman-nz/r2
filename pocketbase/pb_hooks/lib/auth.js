// Route middleware — pair with $apis.requireAuth() (that one validates the
// Bearer token; this one additionally checks the isAdmin flag on the
// authenticated "users" record). Mirrors the old Fastify requireAdmin.
function requireAdmin(e) {
  if (!e.auth || e.auth.get("isAdmin") !== true) {
    throw new ForbiddenError("Admins only");
  }
  e.next();
}

module.exports = { requireAdmin };
