/// <reference path="../pb_data/types.d.ts" />

// Not everything is hired by the day: some kit goes out by the hour or the
// week, and consumables are sold.
//
//   items.dayRate → price  the item's price (values kept)
//   items.priceUnit        what the price is per: hour, day, week or each
//                          (sold, charged once per unit). Empty means day,
//                          which is what every existing item was.
//   job_lines.priceMode    gains per_hour and per_week next to per_day and
//                          fixed (lib/pricing.js lineAmounts)

migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items");
    items.fields.getByName("dayRate").name = "price";
    items.fields.add(new SelectField({ name: "priceUnit", values: ["hour", "day", "week", "each"], maxSelect: 1 }));
    app.save(items);

    const lines = app.findCollectionByNameOrId("job_lines");
    lines.fields.getByName("priceMode").values = ["per_hour", "per_day", "per_week", "fixed"];
    app.save(lines);
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items");
    items.fields.getByName("price").name = "dayRate";
    items.fields.removeByName("priceUnit");
    app.save(items);

    const lines = app.findCollectionByNameOrId("job_lines");
    lines.fields.getByName("priceMode").values = ["per_day", "fixed"];
    app.save(lines);
  },
);
