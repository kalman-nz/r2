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

// A list page's saved views (?page=inventory) you can see, which one you've
// picked (an id, "standard" for the page as it comes, or "" to follow the
// organisation's default) and that default.
routerAdd(
  "GET",
  "/api/views",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { decodeJson } = require(`${__hooks}/lib/records.js`);
    const { VISIBLE, namesFor } = require(`${__hooks}/lib/sharing.js`);
    const { listViewJson, PAGES } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    const page = String(e.requestInfo().query.page || "");
    if (PAGES.indexOf(page) === -1) throw new BadRequestError("Which page?");
    const records = $app.findRecordsByFilter("list_views", VISIBLE + " && page = {:page}", "name", 0, 0, { org: ctx.orgId, me: e.auth.id, page: page });
    const names = namesFor($app, records);
    const picked = String(decodeJson(ctx.membership.get("views"), {})[page] || "");
    const fallback = records.find((r) => r.getBool("isDefault"));
    return e.json(200, {
      views: records.map((r) => listViewJson(ctx, e.auth.id, r, names)),
      pick: picked === "standard" || records.some((r) => r.id === picked) ? picked : "",
      defaultId: fallback ? fallback.id : "",
    });
  },
  $apis.requireAuth("users"),
);

// Your view of a list page in this organisation: { view: id } (one you can
// see), "standard", or "" for the organisation's default.
routerAdd(
  "PUT",
  "/api/me/views/{page}",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { decodeJson } = require(`${__hooks}/lib/records.js`);
    const { VISIBLE } = require(`${__hooks}/lib/sharing.js`);
    const { PAGES } = require(`${__hooks}/lib/views.js`);
    const ctx = requireOrg(e);
    const page = e.request.pathValue("page");
    if (PAGES.indexOf(page) === -1) throw new BadRequestError("Which page?");
    const id = String((e.requestInfo().body || {}).view || "");
    if (id && id !== "standard") {
      const seen = $app.findRecordsByFilter("list_views", VISIBLE + " && page = {:page} && id = {:id}", "", 1, 0, { org: ctx.orgId, me: e.auth.id, page: page, id: id });
      if (seen.length === 0) throw new NotFoundError("View not found");
    }
    const views = decodeJson(ctx.membership.get("views"), {});
    if (id) views[page] = id;
    else delete views[page];
    ctx.membership.set("views", views);
    $app.save(ctx.membership);
    return e.json(200, { pick: id });
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

// { name?, config?, sharedWith?, public?, isDefault? }. isDefault makes it
// the page's view for everyone who hasn't picked one (shared with everyone
// only; one per page).
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
    const body = e.requestInfo().body || {};
    const onlyDefault = Object.keys(body).every((k) => k === "isDefault");
    // Publishers pick the default from anything shared with everyone.
    if (!(onlyDefault && ctx.can("views.publish"))) requireEdit(ctx, e.auth.id, record);
    const wasPublic = record.getBool("public");
    $app.runInTransaction((tx) => {
      if (body.name !== undefined) record.set("name", cleanName(body.name));
      if (body.config !== undefined) record.set("config", cleanConfig(body.config));
      applySharing(tx, ctx, record, body);
      if (body.isDefault !== undefined && !!body.isDefault !== record.getBool("isDefault")) {
        if (!ctx.can("views.publish")) throw new ForbiddenError("Only people who can share with everyone can pick the default view");
        if (body.isDefault) {
          if (!record.getBool("public")) throw new BadRequestError("Share it with everyone first");
          for (const other of tx.findRecordsByFilter("list_views", "org = {:org} && page = {:page} && isDefault = true", "", 0, 0, { org: ctx.orgId, page: record.getString("page") })) {
            other.set("isDefault", false);
            tx.save(other);
          }
        }
        record.set("isDefault", !!body.isDefault);
      }
      if (record.getBool("isDefault") && !record.getBool("public")) throw new BadRequestError("The default view has to be shared with everyone: pick another default first");
      tx.save(record);
    });
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
    if (record.getBool("isDefault")) throw new BadRequestError("It's the default view: pick another default first");
    $app.delete(record);
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// For dashboards' "To prep next": how much of each project's physical kit
// it needs, and how many units are at each tracking step (lib/tracking.js),
// by project. ?jobs=id,id,… (up to 30, the organisation's own).
routerAdd(
  "GET",
  "/api/home/packing",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { loadItems, loadLines } = require(`${__hooks}/lib/jobs.js`);
    const { needsOf } = require(`${__hooks}/lib/scan.js`);
    const { stepsOf, trackingState } = require(`${__hooks}/lib/tracking.js`);
    const ctx = requireOrg(e);
    const ids = String(e.requestInfo().query.jobs || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);
    const out = {};
    if (ids.length === 0) return e.json(200, out);
    const steps = stepsOf($app, ctx.orgId);
    for (const job of $app.findRecordsByIds("jobs", ids)) {
      if (!job || job.getString("org") !== ctx.orgId) continue;
      const lines = loadLines($app, job.id);
      const itemsById = loadItems($app, lines);
      const state = trackingState($app, job.id, needsOf(lines, itemsById), itemsById, steps);
      const at = {};
      let needed = 0;
      for (const item of state.items) {
        needed += item.needed;
        for (const step of Object.keys(item.at)) at[step] = (at[step] || 0) + item.at[step];
      }
      out[job.id] = { needed: needed, at: at };
    }
    return e.json(200, out);
  },
  $apis.requireAuth("users"),
);
