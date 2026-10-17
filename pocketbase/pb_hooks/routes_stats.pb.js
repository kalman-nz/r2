/// <reference path="../pb_data/types.d.ts" />
// The organisation's headline numbers, for its admins (Logs page).
routerAdd(
  "GET",
  "/api/stats",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { toPbDate } = require(`${__hooks}/lib/time.js`);
    const ctx = requireOrg(e, "logs.view");
    const rows = arrayOf(
      new DynamicModel({
        items: 0,
        kits: 0,
        bulkUnits: -0,
        activeSerials: 0,
        upcomingJobs: 0,
        contacts: 0,
        labelTemplates: 0,
        labelsPrinted: 0,
        users: 0,
      }),
    );
    $app
      .db()
      .newQuery(
        "SELECT " +
          "(SELECT COUNT(*) FROM items WHERE org = {:org} AND kind = 'item' AND archived = FALSE) AS items, " +
          "(SELECT COUNT(*) FROM items WHERE org = {:org} AND kind = 'kit' AND archived = FALSE) AS kits, " +
          "(SELECT COALESCE(SUM(stockQty), 0) FROM items WHERE org = {:org} AND kind = 'item' AND tracking = 'bulk' AND archived = FALSE) AS bulkUnits, " +
          "(SELECT COUNT(*) FROM serials WHERE org = {:org} AND status = 'active') AS activeSerials, " +
          "(SELECT COUNT(*) FROM jobs WHERE org = {:org} AND returnAt >= {:now} AND status NOT IN ('cancelled', 'returned')) AS upcomingJobs, " +
          "(SELECT COUNT(*) FROM contacts WHERE org = {:org} AND archived = FALSE) AS contacts, " +
          "(SELECT COUNT(*) FROM label_templates WHERE org = {:org}) AS labelTemplates, " +
          "(SELECT COUNT(*) FROM logs WHERE org = {:org} AND type = 'print') AS labelsPrinted, " +
          "(SELECT COUNT(*) FROM memberships WHERE org = {:org}) AS users",
      )
      .bind({ org: ctx.orgId, now: toPbDate(Date.now()) })
      .all(rows);
    const r = rows[0];
    return e.json(200, {
      items: r.items,
      kits: r.kits,
      stockUnits: Math.round(r.bulkUnits) + r.activeSerials,
      serials: r.activeSerials,
      upcomingJobs: r.upcomingJobs,
      contacts: r.contacts,
      labelTemplates: r.labelTemplates,
      labelsPrinted: r.labelsPrinted,
      users: r.users,
    });
  },
  $apis.requireAuth("users"),
);
