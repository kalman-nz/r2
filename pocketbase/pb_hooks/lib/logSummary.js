const { rentman } = require(`${__hooks}/lib/rentman.js`);

// Record.get() on a "json" field returns the raw stored bytes (a plain JS
// array of char codes), not a decoded value — confirmed empirically: an
// untouched pass-through to e.json() round-trips fine (Go's json.Marshaler
// on the underlying value handles it), but any JS-side read/copy of it
// (Object.assign, spread, etc.) mangles it into {"0":123,"1":125,...} and,
// worse, can leak a Go method value that crashes json.Marshal with "json:
// unsupported type: func() ([]uint8, error)". Decode it back to real JS
// data before touching it.
function decodeJsonField(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") return raw ? JSON.parse(raw) : {};
  if (Array.isArray(raw) || typeof raw.length === "number") {
    if (raw.length === 0) return {};
    return JSON.parse(String.fromCharCode.apply(null, raw));
  }
  return raw;
}

// resolveSerials pulls in Rentman's full serial-number catalog to turn a
// print's rentmanSerialNumberId into a readable asset name — the only part
// of this that ever needs Rentman at all. The admin activity feed wants
// that polish; a single user's own activity view doesn't need to pay for
// it, so false skips the Rentman call entirely.
function summarizeLogs(rows, opts) {
  const resolveSerials = (opts && opts.resolveSerials) || false;

  const templates = $app.findAllRecords("label_templates");
  const templateNameById = new Map(templates.map((t) => [t.id, t.get("name")]));

  let labelFor = (id) => id;
  if (resolveSerials) {
    const serials = rentman.listAllSerialNumbers();
    const serialLabelById = new Map(serials.map((s) => [String(s.id), s.displayname || String(s.id)]));
    labelFor = (id) => serialLabelById.get(id) || id;
  }

  return rows.map((entry) => {
    const details = decodeJsonField(entry.details);
    let summary = entry.type;
    if (entry.type === "print" && typeof details.customText === "string") {
      summary = 'Printed custom label "' + details.customText + '"';
    } else if (entry.type === "print") {
      const templateId = typeof details.template === "string" ? details.template : "";
      const serialId = typeof details.rentmanSerialNumberId === "string" ? details.rentmanSerialNumberId : "";
      details.templateName = templateNameById.get(templateId) || "deleted template";
      summary = 'Printed "' + details.templateName + '" label';
      if (serialId) {
        details.serialLabel = labelFor(serialId);
        summary += " · " + details.serialLabel;
      } else {
        summary += " (manual field values)";
      }
    } else if (entry.type === "login") {
      summary = "Logged in";
    } else if (entry.type === "page_view") {
      summary = "Viewed " + (details.path || "page");
    } else if (entry.type === "label_created") {
      summary = 'Created label template "' + (details.name || details.id) + '"';
    } else if (entry.type === "label_updated") {
      summary = 'Edited label template "' + (details.name || details.id) + '"';
    } else if (entry.type === "label_deleted") {
      summary = 'Deleted label template "' + (details.name || details.id) + '"';
    } else if (entry.type === "user_created") {
      summary = 'Created user "' + (details.name || details.email || details.id) + '"';
    } else if (entry.type === "user_updated") {
      summary = 'Edited user "' + (details.name || details.id) + '"';
    } else if (entry.type === "user_deleted") {
      summary = 'Deleted user "' + (details.name || details.id) + '"';
    }
    return {
      id: "log-" + entry.id,
      type: entry.type,
      who: entry.who || null,
      timestamp: entry.createdAt,
      summary: summary,
      details: details,
    };
  });
}

module.exports = { summarizeLogs };
