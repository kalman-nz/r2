#!/usr/bin/env node
// A stand-in for the Momentus Enterprise API, built to the same assumed
// shape as pocketbase/pb_hooks/lib/momentus.js (not checked against a real
// instance), for trying the Momentus sync locally:
//
//   node scripts/mock-momentus.mjs               # http://127.0.0.1:4200
//   R2_ALLOW_HTTP_MOMENTUS=1 pnpm dev:pb
//
// In Settings → Integrations → Momentus use address http://127.0.0.1:4200,
// organisation code 10, API user R2API and secret mock-secret.
// MOCK_MOMENTUS_DENY_RESOURCES=1 refuses resource writes (403), like an
// instance without that licence. Test helpers:
//   GET  /_mock/log      the writes R2 made
//   GET  /_mock/state    every record
//   POST /_mock/edit/{collection}/{key}  body: fields to change
//   POST /_mock/reset
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 4200);
const SECRET = process.env.MOCK_MOMENTUS_SECRET || "mock-secret";
const USER = process.env.MOCK_MOMENTUS_USER || "R2API";
const DENY_RESOURCES = process.env.MOCK_MOMENTUS_DENY_RESOURCES === "1";

function day(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10) + "T00:00:00";
}

function seed() {
  return {
    Events: [
      { ID: 5001, Description: "Tech Summit 2026", Status: "40", StatusDescription: "Definite", StartDate: day(14), StartTime: "1900-01-01T08:00:00", EndDate: day(15), EndTime: "1900-01-01T17:30:00", Account: "ACME", ChangedOn: new Date().toISOString() },
      { ID: 5002, Description: "Charity Ball", Status: "30", StatusDescription: "Tentative", StartDate: day(30), StartTime: "1900-01-01T18:00:00", EndDate: day(30), EndTime: "1900-01-01T23:59:00", Account: "HOPE", ChangedOn: new Date().toISOString() },
    ],
    Functions: [
      { Event: 5001, Function: 1, Description: "Plenary", Space: "GH", StartDate: day(14), StartTime: "1900-01-01T08:00:00", EndDate: day(14), EndTime: "1900-01-01T17:30:00" },
      { Event: 5001, Function: 2, Description: "Breakouts", Space: "R1", StartDate: day(15), StartTime: "1900-01-01T09:00:00", EndDate: day(15), EndTime: "1900-01-01T16:00:00" },
      { Event: 5002, Function: 1, Description: "Dinner", Space: "GH", StartDate: day(30), StartTime: "1900-01-01T18:00:00", EndDate: day(30), EndTime: "1900-01-01T23:59:00" },
    ],
    Accounts: [
      { Account: "ACME", Name: "Acme Conferences", Email: "events@acme.example", Phone: "09 555 1000", Address1: "10 Customs St", City: "Auckland", Country: "NZ" },
      { Account: "HOPE", Name: "Hope Foundation", Email: "ball@hope.example", Phone: "09 555 2000", City: "Auckland" },
    ],
    Spaces: [
      { Space: "GH", Description: "Grand Hall" },
      { Space: "R1", Description: "Room 1" },
    ],
    Orders: [{ OrderNumber: 9001, Event: 5001, Department: "AV", OrderType: "AV", Description: "AV for plenary", Status: "O" }],
    OrderItems: [
      { OrderNumber: 9001, OrderLine: 1, Resource: "K12", Description: "QSC K12.2 speaker", Quantity: 4, Price: 85 },
      { OrderNumber: 9001, OrderLine: 2, Resource: "PROJ-10K", Description: "10K projector", Quantity: 1, Price: 450 },
    ],
    Resources: [],
  };
}

let db = seed();
let log = [];
let nextOrder = 9100;

const KEYS = { Events: "ID", Accounts: "Account", Spaces: "Space", Orders: "OrderNumber", Resources: "Code" };

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

function verifyJwt(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!s) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (expected !== s) return false;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  return payload.iss === USER && (!payload.exp || payload.exp * 1000 > Date.now());
}

const sessions = new Set();

// "Event eq 5001" / "OrderNumber eq 9001" → filter; date ranges are ignored.
function applySearch(rows, search) {
  const m = /^(\w+) eq '?([^']+)'?$/.exec(String(search || "").trim());
  if (!m) return rows;
  return rows.filter((r) => String(r[m[1]]) === m[2]);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "_mock") {
    if (parts[1] === "log") return send(res, 200, log);
    if (parts[1] === "state") return send(res, 200, db);
    if (parts[1] === "reset") {
      db = seed();
      log = [];
      return send(res, 200, { ok: true });
    }
    if (parts[1] === "edit") {
      const rows = db[parts[2]] || [];
      const row = rows.find((r) => String(r[KEYS[parts[2]]]) === parts[3]);
      if (!row) return send(res, 404, { error: "not found" });
      Object.assign(row, await readBody(req), { ChangedOn: new Date().toISOString() });
      return send(res, 200, row);
    }
  }

  const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (url.pathname === "/api/v1/sdk_initialize") {
    if (!verifyJwt(auth)) return send(res, 401, { Message: "Invalid JWT" });
    const token = crypto.randomBytes(16).toString("hex");
    sessions.add(token);
    return send(res, 200, { Token: token });
  }
  if (!sessions.has(auth)) return send(res, 401, { Message: "Not signed in" });

  // /api/v1/{Collection}/{org}/{key}/{line}
  const [, , collection, org, key, line] = parts;
  if (org !== "10") return send(res, 404, { Message: "Unknown organisation" });
  const rows = db[collection];
  if (!rows) return send(res, 404, { Message: "Unknown endpoint" });

  if (req.method === "GET") {
    if (key) {
      const row = rows.find((r) => String(r[KEYS[collection]]) === key);
      return row ? send(res, 200, row) : send(res, 404, { Message: "Not found" });
    }
    const page = Number(url.searchParams.get("page") || 1);
    const size = Number(url.searchParams.get("pageSize") || 100);
    const found = applySearch(rows, url.searchParams.get("search"));
    return send(res, 200, found.slice((page - 1) * size, page * size));
  }

  const body = req.method === "DELETE" ? {} : await readBody(req);
  log.push({ method: req.method, path: url.pathname, body });
  if (collection === "Resources" && DENY_RESOURCES) return send(res, 403, { Message: "Not licensed" });

  if (req.method === "POST" && collection === "Orders") {
    const order = { OrderNumber: nextOrder++, Status: "O", ...body };
    rows.push(order);
    return send(res, 200, order);
  }
  if (req.method === "POST" && collection === "OrderItems") {
    const lines = rows.filter((r) => String(r.OrderNumber) === String(body.OrderNumber)).map((r) => r.OrderLine);
    const item = { ...body, OrderLine: (lines.length ? Math.max(...lines) : 0) + 1 };
    rows.push(item);
    return send(res, 200, item);
  }
  if (req.method === "DELETE" && collection === "OrderItems") {
    const i = rows.findIndex((r) => String(r.OrderNumber) === key && String(r.OrderLine) === line);
    if (i === -1) return send(res, 404, { Message: "Not found" });
    rows.splice(i, 1);
    return send(res, 200, {});
  }
  if (req.method === "POST" && collection === "Resources") {
    rows.push(body);
    return send(res, 200, body);
  }
  if (req.method === "PUT" && key) {
    const row = rows.find((r) => String(r[KEYS[collection]]) === key);
    if (!row) return send(res, 404, { Message: "Not found" });
    Object.assign(row, body);
    return send(res, 200, row);
  }
  return send(res, 405, { Message: "Not allowed" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`Mock Momentus on http://127.0.0.1:${PORT} (org 10, user ${USER}, secret ${SECRET})`));
