/// <reference path="../pb_data/types.d.ts" />

// One name per organisation: the businessName setting folds into the
// organisation's own name (Settings → Business details edits it). Where the
// two differed, the business name wins: it's the one on quotes.

migrate(
  (app) => {
    for (const row of app.findRecordsByFilter("settings", "key = 'businessName'", "", 0, 0)) {
      const name = row.getString("value").trim();
      if (name) {
        try {
          const org = app.findRecordById("organisations", row.getString("org"));
          if (org.getString("name") !== name) {
            org.set("name", name);
            app.save(org);
          }
        } catch (_) {
          // a row left behind by a deleted organisation
        }
      }
      app.delete(row);
    }
  },
  (app) => {
    const settings = app.findCollectionByNameOrId("settings");
    for (const org of app.findRecordsByFilter("organisations", "", "", 0, 0)) {
      app.save(new Record(settings, { org: org.id, key: "businessName", value: org.getString("name") }));
    }
  },
);
