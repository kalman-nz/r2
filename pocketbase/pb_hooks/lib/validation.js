// Cross-field and cross-collection rules the schema can't express on its
// own. Called from records_validation.pb.js on every save — REST API,
// importer and custom routes alike — and they throw BadRequestError so the
// message reaches the user (a plain Error would surface as a generic
// "Failed to create record.").
//
// Every record belongs to an organisation, and anything it points at must
// belong to the same one, or someone could link their records to another
// organisation's by id. (A record saved with no org at all is left for
// PocketBase's own "required" check to reject.)
const { toMs } = require("./time.js");

function countWhere(app, collection, filter, params) {
  return app.findRecordsByFilter(collection, filter, "", 0, 0, params).length;
}

// The record `field` points at, which must be in record's organisation.
function sameOrg(app, record, field, collection, what) {
  const id = record.getString(field);
  if (!id) return null;
  let target;
  try {
    target = app.findRecordById(collection, id);
  } catch (_) {
    throw new BadRequestError("That " + what + " doesn't exist");
  }
  if (target.getString("org") !== record.getString("org")) throw new BadRequestError("That " + what + " belongs to another organisation");
  return target;
}

// A number field that can't go below 0 (and, for counts, has to be whole).
// The schema refuses these too, but in PocketBase's words and under the
// field's own name, so this says it the way the app does, and first.
function checkAmount(record, field, label, whole) {
  const value = record.getFloat(field);
  if (!isFinite(value)) throw new BadRequestError(label + " has to be a number");
  if (value < 0) throw new BadRequestError(label + " can't be negative");
  if (whole && Math.floor(value) !== value) throw new BadRequestError(label + " has to be a whole number");
}

function validateItem(app, record) {
  const org = record.getString("org");
  if (!org) return;
  const kind = record.getString("kind");
  const barcode = record.getString("barcode").trim();
  record.set("barcode", barcode);
  sameOrg(app, record, "category", "categories", "category");

  if (kind === "kit") {
    // A kit owns no stock of its own; its components do.
    record.set("tracking", "");
    record.set("stockQty", 0);
    record.set("outOfServiceQty", 0);
  } else if (record.getString("tracking") !== "bulk" && record.getString("tracking") !== "serial") {
    throw new BadRequestError("Choose whether this item is tracked as a bulk quantity or by serial number");
  }

  checkAmount(record, "stockQty", "Quantity owned", true);
  checkAmount(record, "outOfServiceQty", "Out of service", true);
  checkAmount(record, "price", "Price", false);
  checkAmount(record, "replacementValue", "Replacement cost", false);
  checkAmount(record, "weightKg", "Weight", false);
  checkAmount(record, "powerW", "Power", false);
  checkAmount(record, "bufferHours", "Extra turnaround", false);

  if (record.getString("tracking") === "bulk" && record.getInt("outOfServiceQty") > record.getInt("stockQty")) {
    throw new BadRequestError("Out-of-service quantity can't be more than the stock quantity");
  }

  if (barcode && countWhere(app, "serials", "org = {:org} && barcode = {:code}", { org: org, code: barcode }) > 0) {
    throw new BadRequestError("Barcode " + barcode + " is already used by a serialised unit");
  }

  // Codes are unique from here on. Some imported ones aren't, and they're
  // left as they are until someone changes them.
  const code = record.getString("code").trim();
  record.set("code", code);
  const codeChanged = record.isNew() || record.original().getString("code") !== code;
  if (code && codeChanged) {
    const others = app.findRecordsByFilter("items", "org = {:org} && code = {:code} && id != {:id}", "", 1, 0, { org: org, code: code, id: record.id });
    if (others.length > 0) throw new BadRequestError("Item code " + code + " is already used by " + others[0].getString("name"));
  }

  if (record.isNew()) return;
  if (record.original().getString("org") !== org) throw new BadRequestError("Items can't move between organisations");
  const id = record.id;
  if (kind === "kit" && countWhere(app, "serials", "item = {:id}", { id: id }) > 0) {
    throw new BadRequestError("This item has serial numbers, so it can't become a kit");
  }
  if (kind === "kit" && countWhere(app, "item_components", "child = {:id}", { id: id }) > 0) {
    throw new BadRequestError("This item is part of a kit or is an accessory, so it can't become a kit itself");
  }
  if (kind === "item" && countWhere(app, "item_components", "parent = {:id} && kind = 'component'", { id: id }) > 0) {
    throw new BadRequestError("Remove this kit's components before turning it into a physical item");
  }
  if (record.getString("tracking") === "bulk" && countWhere(app, "serials", "item = {:id}", { id: id }) > 0) {
    throw new BadRequestError("Delete this item's serial numbers before switching it to bulk tracking");
  }
}

function validateSerial(app, record) {
  const org = record.getString("org");
  if (!org) return;
  const barcode = record.getString("barcode").trim();
  record.set("barcode", barcode);
  record.set("bin", record.getString("bin").trim());
  if (!record.getString("item")) throw new BadRequestError("Serial numbers need an item");
  const item = sameOrg(app, record, "item", "items", "item");
  sameOrg(app, record, "location", "locations", "location");
  if (item.getString("kind") !== "item" || item.getString("tracking") !== "serial") {
    throw new BadRequestError(item.getString("name") + " isn't tracked by serial number");
  }
  if (barcode && countWhere(app, "items", "org = {:org} && barcode = {:code}", { org: org, code: barcode }) > 0) {
    throw new BadRequestError("Barcode " + barcode + " is already used by a bulk item");
  }
  checkAmount(record, "purchaseCost", "Purchase cost", false);

  // A manufacturer's serial number belongs to one unit, so it's on only one
  // of the organisation's units (ignoring case). Checked when it's new or
  // changed: some imported units share one, and they're left as they are
  // until someone edits them.
  const serialNumber = record.getString("serialNumber").trim();
  record.set("serialNumber", serialNumber);
  const changed = record.isNew() || record.original().getString("serialNumber").trim().toLowerCase() !== serialNumber.toLowerCase();
  if (serialNumber && changed) {
    const rows = arrayOf(new DynamicModel({ barcode: "", label: "", item: "" }));
    app
      .db()
      .newQuery(
        "SELECT barcode, label, item FROM serials WHERE org = {:org} AND serialNumber != '' AND serialNumber = {:sn} COLLATE NOCASE AND id != {:id} LIMIT 1",
      )
      .bind({ org: org, sn: serialNumber, id: record.id })
      .all(rows);
    if (rows.length > 0) {
      let itemName = "";
      try {
        itemName = app.findRecordById("items", rows[0].item).getString("name");
      } catch (_) {}
      const unit = [itemName, rows[0].barcode || rows[0].label].filter((s) => s).join(" ");
      throw new BadRequestError("Serial number " + serialNumber + " is already on " + (unit || "another unit"));
    }
  }
}

function validateComponent(app, record) {
  if (!record.getString("org")) return;
  if (record.getString("parent") === record.getString("child")) throw new BadRequestError("An item can't contain itself");
  const parent = sameOrg(app, record, "parent", "items", "item");
  const child = sameOrg(app, record, "child", "items", "item");
  if (!parent || !child) throw new BadRequestError("Both items must exist");
  if (child.getString("kind") !== "item") {
    throw new BadRequestError("Kits can't be nested — add the physical items instead");
  }
  if (record.getString("kind") === "component" && parent.getString("kind") !== "kit") {
    throw new BadRequestError(parent.getString("name") + " isn't a kit, so it can't have components (add an accessory instead)");
  }
}

// A category can't end up as its own ancestor.
function validateCategory(app, record) {
  if (!record.getString("org")) return;
  sameOrg(app, record, "parent", "categories", "parent category");
  let parentId = record.getString("parent");
  const seen = {};
  for (let depth = 0; parentId && depth < 50; depth++) {
    if (parentId === record.id) throw new BadRequestError("A category can't sit inside itself");
    if (seen[parentId]) break;
    seen[parentId] = true;
    let parent;
    try {
      parent = app.findRecordById("categories", parentId);
    } catch (_) {
      break;
    }
    parentId = parent.getString("parent");
  }
}

// Kit is held from prepAt to returnAt (the usage periods; lib/periods.js).
function validateJob(app, record) {
  if (!record.getString("org")) return;
  sameOrg(app, record, "client", "contacts", "client");
  sameOrg(app, record, "venue", "venues", "location");
  const prep = toMs(record.getString("prepAt"));
  const ret = toMs(record.getString("returnAt"));
  if (!(prep < ret)) throw new BadRequestError("Return has to be after prep");

  // Only set when creating, to seed the first billing period.
  const billingStart = record.getString("billingStart");
  const billingEnd = record.getString("billingEnd");
  if (!billingStart && !billingEnd) return;
  if (!billingStart || !billingEnd) throw new BadRequestError("Set both ends of the billing period, or neither");
  if (!(toMs(billingStart) < toMs(billingEnd))) throw new BadRequestError("The billing period has to end after it starts");
}

// A membership's or invitation's role has to be one of its own
// organisation's roles.
// (Before migration 0024 the role was plain text, so there's nothing to check.)
function roleIsRecord(record) {
  const field = record.collection().fields.getByName("role");
  return !!field && field.type() === "relation";
}

// A subproject is in its project's organisation.
function sameOrgJob(app, record) {
  if (record.getString("org")) sameOrg(app, record, "job", "jobs", "project");
}

// A period's or line's subproject, if it has one, has to be part of the
// same project.
function sameSubproject(app, record) {
  const id = record.getString("subproject");
  if (!id) return;
  let sub;
  try {
    sub = app.findRecordById("subprojects", id);
  } catch (_) {
    throw new BadRequestError("That subproject doesn't exist");
  }
  if (sub.getString("job") !== record.getString("job")) throw new BadRequestError("That subproject is part of another project");
}

// A schedule period: on a job in the same organisation, ending after it
// starts.
function validatePeriod(app, record) {
  if (!record.getString("org")) return;
  sameOrg(app, record, "job", "jobs", "project");
  sameSubproject(app, record);
  const start = toMs(record.getString("start"));
  const end = toMs(record.getString("end"));
  if (!(start < end)) throw new BadRequestError("A period has to end after it starts");

  // A project and each subproject have exactly one usage and one billing
  // period. Checked when one is added or turned into either, so projects
  // from before the rule with more than one can still be edited.
  const kind = record.getString("kind");
  const becomes = record.isNew() || record.original().getString("kind") !== kind || record.original().getString("subproject") !== record.getString("subproject");
  if ((kind === "usage" || kind === "billing") && becomes) {
    // Compared here rather than in the filter: an empty subproject doesn't
    // match a bound "" parameter there. A job only has a few periods.
    const sub = record.getString("subproject");
    const others = app
      .findRecordsByFilter("job_periods", "job = {:job}", "", 0, 0, { job: record.getString("job") })
      .filter((p) => p.id !== record.id && p.getString("kind") === kind && p.getString("subproject") === sub);
    if (others.length > 0) {
      throw new BadRequestError((record.getString("subproject") ? "This subproject" : "This project") + " already has its " + kind + " period: change its times instead");
    }
  }
}

function validateMembership(app, record) {
  if (!record.getString("org") || !roleIsRecord(record)) return;
  sameOrg(app, record, "role", "roles", "role");
}

function validateInvitation(app, record) {
  record.set("email", record.getString("email").trim().toLowerCase());
  if (!record.getString("org") || !roleIsRecord(record)) return;
  sameOrg(app, record, "role", "roles", "role");
}

// Custom fields: a name, a type and (for a dropdown) its choices. New ones
// get a key nobody picks; a field's key never changes, since items keep
// their values under it.
function validateCustomField(app, record) {
  const { decodeJson } = require("./records.js");
  const label = record.getString("label").trim();
  record.set("label", label);
  if (!label) throw new BadRequestError("The field needs a name");
  if (!record.getString("appliesTo")) record.set("appliesTo", "item");
  if (!record.getString("type")) record.set("type", "text");
  if (record.isNew()) {
    if (!record.getString("key")) record.set("key", "field_" + $security.randomStringWithAlphabet(10, "abcdefghijklmnopqrstuvwxyz0123456789"));
  } else if (record.original().getString("key") !== record.getString("key")) {
    throw new BadRequestError("A field's key can't be changed");
  }
  const others = app.findRecordsByFilter("custom_fields", "org = {:org} && appliesTo = {:to} && label = {:label} && id != {:id}", "", 1, 0, {
    org: record.getString("org"),
    to: record.getString("appliesTo"),
    label: label,
    id: record.id,
  });
  if (others.length > 0) throw new BadRequestError("There's already a field called " + label);
  if (record.getString("type") === "select") {
    const seen = {};
    const options = [];
    for (const o of decodeJson(record.get("options"), [])) {
      const text = String(o).trim();
      if (text && !seen[text]) {
        seen[text] = true;
        options.push(text);
      }
    }
    if (options.length === 0) throw new BadRequestError("A dropdown needs at least one choice");
    record.set("options", options);
  } else {
    record.set("options", []);
  }
}

// Roles hold known permissions only (plus what those need, see
// lib/permissions.js), and the locked Admin role always holds all of them.
function validateRole(record) {
  const { normalise, ALL } = require("./permissions.js");
  const { decodeJson } = require("./records.js");
  record.set("name", record.getString("name").trim());
  if (!record.getString("name")) throw new BadRequestError("The role needs a name");
  record.set("permissions", record.getBool("locked") ? ALL : normalise(decodeJson(record.get("permissions"), [])));
  if (!record.isNew() && record.original().getBool("locked") !== record.getBool("locked")) {
    throw new BadRequestError("A role can't be locked or unlocked");
  }
}

// Deleting a contact/venue/item that jobs point at would silently blank
// those jobs' references (the relations are optional), so refuse and point
// at archiving instead.
function guardReferenced(app, collection, filter, id, what) {
  const n = countWhere(app, collection, filter, { id: id });
  if (n > 0) throw new BadRequestError("This " + what + " is used on " + n + " project" + (n === 1 ? "" : "s") + " — archive it instead");
}

module.exports = {
  validateItem,
  validateSerial,
  validateComponent,
  validateCategory,
  validateJob,
  validatePeriod,
  validateMembership,
  validateRole,
  validateCustomField,
  validateInvitation,
  guardReferenced,
  sameSubproject,
  sameOrgJob,
};
