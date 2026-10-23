#!/usr/bin/env node
// A stand-in for the Rentman API, for trying the import and live sync
// without touching a real Rentman account. Point PocketBase at it:
//
//   node scripts/mock-rentman.mjs                 # http://127.0.0.1:4100
//   RENTMAN_BASE_URL=http://127.0.0.1:4100 pnpm dev:pb
//
// Any API token works. It serves the lists the import reads (with
// Rentman's 1500-row cursor paging), single records, and the writes the
// sync makes (PUT/POST equipment and contacts, project requests). Every
// write bumps the record's `modified`. Test helpers:
//   POST /_mock/edit/{resource}/{id}   body: fields to change, as if edited in Rentman
//   POST /_mock/webhook                body: { url, eventType, itemType, ids }
//                                      sends Rentman-style webhook to R2
//   GET  /_mock/log                    the writes R2 made
//   POST /_mock/reset                  back to the seed data
import http from "node:http";

const PORT = Number(process.env.PORT || 4100);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = Number(process.env.MOCK_PAGE_SIZE || 1500);

function seed() {
  const t = "2026-10-01T09:00:00+00:00";
  const d = (days) => new Date(Date.now() + days * 86400000).toISOString();
  return {
    folders: [
      { id: 1, name: "Audio", parent: null, modified: t },
      { id: 2, name: "Speakers", parent: "/folders/1", modified: t },
      { id: 3, name: "Lighting", parent: null, modified: t },
    ],
    stocklocations: [{ id: 1, displayname: "Main warehouse", modified: t }],
    extrainputfields: [{ id: 7, itemtype: "Materiaal", displayname: "Supplier", modified: t }],
    equipment: [
      { id: 101, name: "QSC K12.2", displayname: "QSC K12.2", code: "K12", folder: "/folders/2", price: 85, weight: 17.7, power: 2000, qrcodes: "", location_in_warehouse: "A1", external_remark: "12\" powered speaker", internal_remark: "", in_archive: false, current_quantity: null, custom: { custom_7: "QSC NZ" }, modified: t },
      { id: 102, name: "Shure SM58", displayname: "Shure SM58", code: "SM58", folder: "/folders/1", price: 12, weight: 0.3, power: 0, qrcodes: "", location_in_warehouse: "B2", external_remark: "", internal_remark: "", in_archive: false, current_quantity: 24, custom: {}, modified: t },
      { id: 103, name: "Chauvet Rogue R2", displayname: "Chauvet Rogue R2", code: "ROGUE", folder: "/folders/3", price: 95, weight: 13, power: 330, qrcodes: "", location_in_warehouse: "", external_remark: "", internal_remark: "", in_archive: false, current_quantity: 8, custom: {}, modified: t },
    ],
    serialnumbers: [
      { id: 501, equipment: "/equipment/101", serial: "K12-0001", displayname: "K12 #1", qrcodes: "RM501", active: true, asset_location: "/stocklocations/1", modified: t },
      { id: 502, equipment: "/equipment/101", serial: "K12-0002", displayname: "K12 #2", qrcodes: "RM502", active: true, asset_location: "/stocklocations/1", modified: t },
    ],
    stockmovements: [],
    contacts: [
      { id: 201, type: "company", name: "Big Events Ltd", displayname: "Big Events Ltd", email_1: "hello@bigevents.example", phone_1: "09 555 0101", invoice_street: "1 Queen St", invoice_city: "Auckland", contact_warning: "", modified: t },
      { id: 202, type: "company", name: "Town Hall", displayname: "Town Hall", phone_1: "09 555 0202", visit_street: "301 Queen St", visit_city: "Auckland", modified: t },
    ],
    contactpersons: [{ id: 301, contact: "/contacts/201", firstname: "Sam", lastname: "Lee", displayname: "Sam Lee", email: "sam@bigevents.example", phone: "021 555 0303", modified: t }],
    statuses: [{ id: 1, name: "Confirmed", modified: t }, { id: 2, name: "Option", modified: t }],
    projects: [{ id: 401, number: 2001, name: "Annual Gala", displayname: "Annual Gala", customer: "/contacts/201", location: "/contacts/202", reference: "PO 778", planperiod_start: d(10), planperiod_end: d(12), usageperiod_start: d(10.5), usageperiod_end: d(11.5), modified: t }],
    subprojects: [{ id: 451, project: "/projects/401", order: 1, status: "/statuses/1", location: "/contacts/202", discount_rental: 0, discount_subproject: 0, modified: t }],
    projectequipmentgroup: [{ id: 601, project: "/projects/401", subproject: "/subprojects/451", name: "Audio", order: 1, modified: t }],
    projectequipment: [
      { id: 701, equipment_group: "/projectequipmentgroup/601", equipment: "/equipment/101", name: "QSC K12.2", quantity: 2, unit_price: 85, factor: 1.5, discount: 0, order: 1, is_option: false, parent: null, modified: t },
      { id: 702, equipment_group: "/projectequipmentgroup/601", equipment: "/equipment/102", name: "Shure SM58", quantity: 4, unit_price: 12, factor: 1.5, discount: 0.1, order: 2, is_option: false, parent: null, modified: t },
    ],
    projectrequests: [],
    projectrequestequipment: [],
  };
}

let db = seed();
let log = [];
let nextId = 9000;

const WRITABLE = { equipment: true, contacts: true, projectrequests: true };

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function onlyFields(row, fields) {
  if (!fields) return row;
  const out = {};
  for (const f of fields.split(",")) if (f in row) out[f] = row[f];
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "_mock") {
    if (req.method === "GET" && parts[1] === "log") return send(res, 200, log);
    if (req.method === "POST" && parts[1] === "reset") {
      db = seed();
      log = [];
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && parts[1] === "edit") {
      const row = (db[parts[2]] || []).find((r) => String(r.id) === parts[3]);
      if (!row) return send(res, 404, { error: "not found" });
      Object.assign(row, await readBody(req), { modified: new Date().toISOString() });
      return send(res, 200, row);
    }
    // Someone accepting a project request in Rentman: it becomes a project.
    if (req.method === "POST" && parts[1] === "accept") {
      const request = db.projectrequests.find((r) => String(r.id) === parts[2]);
      if (!request) return send(res, 404, { error: "no such request" });
      const project = {
        id: nextId++,
        number: 3000 + db.projects.length,
        name: request.name,
        displayname: request.name,
        customer: request.customer || null,
        location: request.location || null,
        planperiod_start: request.planperiod_start,
        planperiod_end: request.planperiod_end,
        usageperiod_start: request.usageperiod_start,
        usageperiod_end: request.usageperiod_end,
        modified: new Date().toISOString(),
      };
      db.projects.push(project);
      return send(res, 200, project);
    }
    if (req.method === "POST" && parts[1] === "webhook") {
      const b = await readBody(req);
      const payload = { account: "mock", user: null, eventType: b.eventType || "update", itemType: b.itemType, items: (b.ids || []).map((id) => ({ id, ref: `/${b.itemType}/${id}` })) };
      const r = await fetch(b.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      return send(res, 200, { status: r.status, body: await r.text() });
    }
    return send(res, 404, { error: "unknown mock route" });
  }

  if (!/^Bearer .+/.test(req.headers.authorization || "")) return send(res, 401, { error: "no token" });
  const [resource, id, sub] = parts;
  const list = db[resource];
  if (!list) return send(res, 404, { error: `unknown resource ${resource}` });

  if (req.method === "GET" && !id) {
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Math.min(PAGE, Number(url.searchParams.get("limit") || PAGE));
    const data = list.slice(offset, offset + limit).map((r) => onlyFields(r, url.searchParams.get("fields")));
    const next = offset + limit < list.length ? `${BASE}/${resource}?limit=${limit}&offset=${offset + limit}` : null;
    return send(res, 200, { data, next_page_url: next });
  }
  if (req.method === "GET" && id) {
    const row = list.find((r) => String(r.id) === id);
    return row ? send(res, 200, { data: row }) : send(res, 404, { error: "not found" });
  }
  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: "bad json" });
    if (resource === "projectrequests" && id && sub === "projectrequestequipment") {
      const row = { id: nextId++, projectrequest: `/projectrequests/${id}`, ...body, modified: new Date().toISOString() };
      db.projectrequestequipment.push(row);
      log.push({ method: "POST", path: url.pathname, body });
      return send(res, 200, { data: row });
    }
    if (id || !WRITABLE[resource]) return send(res, 405, { error: "not allowed" });
    const row = { id: nextId++, ...body, displayname: body.name, modified: new Date().toISOString() };
    list.push(row);
    log.push({ method: "POST", path: url.pathname, body });
    return send(res, 200, { data: row });
  }
  if (req.method === "PUT" && id) {
    if (!WRITABLE[resource]) return send(res, 405, { error: "not allowed" });
    const row = list.find((r) => String(r.id) === id);
    if (!row) return send(res, 404, { error: "not found" });
    const body = await readBody(req);
    Object.assign(row, body, { modified: new Date().toISOString() });
    if (body.name) row.displayname = body.name;
    log.push({ method: "PUT", path: url.pathname, body });
    return send(res, 200, { data: row });
  }
  return send(res, 405, { error: "not allowed" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Mock Rentman on ${BASE}`));
