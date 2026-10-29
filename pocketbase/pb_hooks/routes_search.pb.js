/// <reference path="../pb_data/types.d.ts" />
// Backs the header's global search box (web/src/components/GlobalSearch.tsx)
// — one endpoint across the app's main named things (inventory items,
// individual units, jobs, contacts, label templates) instead of separate
// lookups. Every match is a case-insensitive substring check (PocketBase's
// ~ operator), not fuzzy — predictable for barcode-scanned exact values too.
// A job number ("1042" or "#1042") matches that job directly.
routerAdd(
  "GET",
  "/api/search",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e);
    const term = (e.requestInfo().query.q || "").trim();
    const empty = { items: [], assets: [], jobs: [], contacts: [], labels: [] };
    if (!term) return e.json(200, empty);
    const LIMIT = 8;
    const p = { q: term, org: ctx.orgId };

    const found = $app.findRecordsByFilter("items", "org = {:org} && archived = false && (name ~ {:q} || code ~ {:q} || barcode ~ {:q})", "name", LIMIT, 0, p);
    const places = require(`${__hooks}/lib/stock.js`).placesOf($app, found);
    const items = found
      .map((it) => ({
        id: it.id,
        name: it.getString("name"),
        subtitle: [it.getString("code"), it.getString("kind") === "kit" ? "Kit" : places[it.id]]
          .filter(Boolean)
          .join(" · "),
      }));

    const serials = $app.findRecordsByFilter("serials", "org = {:org} && (barcode ~ {:q} || serialNumber ~ {:q} || label ~ {:q})", "barcode", LIMIT, 0, p);
    const itemNames = {};
    for (const it of $app.findRecordsByIds("items", serials.map((s) => s.getString("item")))) {
      if (it) itemNames[it.id] = it.getString("name");
    }
    const assets = serials.map((s) => ({
      id: s.id,
      name: itemNames[s.getString("item")] || "(deleted item)",
      subtitle: [s.getString("label") || s.getString("barcode"), s.getString("serialNumber"), s.getString("status") === "active" ? "" : s.getString("status")]
        .filter(Boolean)
        .join(" · "),
    }));

    // Projects and contacts only while the organisation uses them.
    const projectsOn = require(`${__hooks}/lib/features.js`).featuresOf(ctx.org).projects;
    const number = Number(term.replace(/^#/, ""));
    const byNumber = Number.isInteger(number) && number > 0;
    const jobs = !projectsOn ? [] : $app
      .findRecordsByFilter(
        "jobs",
        byNumber ? "org = {:org} && (number = {:n} || name ~ {:q} || reference ~ {:q})" : "org = {:org} && (name ~ {:q} || reference ~ {:q})",
        "-prepAt",
        LIMIT,
        0,
        byNumber ? { q: term, n: number, org: ctx.orgId } : p,
      )
      .map((j) => ({
        id: j.id,
        name: j.getString("name"),
        subtitle: ["#" + j.getInt("number"), j.getString("status"), j.getString("prepAt").slice(0, 10)].join(" · "),
      }));

    const contacts = !projectsOn ? [] : $app
      .findRecordsByFilter("contacts", "org = {:org} && archived = false && (name ~ {:q} || email ~ {:q} || contactPerson ~ {:q})", "name", LIMIT, 0, p)
      .map((c) => ({
        id: c.id,
        name: c.getString("name"),
        subtitle: [c.getString("contactPerson"), c.getString("email")].filter(Boolean).join(" · "),
      }));

    const labels = $app.findRecordsByFilter("label_templates", "org = {:org} && name ~ {:q}", "name", LIMIT, 0, p).map((l) => ({
      id: l.id,
      name: l.getString("name"),
      subtitle: l.getFloat("widthMm") + " × " + l.getFloat("heightMm") + " mm",
    }));

    return e.json(200, { items: items, assets: assets, jobs: jobs, contacts: contacts, labels: labels });
  },
  $apis.requireAuth("users"),
);
