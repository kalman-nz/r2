// Files on repairs and maintenance jobs: a protected "files" field (only the
// organisation's members can open them, through a file token) and
// "fileInfo", { storedName: { name, size, by, at } } — PocketBase renames
// what it stores ("PO 4471.pdf" → "po_4471_x8k2m4n6p1.pdf"), so this keeps
// the name it was uploaded with, its size, and who added it when.
// pb_migrations/0032 and 0033 have the fields; both limits must match them.

const FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 99;

// The multipart "files" of a request, or [] when there are none.
function uploadedFiles(e) {
  try {
    return e.findUploadedFiles("files");
  } catch (_) {
    return []; // not multipart, or no "files" in it
  }
}

// Adds uploaded files to a record (open or closed: a repairer's invoice
// often turns up after the kit is back). Returns the saved record.
function addFiles(app, collection, id, files, who) {
  const { decodeJson } = require("./records.js");
  if (!files || files.length === 0) throw new BadRequestError("Choose a file to upload");
  for (const f of files) {
    if (f.size > FILE_SIZE) throw new BadRequestError(f.originalName + " is too big: files can be up to " + FILE_SIZE / 1024 / 1024 + " MB");
  }
  const record = app.findRecordById(collection, id);
  if (record.getStringSlice("files").length + files.length > MAX_FILES) {
    throw new BadRequestError("There can be up to " + MAX_FILES + " files here");
  }
  const info = decodeJson(record.get("fileInfo"), {});
  const at = new Date().toISOString();
  for (const f of files) info[f.name] = { name: f.originalName, size: f.size, by: who, at: at };
  record.set("files+", files);
  record.set("fileInfo", info);
  app.save(record);
  return record;
}

// Removes one file (by its stored name), from storage too. Returns the
// saved record and the name the file was uploaded with.
function removeFile(app, collection, id, stored) {
  const { decodeJson } = require("./records.js");
  const record = app.findRecordById(collection, id);
  if (record.getStringSlice("files").indexOf(stored) === -1) throw new NotFoundError("That file isn't here");
  const info = decodeJson(record.get("fileInfo"), {});
  const name = (info[stored] && info[stored].name) || stored;
  delete info[stored];
  record.set("files-", [stored]);
  record.set("fileInfo", info);
  app.save(record);
  return { record: record, name: name };
}

module.exports = { FILE_SIZE, MAX_FILES, uploadedFiles, addFiles, removeFile };
