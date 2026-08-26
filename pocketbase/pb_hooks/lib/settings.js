// Adding a new setting anywhere in the app is just: read/write its key
// through these two functions — no PocketBase schema migration needed.
function getAllSettings() {
  const rows = $app.findAllRecords("settings");
  const result = {};
  for (const row of rows) result[row.get("key")] = row.get("value");
  return result;
}

function setSetting(key, value) {
  const collection = $app.findCollectionByNameOrId("settings");
  let existing = null;
  try {
    existing = $app.findFirstRecordByFilter("settings", "key = {:key}", { key: key });
  } catch (_) {
    existing = null;
  }
  if (existing) {
    existing.set("value", value);
    $app.save(existing);
  } else {
    const record = new Record(collection, { key: key, value: value });
    $app.save(record);
  }
}

// Known settings and their defaults when no row exists for that key yet.
const DEFAULTS = { printerHost: "", businessName: "", businessShortName: "" };

module.exports = { getAllSettings, setSetting, DEFAULTS };
