/// <reference path="../pb_data/types.d.ts" />
// Deleting an inventory folder (a category) in one go, in one transaction:
//
//   { contents: false }  just the folder: its items and folders move up
//                        into its parent
//   { contents: true }   the folder and everything in it, at any depth.
//                        Items already used on a project or scanned can't
//                        be deleted (their history points at them), so
//                        those are archived and moved up instead.
//
// Returns { deleted, archived, moved } item counts.

routerAdd(
  "POST",
  "/api/folders/{id}/delete",
  (e) => {
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const folder = findOrNull($app, "categories", e.request.pathValue("id"));
    if (!folder) throw new NotFoundError("Folder not found");
    const ctx = requireRecordOrg(e, folder, "categories.delete");
    const contents = !!(e.requestInfo().body || {}).contents;
    if (contents && !ctx.can("items.delete")) throw new ForbiddenError("Deleting what's inside needs permission to delete items");

    const parent = folder.getString("parent");
    const result = { deleted: 0, archived: 0, moved: 0 };
    $app.runInTransaction((tx) => {
      const used = (itemId) =>
        tx.findRecordsByFilter("job_lines", "item = {:id}", "", 1, 0, { id: itemId }).length > 0 ||
        tx.findRecordsByFilter("scans", "item = {:id}", "", 1, 0, { id: itemId }).length > 0;

      if (!contents) {
        for (const sub of tx.findRecordsByFilter("categories", "parent = {:id}", "", 0, 0, { id: folder.id })) {
          sub.set("parent", parent);
          tx.save(sub);
        }
        for (const item of tx.findRecordsByFilter("items", "category = {:id}", "", 0, 0, { id: folder.id })) {
          item.set("category", parent);
          tx.save(item);
          result.moved++;
        }
        tx.delete(folder);
        return;
      }

      // The folder and every folder under it, parents before children.
      const order = [folder];
      for (let i = 0; i < order.length; i++) {
        for (const sub of tx.findRecordsByFilter("categories", "parent = {:id}", "", 0, 0, { id: order[i].id })) order.push(sub);
      }
      for (const f of order) {
        for (const item of tx.findRecordsByFilter("items", "category = {:id}", "", 0, 0, { id: f.id })) {
          if (used(item.id)) {
            item.set("archived", true);
            item.set("category", parent);
            tx.save(item);
            result.archived++;
          } else {
            tx.delete(item); // its units and kit links go with it
            result.deleted++;
          }
        }
      }
      for (let i = order.length - 1; i >= 0; i--) tx.delete(order[i]);
    });

    logEvent(ctx.orgId, "folder_deleted", whoName(e.auth), {
      folder: folder.getString("name"),
      contents: contents,
      deleted: result.deleted,
      archived: result.archived,
      moved: result.moved,
    });
    return e.json(200, result);
  },
  $apis.requireAuth("users"),
);
