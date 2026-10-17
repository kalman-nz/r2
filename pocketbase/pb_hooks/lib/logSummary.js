// Turns raw log rows into one-line summaries for the Logs page and a user's
// activity feed.
//
// resolveNames looks up serial and job names for prints and scans. The
// admin activity feed wants that polish; a single user's own activity view
// doesn't need it, so false skips the lookups entirely. Prints logged before
// R2 carry a Rentman serial id (rentmanSerialNumberId) that no longer
// resolves to anything, so they show the raw id.
function summarizeLogs(rows, opts) {
  const { decodeJson } = require(`${__hooks}/lib/records.js`);
  const resolveNames = (opts && opts.resolveNames) || false;

  const templates = $app.findAllRecords("label_templates");
  const templateNameById = new Map(templates.map((t) => [t.id, t.get("name")]));

  const decoded = rows.map((entry) => decodeJson(entry.details));
  const serialName = {};
  const jobName = {};
  if (resolveNames) {
    const serialIds = [];
    const jobIds = [];
    for (const d of decoded) {
      if (typeof d.serialId === "string" && d.serialId) serialIds.push(d.serialId);
      if (typeof d.job === "string" && d.job) jobIds.push(d.job);
    }
    const serials = $app.findRecordsByIds("serials", serialIds).filter(Boolean);
    const itemNames = {};
    for (const it of $app.findRecordsByIds("items", serials.map((s) => s.get("item")))) {
      if (it) itemNames[it.id] = it.get("name");
    }
    for (const s of serials) {
      const label = s.get("label") || s.get("barcode");
      serialName[s.id] = (itemNames[s.get("item")] || "") + (label ? " (" + label + ")" : "");
    }
    for (const j of $app.findRecordsByIds("jobs", jobIds)) {
      if (j) jobName[j.id] = "#" + j.getInt("number") + " " + j.get("name");
    }
  }
  const jobLabel = (id) => jobName[id] || "job " + id;

  return rows.map((entry, i) => {
    const details = decoded[i];
    let summary = entry.type;
    if (entry.type === "print" && typeof details.customText === "string") {
      summary = 'Printed custom label "' + details.customText + '"';
    } else if (entry.type === "print") {
      const templateId = typeof details.template === "string" ? details.template : "";
      const serialId = details.serialId || details.rentmanSerialNumberId || "";
      details.templateName = templateNameById.get(templateId) || "deleted template";
      summary = 'Printed "' + details.templateName + '" label';
      if (serialId) {
        details.serialLabel = serialName[serialId] || serialId;
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
    } else if (entry.type === "quote_issued") {
      summary = "Issued quote v" + details.version + " for " + jobLabel(details.job);
    } else if (entry.type === "quote_status") {
      summary = "Marked a quote for " + jobLabel(details.job) + " as " + details.status;
    } else if (entry.type === "scan_out" || entry.type === "scan_in") {
      summary = "Scanned " + (details.message || details.code) + " · " + jobLabel(details.job);
    } else if (entry.type === "serial_status") {
      summary = "Flagged " + (details.barcode || details.serial) + " as " + details.to + (details.note ? ': "' + details.note + '"' : "");
    } else if (entry.type === "item_out_of_service") {
      summary = "Set " + details.name + " out of service: " + details.to + (details.note ? ' ("' + details.note + '")' : "");
    } else if (entry.type === "import_rentman") {
      summary = "Imported from Rentman" + (details.errors ? " (" + details.errors + " problems)" : "");
    } else if (entry.type === "import_csv") {
      summary = "Imported " + details.kind + " from CSV";
    } else if (entry.type === "export_xero") {
      const invoices = details.invoices || [];
      summary = "Exported " + invoices.length + " invoice" + (invoices.length === 1 ? "" : "s") + " for Xero";
    } else if (entry.type === "ical_rotated") {
      summary = "Made a new calendar feed address";
    } else if (entry.type === "member_invited") {
      summary = "Invited " + details.email + " as " + details.role;
    } else if (entry.type === "invite_accepted") {
      summary = details.email + " joined as " + details.role;
    } else if (entry.type === "member_role") {
      summary = "Changed a member's role to " + details.role;
    } else if (entry.type === "member_removed") {
      summary = "Removed a member";
    } else if (entry.type === "member_left") {
      summary = details.email + " left the organisation";
    } else if (entry.type === "role_created") {
      summary = "Created the " + details.name + " role";
    } else if (entry.type === "role_changed") {
      summary = "Changed the " + details.name + " role";
    } else if (entry.type === "role_deleted") {
      summary = "Deleted the " + details.name + " role";
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
