/// <reference path="../pb_data/types.d.ts" />
// Everyone's own dashboards (Home pages) and saved list views, shared with
// people or with everyone (lib/views.js, lib/sharing.js). Anyone in the
// organisation can make their own; publishing needs views.publish.

// Every dashboard you can see, which one's your Home, and the
// organisation's default (for people who haven't picked).
routerAdd(
  "GET",
  "/api/dashboards",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { VISIBLE, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { dashboardJson, createDefaultDashboards } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    createDefaultDashboards($app, ctx.orgId);
    const records = $app.findRecordsByFilter("dashboards", VISIBLE, "name", 0, 0, { org: ctx.orgId, me: e.auth.id });
    const names = namesFor($app, records);
    const home = ctx.membership.getString("homeDashboard");
    const fallback = records.find((r) => r.getBool("isDefault")) || records.find((r) => !r.getString("owner")) || records[0];
    return e.json(200, {
      dashboards: records.map((r) => dashboardJson(ctx, e.auth.id, r, names)),
      home: records.some((r) => r.id === home) ? home : "",
      defaultId: fallback ? fallback.id : "",
    });
  },
  $apis.requireAuth("users"),
);

// { name, panels, sharedWith?, public? }: a new dashboard of your own.
routerAdd(
  "POST",
  "/api/dashboards",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { cleanName, cleanPanels, dashboardJson } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    const body = e.requestInfo().body || {};
    const record = new Record($app.findCollectionByNameOrId("dashboards"), {
      org: ctx.orgId,
      owner: e.auth.id,
      name: cleanName(body.name),
      panels: cleanPanels(body.panels),
    });
    applySharing($app, ctx, record, body);
    $app.save(record);
    return e.json(200, dashboardJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

// { name?, panels?, sharedWith?, public?, isDefault? }. isDefault makes it
// everyone's Home until they pick another (public ones only).
routerAdd(
  "PATCH",
  "/api/dashboards/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit, applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { cleanName, cleanPanels, dashboardJson } = require(`${__hooks}/lib/views.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const record = findOrNull($app, "dashboards", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("Dashboard not found");
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    const body = e.requestInfo().body || {};
    const wasPublic = record.getBool("public");
    $app.runInTransaction((tx) => {
      if (body.name !== undefined) record.set("name", cleanName(body.name));
      if (body.panels !== undefined) record.set("panels", cleanPanels(body.panels));
      applySharing(tx, ctx, record, body);
      if (body.isDefault !== undefined && !!body.isDefault !== record.getBool("isDefault")) {
        if (!ctx.can("views.publish")) throw new ForbiddenError("Only people who can share with everyone can pick everyone's Home");
        if (body.isDefault) {
          if (!record.getBool("public")) throw new BadRequestError("Share it with everyone first");
          for (const other of tx.findRecordsByFilter("dashboards", "org = {:org} && isDefault = true", "", 0, 0, { org: ctx.orgId })) {
            other.set("isDefault", false);
            tx.save(other);
          }
        }
        record.set("isDefault", !!body.isDefault);
      }
      if (record.getBool("isDefault") && !record.getBool("public")) throw new BadRequestError("Everyone's Home has to be shared with everyone: pick another first");
      tx.save(record);
    });
    if (record.getBool("public") !== wasPublic) {
      logEvent(ctx.orgId, "view_published", whoName(e.auth), { kind: "dashboard", name: record.getString("name"), public: record.getBool("public") });
    }
    return e.json(200, dashboardJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/dashboards/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit } = require(`${__hooks}/lib/sharing.js`);
    const record = findOrNull($app, "dashboards", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("Dashboard not found");
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    if (record.getBool("isDefault")) throw new BadRequestError("It's everyone's Home: pick another default first");
    $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// Your Home in this organisation: { dashboard: id } (one you can see), or
// "" for the organisation's default.
routerAdd(
  "PUT",
  "/api/me/home",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { VISIBLE } = require(`${__hooks}/lib/sharing.js`);
    const ctx = requireOrg(e);
    const id = String((e.requestInfo().body || {}).dashboard || "");
    if (id) {
      const seen = $app.findRecordsByFilter("dashboards", VISIBLE + " && id = {:id}", "", 1, 0, { org: ctx.orgId, me: e.auth.id, id: id });
      if (seen.length === 0) throw new NotFoundError("Dashboard not found");
    }
    ctx.membership.set("homeDashboard", id);
    $app.save(ctx.membership);
    return e.json(200, { home: id });
  },
  $apis.requireAuth("users"),
);

// Saved views of a list (?page=projects) you can see.
routerAdd(
  "GET",
  "/api/views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { VISIBLE, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { listViewJson, PAGES } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    const page = String(e.requestInfo().query.page || "");
    if (PAGES.indexOf(page) === -1) throw new BadRequestError("Which page?");
    const records = $app.findRecordsByFilter("list_views", VISIBLE + " && page = {:page}", "name", 0, 0, { org: ctx.orgId, me: e.auth.id, page: page });
    const names = namesFor($app, records);
    return e.json(200, records.map((r) => listViewJson(ctx, e.auth.id, r, names)));
  },
  $apis.requireAuth("users"),
);

// { page, name, config, sharedWith?, public? }
routerAdd(
  "POST",
  "/api/views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { cleanName, cleanConfig, listViewJson, PAGES } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    const body = e.requestInfo().body || {};
    if (PAGES.indexOf(body.page) === -1) throw new BadRequestError("Which page?");
    const record = new Record($app.findCollectionByNameOrId("list_views"), {
      org: ctx.orgId,
      owner: e.auth.id,
      page: body.page,
      name: cleanName(body.name),
      config: cleanConfig(body.config),
    });
    applySharing($app, ctx, record, body);
    $app.save(record);
    return e.json(200, listViewJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

// { name?, config?, sharedWith?, public? }
routerAdd(
  "PATCH",
  "/api/views/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit, applySharing, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { cleanName, cleanConfig, listViewJson } = require(`${__hooks}/lib/views.js`);
    const { whoName } = require(`${__hooks}/lib/auth.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const record = findOrNull($app, "list_views", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("View not found");
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    const body = e.requestInfo().body || {};
    const wasPublic = record.getBool("public");
    if (body.name !== undefined) record.set("name", cleanName(body.name));
    if (body.config !== undefined) record.set("config", cleanConfig(body.config));
    applySharing($app, ctx, record, body);
    $app.save(record);
    if (record.getBool("public") !== wasPublic) {
      logEvent(ctx.orgId, "view_published", whoName(e.auth), { kind: "view", name: record.getString("name"), public: record.getBool("public") });
    }
    return e.json(200, listViewJson(ctx, e.auth.id, record, namesFor($app, [record])));
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/views/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { requireEdit } = require(`${__hooks}/lib/sharing.js`);
    const record = findOrNull($app, "list_views", e.request.pathValue("id"));
    if (!record) throw new NotFoundError("View not found");
    const ctx = requireRecordOrg(e, record);
    requireEdit(ctx, e.auth.id, record);
    $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// For dashboards' "To prep next": how much of each project's physical kit
// is needed and how much is out, by project. ?jobs=id,id,…
routerAdd(
  "GET",
  "/api/home/packing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const ctx = requireOrg(e);
    const ids = String(e.requestInfo().query.jobs || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const out = {};
    if (ids.length === 0) return e.json(200, out);
    const params = { org: ctx.orgId };
    const placeholders = ids.map((id, i) => {
      params["j" + i] = id;
      return "{:j" + i + "}";
    });
    const list = placeholders.join(", ");
    for (const id of ids) out[id] = { needed: 0, out: 0 };
    const needed = arrayOf(new DynamicModel({ job: "", n: 0 }));
    $app
      .db()
      .newQuery("SELECT jl.job AS job, CAST(SUM(ROUND(jl.quantity)) AS INTEGER) AS n FROM job_lines jl JOIN items i ON i.id = jl.item WHERE jl.org = {:org} AND jl.job IN (" + list + ") AND i.kind = 'item' GROUP BY jl.job")
      .bind(params)
      .all(needed);
    for (const r of needed) if (out[r.job]) out[r.job].needed = r.n;
    const scanned = arrayOf(new DynamicModel({ job: "", n: 0 }));
    $app
      .db()
      .newQuery("SELECT job, CAST(SUM(CASE WHEN direction = 'out' THEN quantity ELSE -quantity END) AS INTEGER) AS n FROM scans WHERE org = {:org} AND job IN (" + list + ") GROUP BY job")
      .bind(params)
      .all(scanned);
    for (const r of scanned) if (out[r.job]) out[r.job].out = Math.max(0, r.n);
    return e.json(200, out);
  },
  $apis.requireAuth("users"),
);
