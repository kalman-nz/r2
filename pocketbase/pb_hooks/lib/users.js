const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// For accounts made by the server itself (first-run setup); people signing
// up go through PocketBase's own users API.
function validateNewAccount(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.name !== "string" || !data.name.trim()) throw new BadRequestError("name is required");
  if (typeof data.email !== "string" || !EMAIL_RE.test(data.email.trim())) throw new BadRequestError("valid email is required");
  if (typeof data.password !== "string" || data.password.length < 8) throw new BadRequestError("password must be at least 8 characters");
  return { name: data.name.trim(), email: data.email.trim(), password: data.password };
}

module.exports = { validateNewAccount };
