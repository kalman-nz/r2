/// <reference path="../pb_data/types.d.ts" />

// Stock rows (item_stock, 0043) are saved without hooks, which skipped
// PocketBase's created/updated stamps until lib/stock.js set them itself
// (saveRow). Rows from before then have neither, so lists sorted by created
// came back in any order. Give them one: a second apart, in the order they
// were added, ending now.

migrate(
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE item_stock SET " +
          "created = strftime('%Y-%m-%d %H:%M:%fZ', 'now', printf('-%d seconds', (SELECT MAX(rowid) FROM item_stock) - rowid)), " +
          "updated = strftime('%Y-%m-%d %H:%M:%fZ', 'now') " +
          "WHERE created = '' OR created IS NULL",
      )
      .execute();
  },
  () => {
    // Nothing to undo: the dates are just filled in.
  },
);
