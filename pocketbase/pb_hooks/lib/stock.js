// Where a bulk item's stock is (item_stock, migration 0043): a quantity at
// each stock location, and the shelf or bin it's on there. The item's
// stockQty is always their total, so everything that counts stock
// (availability, repairs, stats) keeps reading one number.
//
// Both ways round:
//   - Changing the rows (PUT /api/items/{id}/stock, or the records API)
//     sets the item's total (setTotal).
//   - Changing the total some other way (an import, Rentman, a repair
//     written off) moves the rows to match (matchRows): more goes to the
//     location with the most, less comes off the largest first. An item
//     with no rows yet gets one at the organisation's first location.
//
// Serialised units carry their own location and bin (serials).

function rowsOf(app, itemId) {
  return app.findRecordsByFilter("item_stock", "item = {:item}", "created", 0, 0, { item: itemId });
}

function totalOf(rows) {
  let total = 0;
  for (const r of rows) total += r.getInt("qty");
  return total;
}

function firstLocation(app, org) {
  const found = app.findRecordsByFilter("locations", "org = {:org}", "created", 1, 0, { org: org });
  return found.length > 0 ? found[0] : null;
}

// Saves that skip the hooks skip making an id too.
function newRow(app, fields) {
  const row = new Record(app.findCollectionByNameOrId("item_stock"), fields);
  row.set("id", $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"));
  return row;
}

// Rows are saved without hooks, so a row's save doesn't send its item
// round matchRows again. That skips PocketBase's created/updated stamps
// too, so they're set here: a millisecond apart at least, so rows made
// together keep their order (lists sort by created).
let lastStamp = 0;
function saveRow(app, row) {
  let ms = Date.now();
  if (ms <= lastStamp) ms = lastStamp + 1;
  lastStamp = ms;
  const now = new Date(ms).toISOString().replace("T", " ");
  if (!row.getString("created")) row.setRaw("created", now);
  row.setRaw("updated", now);
  app.unsafeWithoutHooks().save(row);
}

const isBulk = (item) => item.getString("kind") === "item" && item.getString("tracking") === "bulk";

// The item's stockQty from its rows. Written straight to the table: the
// rows are already saved and checked, and saving the item would only send
// it round matchRows again.
function setTotal(app, itemId) {
  app
    .db()
    .newQuery("UPDATE items SET stockQty = (SELECT COALESCE(SUM(qty), 0) FROM item_stock WHERE item = {:item}) WHERE id = {:item}")
    .bind({ item: itemId })
    .execute();
}

// The rows, after the item itself was saved with a new stockQty (or became
// something other than bulk stock, which has no rows).
function matchRows(app, item) {
  const quiet = app.unsafeWithoutHooks();
  const rows = rowsOf(app, item.id);
  if (!isBulk(item)) {
    for (const r of rows) quiet.delete(r);
    return;
  }
  const want = item.getInt("stockQty");
  let diff = want - totalOf(rows);
  if (diff === 0) return;
  if (rows.length === 0) {
    const where = firstLocation(app, item.getString("org"));
    if (!where) return;
    const row = newRow(app, {
      org: item.getString("org"),
      item: item.id,
      location: where.id,
      qty: want,
      bin: item.getString("locationInWarehouse").trim(),
    });
    saveRow(app, row);
    return;
  }
  const largest = rows.slice().sort((a, b) => b.getInt("qty") - a.getInt("qty"));
  if (diff > 0) {
    largest[0].set("qty", largest[0].getInt("qty") + diff);
    saveRow(app, largest[0]);
    return;
  }
  for (const r of largest) {
    if (diff === 0) break;
    const take = Math.min(r.getInt("qty"), -diff);
    if (take === 0) continue;
    r.set("qty", r.getInt("qty") - take);
    saveRow(app, r);
    diff += take;
  }
}

// Replace an item's rows with `wanted` ([{ location, qty, bin }], one per
// location), in a transaction. Rows left out are removed.
function replaceRows(app, item, wanted) {
  if (!isBulk(item)) throw new BadRequestError("Only bulk items have stock by location");
  if (!Array.isArray(wanted)) throw new BadRequestError("Send the stock as a list of locations");
  const org = item.getString("org");
  const seen = {};
  const clean = wanted.map((w) => {
    const location = String((w && w.location) || "");
    const qty = Number(w && w.qty);
    if (!location) throw new BadRequestError("Choose a location for each line");
    if (seen[location]) throw new BadRequestError("Each location can only be listed once");
    seen[location] = true;
    if (!Number.isInteger(qty) || qty < 0) throw new BadRequestError("Quantities must be whole numbers, 0 or more");
    let loc;
    try {
      loc = app.findRecordById("locations", location);
    } catch (_) {
      throw new BadRequestError("That location doesn't exist");
    }
    if (loc.getString("org") !== org) throw new BadRequestError("That location belongs to another organisation");
    return { location: location, qty: qty, bin: String((w && w.bin) || "").trim().slice(0, 200) };
  });
  let total = 0;
  for (const w of clean) total += w.qty;
  if (total < item.getInt("outOfServiceQty")) {
    throw new BadRequestError(item.getInt("outOfServiceQty") + " are out of service, so there can't be fewer than that in stock");
  }

  app.runInTransaction((tx) => {
    const quiet = tx.unsafeWithoutHooks();
    const byLocation = {};
    for (const r of rowsOf(tx, item.id)) byLocation[r.getString("location")] = r;
    for (const w of clean) {
      const row = byLocation[w.location] || newRow(tx, { org: org, item: item.id, location: w.location });
      delete byLocation[w.location];
      row.set("qty", w.qty);
      row.set("bin", w.bin);
      saveRow(tx, row);
    }
    for (const id of Object.keys(byLocation)) quiet.delete(byLocation[id]);
    setTotal(tx, item.id);
  });
}

// Checks for a row saved through the records API.
function validateRow(app, record) {
  const org = record.getString("org");
  if (!org) return;
  record.set("bin", record.getString("bin").trim());
  let item;
  try {
    item = app.findRecordById("items", record.getString("item"));
  } catch (_) {
    throw new BadRequestError("That item doesn't exist");
  }
  if (item.getString("org") !== org) throw new BadRequestError("That item belongs to another organisation");
  if (!isBulk(item)) throw new BadRequestError(item.getString("name") + " isn't bulk stock: its units each have their own location");
  if (!record.isNew() && record.original().getString("item") !== item.id) throw new BadRequestError("Stock can't move to another item");
  let loc;
  try {
    loc = app.findRecordById("locations", record.getString("location"));
  } catch (_) {
    throw new BadRequestError("That location doesn't exist");
  }
  if (loc.getString("org") !== org) throw new BadRequestError("That location belongs to another organisation");
  let others = 0;
  for (const r of rowsOf(app, item.id)) if (r.id !== record.id) others += r.getInt("qty");
  if (others + record.getInt("qty") < item.getInt("outOfServiceQty")) {
    throw new BadRequestError(item.getInt("outOfServiceQty") + " are out of service, so there can't be fewer than that in stock");
  }
}

// Where each item is kept, as a line for packing lists and search:
// "Main store, Bay 3" when it's all in one place, otherwise each place with
// how many ("Main store, Bay 3 ×3 · Theatre ×5"). Bulk stock from its rows,
// serialised from its active units. items → { id: text }.
function placesOf(app, items) {
  const names = {};
  const nameOf = (id) => {
    if (!(id in names)) {
      try {
        names[id] = app.findRecordById("locations", id).getString("name");
      } catch (_) {
        names[id] = "";
      }
    }
    return names[id];
  };
  const out = {};
  for (const item of items) {
    if (!item || item.getString("kind") !== "item") continue;
    const counts = {};
    const order = [];
    const add = (location, bin, qty) => {
      const text = [location ? nameOf(location) : "", bin].filter(Boolean).join(", ");
      if (!text || qty <= 0) return;
      if (!(text in counts)) {
        counts[text] = 0;
        order.push(text);
      }
      counts[text] += qty;
    };
    if (isBulk(item)) {
      for (const r of rowsOf(app, item.id)) add(r.getString("location"), r.getString("bin"), r.getInt("qty"));
    } else {
      for (const u of app.findRecordsByFilter("serials", "item = {:item} && status = 'active'", "", 0, 0, { item: item.id })) {
        add(u.getString("location"), u.getString("bin"), 1);
      }
    }
    // By name, like the app's lists of locations.
    order.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    out[item.id] = order.length === 1 ? order[0] : order.map((t) => t + " ×" + counts[t]).join(" · ");
  }
  return out;
}

module.exports = { rowsOf, totalOf, setTotal, saveRow, matchRows, replaceRows, validateRow, placesOf };
