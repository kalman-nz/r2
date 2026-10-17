// Generic append-only event log (see pb_migrations/0004_generic_logs.js) —
// createdAt is a plain date field, not autodate, so it's set explicitly.
// org is the organisation the event belongs to; "" for platform-wide events
// (sign-ups, logins, platform admin actions).
function logEvent(org, type, who, details) {
  const logs = $app.findCollectionByNameOrId("logs");
  const record = new Record(logs, {
    org: org || "",
    type: type,
    who: who,
    details: details || {},
    createdAt: new Date().toISOString(),
  });
  $app.save(record);
  return record;
}

module.exports = { logEvent };
