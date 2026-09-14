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
    shared: data.shared === true,
  };
}

// currentUserId + ownerName are request-scoped (who's asking, and the
// display name of whoever owns this particular row) — passed in rather
// than looked up here so callers can batch-resolve owner names once per
// list instead of a query per row.
function toViewJson(record, currentUserId, ownerName) {
  return {
    id: record.id,
    name: record.get("name"),
    columns: record.get("columns") || [],
    widths: record.get("widths") || {},
    sortKey: record.get("sortKey") || "",
    sortDir: record.get("sortDir") || "asc",
    shared: record.get("shared") === true,
    ownerId: record.get("owner"),
    ownerName: ownerName || "",
    isOwner: record.get("owner") === currentUserId,
  };
}

module.exports = { validateViewBody, toViewJson };
