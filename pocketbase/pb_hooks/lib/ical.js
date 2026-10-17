// Read-only iCalendar feed of jobs (routes_ical.pb.js), so planners can
// subscribe from Google/Apple/Outlook calendar. Pure, like lib/pricing.js,
// and tested in pocketbase/tests/ical.test.js.
//
// One event per job spanning the time its kit is booked; the schedule goes
// in the description, in UTC since the feed has no idea of the reader's
// zone.
// Enquiries and provisional jobs are TENTATIVE.

function escapeText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// 20261019T090000Z
function icsDate(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// RFC 5545 asks for lines of at most 75 octets, continued with a leading
// space. Counting UTF-16 units rather than bytes keeps it simple and only
// ever folds a little early for non-ASCII text, which is allowed.
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join("\r\n ");
}

// "2026-10-19 09:00"
function utc(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

const STATUS_LABEL = {
  enquiry: "Enquiry",
  provisional: "Provisional",
  confirmed: "Confirmed",
  out: "Out",
  returned: "Returned",
  cancelled: "Cancelled",
};

// jobs: [{ id, number, name, status, start, end (ms), client, venue,
// updated (ms), url, periods: [{ kind, name, start, end (ms) }] }]
function buildIcs(jobs, calendarName, nowMs) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//R2//Projects//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(calendarName),
  ];
  for (const job of jobs) {
    const description = [];
    if (job.client) description.push("Client: " + job.client);
    if (job.periods && job.periods.length > 0) {
      description.push("Schedule (UTC):");
      for (const p of job.periods) {
        const tag = p.kind === "usage" ? " (kit booked)" : p.kind === "billing" ? " (billed)" : "";
        description.push(p.name + tag + ": " + utc(p.start) + " to " + utc(p.end));
      }
    }
    description.push("Status: " + (STATUS_LABEL[job.status] || job.status));
    if (job.url) description.push(job.url);

    lines.push(
      "BEGIN:VEVENT",
      "UID:" + job.id + "@r2",
      "DTSTAMP:" + icsDate(nowMs),
      "LAST-MODIFIED:" + icsDate(Number.isFinite(job.updated) ? job.updated : nowMs),
      "DTSTART:" + icsDate(job.start),
      "DTEND:" + icsDate(job.end),
      fold("SUMMARY:" + escapeText("#" + job.number + " " + job.name + (job.status === "confirmed" || job.status === "out" ? "" : " (" + STATUS_LABEL[job.status] + ")"))),
      "STATUS:" + (job.status === "enquiry" || job.status === "provisional" ? "TENTATIVE" : "CONFIRMED"),
    );
    if (job.venue) lines.push(fold("LOCATION:" + escapeText(job.venue)));
    lines.push(fold("DESCRIPTION:" + escapeText(description.join("\n"))));
    if (job.url) lines.push(fold("URL:" + job.url));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = { buildIcs, escapeText, icsDate };
