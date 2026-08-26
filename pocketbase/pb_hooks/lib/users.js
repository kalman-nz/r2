const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toUserJson(record) {
  return {
    id: record.id,
    name: record.get("name"),
    email: record.get("email"),
    isAdmin: record.get("isAdmin") === true,
    verified: record.get("verified") === true,
    created: record.get("created"),
  };
}

function validateCreateBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.name !== "string" || !data.name) throw new BadRequestError("name is required");
  if (typeof data.email !== "string" || !EMAIL_RE.test(data.email)) throw new BadRequestError("valid email is required");
  if (typeof data.password !== "string" || data.password.length < 8) throw new BadRequestError("password must be at least 8 characters");
  return { name: data.name, email: data.email, password: data.password, isAdmin: data.isAdmin === true };
}

function validateUpdateBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  const out = {};
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !data.name) throw new BadRequestError("name must be a non-empty string");
    out.name = data.name;
  }
  if (data.email !== undefined) {
    if (typeof data.email !== "string" || !EMAIL_RE.test(data.email)) throw new BadRequestError("email must be valid");
    out.email = data.email;
  }
  if (data.isAdmin !== undefined) {
    if (typeof data.isAdmin !== "boolean") throw new BadRequestError("isAdmin must be a boolean");
    out.isAdmin = data.isAdmin;
  }
  if (data.password !== undefined) {
    if (typeof data.password !== "string" || data.password.length < 8) throw new BadRequestError("password must be at least 8 characters");
    out.password = data.password;
  }
  return out;
}

module.exports = { toUserJson, validateCreateBody, validateUpdateBody };
