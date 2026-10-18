// Finding an item's photo online. print/r2_find_photo.py does the work: a
// local vision model (Ollama, R2_OLLAMA_URL / R2_VISION_MODEL) writes an
// image search query from the item's details, then picks the best of the
// results. Same JSON-file-in, file-out handshake as lib/pdf.js.
const { pythonBin, printDir } = require("./python.js");
const { decodeJson } = require("./records.js");

function removeQuietly(path) {
  try {
    $os.remove(path);
  } catch (_) {
    // already gone
  }
}

// "Audio › Microphones": the category and the folders above it.
function categoryPath(app, id) {
  const names = [];
  const seen = {};
  while (id && !seen[id] && names.length < 10) {
    seen[id] = true;
    let category;
    try {
      category = app.findRecordById("categories", id);
    } catch (_) {
      break;
    }
    names.unshift(category.getString("name"));
    id = category.getString("parent");
  }
  return names.join(" › ");
}

// The item's custom values under their labels rather than raw keys.
function customValues(app, item) {
  const values = decodeJson(item.get("custom"), {}) || {};
  const out = {};
  for (const key in values) {
    const field = app.findRecordsByFilter("custom_fields", "org = {:org} && key = {:key}", "", 1, 0, { org: item.getString("org"), key: key })[0];
    out[field ? field.getString("label") : key] = values[key];
  }
  return out;
}

// Finds a photo and saves it on the item. Returns what was found:
// { query, source, title, reason }. Throws BadRequestError with a readable
// reason when nothing suitable turns up.
function findItemPhoto(app, item) {
  const base = $os.tempDir() + "/r2-photo-" + $security.randomString(16);
  const input = base + ".json";
  const errorFile = base + ".err";
  $os.writeFile(
    input,
    JSON.stringify({
      name: item.getString("name"),
      code: item.getString("code"),
      category: categoryPath(app, item.getString("category")),
      tags: item.getString("tags"),
      description: item.getString("description"),
      custom: customValues(app, item),
    }),
    0o600,
  );
  let result = null;
  try {
    let output;
    try {
      output = toString($os.cmd(pythonBin(), printDir() + "/r2_find_photo.py", input, base).output());
    } catch (err) {
      let reason = "";
      try {
        reason = toString($os.readFile(errorFile));
      } catch (_) {
        reason = String((err && err.message) || err);
      }
      if (/no such file|not found|executable file/i.test(reason)) {
        reason = "photo search isn't set up on this server (no Python at " + pythonBin() + ")";
      }
      throw new BadRequestError("Couldn't find a photo: " + reason);
    }
    result = JSON.parse(output.trim().split("\n").pop());
    item.set("photo", $filesystem.fileFromPath(result.file));
    app.save(item);
    return { query: result.query, source: result.source, title: result.title, reason: result.reason };
  } finally {
    removeQuietly(input);
    removeQuietly(errorFile);
    if (result && result.file) removeQuietly(result.file);
  }
}

module.exports = { findItemPhoto };
