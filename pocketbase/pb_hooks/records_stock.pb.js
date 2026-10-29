/// <reference path="../pb_data/types.d.ts" />
// Bulk stock by location (lib/stock.js): an item's stockQty and its
// item_stock rows always agree, whichever one is changed. Same
// require()-inside-the-handler rule as the other hook files.

// The total changed some other way (import, Rentman, a repair written off,
// switching to serialised): move the rows to match.
onRecordCreate((e) => {
  e.next();
  if (!e.record.getString("org")) return;
  require(`${__hooks}/lib/stock.js`).matchRows(e.app, e.record);
}, "items");

onRecordUpdate((e) => {
  const before = e.record.original();
  const changed = ["stockQty", "kind", "tracking"].some((f) => String(before.get(f)) !== String(e.record.get(f)));
  e.next();
  if (changed && e.record.getString("org")) require(`${__hooks}/lib/stock.js`).matchRows(e.app, e.record);
}, "items");

onRecordValidate((e) => {
  require(`${__hooks}/lib/stock.js`).validateRow(e.app, e.record);
  e.next();
}, "item_stock");

// A row changed on its own: the item's total follows.
onRecordAfterCreateSuccess((e) => {
  require(`${__hooks}/lib/stock.js`).setTotal(e.app, e.record.getString("item"));
  e.next();
}, "item_stock");

onRecordAfterUpdateSuccess((e) => {
  require(`${__hooks}/lib/stock.js`).setTotal(e.app, e.record.getString("item"));
  e.next();
}, "item_stock");

onRecordDeleteRequest((e) => {
  const { rowsOf, totalOf } = require(`${__hooks}/lib/stock.js`);
  let item = null;
  try {
    item = e.app.findRecordById("items", e.record.getString("item"));
  } catch (_) {}
  if (item) {
    const left = totalOf(rowsOf(e.app, item.id)) - e.record.getInt("qty");
    if (left < item.getInt("outOfServiceQty")) {
      throw new BadRequestError(item.getInt("outOfServiceQty") + " are out of service, so there can't be fewer than that in stock");
    }
  }
  e.next();
}, "item_stock");

onRecordAfterDeleteSuccess((e) => {
  require(`${__hooks}/lib/stock.js`).setTotal(e.app, e.record.getString("item"));
  e.next();
}, "item_stock");

// A location with stock or units in it can't just disappear: they'd have
// nowhere to be. Empty stock lines there go with it.
onRecordDelete((e) => {
  const stocked = e.app.findRecordsByFilter("item_stock", "location = {:id} && qty > 0", "", 1, 0, { id: e.record.id });
  if (stocked.length > 0) throw new BadRequestError("There's stock kept here: move it to another location first");
  if (e.app.findRecordsByFilter("serials", "location = {:id}", "", 1, 0, { id: e.record.id }).length > 0) {
    throw new BadRequestError("There are units kept here: move them to another location first");
  }
  for (const r of e.app.findRecordsByFilter("item_stock", "location = {:id}", "", 0, 0, { id: e.record.id })) e.app.delete(r);
  e.next();
}, "locations");

// Replace a bulk item's stock by location in one go: body { stock: [{
// location, qty, bin }] }. The item's total becomes their sum.
routerAdd(
  "PUT",
  "/api/items/{id}/stock",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { replaceRows, rowsOf } = require(`${__hooks}/lib/stock.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const item = findOrNull($app, "items", e.request.pathValue("id"));
    if (!item) throw new NotFoundError("Item not found");
    const ctx = requireRecordOrg(e, item, "items.edit");
    const before = item.getInt("stockQty");
    replaceRows($app, item, (e.requestInfo().body || {}).stock);
    const saved = $app.findRecordById("items", item.id);
    if (saved.getInt("stockQty") !== before) {
      logEvent(ctx.orgId, "item_stock", whoName(e.auth), { item: item.id, name: item.getString("name"), from: before, to: saved.getInt("stockQty") });
    }
    return e.json(200, { item: saved, stock: rowsOf($app, item.id) });
  },
  $apis.requireAuth("users"),
);
