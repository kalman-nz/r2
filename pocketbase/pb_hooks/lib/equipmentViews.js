function validateViewBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.name !== "string" || !data.name.trim()) throw new BadRequestError("name is required");
  if (!Array.isArray(data.columns) || data.columns.some((c) => typeof c !== "string")) {
    throw new BadRequestError("columns must be an array of strings");
  }

  let widths = {};
  if (data.widths !== undefined) {
    if (!data.widths || typeof data.widths !== "object" || Array.isArray(data.widths)) {
      throw new BadRequestError("widths must be an object");
    }
    for (const [key, value] of Object.entries(data.widths)) {
      if (typeof value !== "number" || !(value > 0)) throw new BadRequestError("widths." + key + " must be a positive number");
    }
    widths = data.widths;
  }

  if (data.sortDir !== undefined && data.sortDir !== "asc" && data.sortDir !== "desc") {
    throw new BadRequestError("sortDir must be 'asc' or 'desc'");
  }

  return {
    name: data.name.trim(),
    columns: data.columns,
    widths,
    sortKey: typeof data.sortKey === "string" ? data.sortKey : "",
    sortDir: data.sortDir || "asc",
  };
}

// Shared like dashboards (lib/sharing.js): names is { userId: name } for
// everyone the listed rows mention, looked up once per list.
function toViewJson(ctx, me, record, names) {
  const { sharingJson } = require("./sharing.js");
  const out = sharingJson(ctx, me, record, names);
  out.id = record.id;
  out.name = record.get("name");
  out.columns = record.get("columns") || [];
  out.widths = record.get("widths") || {};
  out.sortKey = record.get("sortKey") || "";
  out.sortDir = record.get("sortDir") || "asc";
  return out;
}

module.exports = { validateViewBody, toViewJson };
