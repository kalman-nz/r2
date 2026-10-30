// Print agents (pb_migrations/0048_print_agents.js): getting labels from R2
// in the cloud to the Brother printers on a venue's own network, which the
// server can't reach. A small program at the venue (print/r2_print_agent.py,
// on a Raspberry Pi or the venue's server) signs in with its token, asks
// for labels (a long poll) and sends each to its printer.
//
// A printer goes through an agent when it names one (printers[].agentId,
// lib/printing.js). Printing to it (routes_print.pb.js) turns the label into
// the printer's own raster commands here, queues them in print_jobs, and
// waits for the agent to say how it went, so the app sees the same answers
// as printing straight from the server: printed, couldn't reach it (try the
// next printer) or failed.

const TOKEN_PREFIX = "r2pa_";
// The agent asks at least every 20 seconds (r2_print_agent.py), so one not
// heard from in a minute has gone.
const ONLINE_MS = 60 * 1000;
// A printer's reachability as the agent last saw it counts for this long.
const REPORT_MS = 3 * 60 * 1000;
// How long printing waits for the agent before giving up on it.
const WAIT_MS = 15 * 1000;

function hashToken(token) {
  return $security.sha256(String(token || ""));
}

function newToken() {
  return TOKEN_PREFIX + $security.randomStringWithAlphabet(32, "abcdefghijklmnopqrstuvwxyz0123456789");
}

function nowString() {
  return new Date().toISOString().replace("T", " ");
}

function msSince(value) {
  const { toMs } = require("./time.js");
  const at = value ? toMs(String(value)) : 0;
  return at ? Date.now() - at : Infinity;
}

function isOnline(agent) {
  return msSince(agent.getString("lastSeen")) < ONLINE_MS;
}

function reportOf(agent) {
  const { decodeJson } = require("./records.js");
  const report = decodeJson(agent.get("report"), {}) || {};
  return { printers: report.printers || {}, at: report.at || "", version: report.version || "", hostname: report.hostname || "" };
}

function agentsOf(app, org) {
  return app.findRecordsByFilter("print_agents", "org = {:org}", "created", 0, 0, { org: org });
}

function agentJson(agent) {
  const report = reportOf(agent);
  return {
    id: agent.id,
    name: agent.getString("name"),
    online: isOnline(agent),
    lastSeen: agent.getString("lastSeen"),
    hostname: report.hostname,
    version: report.version,
  };
}

function cleanName(name) {
  const clean = typeof name === "string" ? name.trim().slice(0, 80) : "";
  if (!clean) throw new BadRequestError("Give the agent a name, like Workshop Pi");
  return clean;
}

// A new agent and its token. The token is only ever shown now: R2 keeps
// its hash.
function createAgent(app, org, name, who) {
  const token = newToken();
  const agent = new Record(app.findCollectionByNameOrId("print_agents"), {
    org: org,
    name: cleanName(name),
    tokenHash: hashToken(token),
    createdBy: who ? who.id : "",
  });
  app.save(agent);
  return { agent: agent, token: token };
}

function renameAgent(app, agent, name) {
  agent.set("name", cleanName(name));
  app.save(agent);
  return agent;
}

// A new token, for an agent whose token is lost or leaked. The old one
// stops working straight away.
function rotateToken(app, agent) {
  const token = newToken();
  agent.set("tokenHash", hashToken(token));
  app.save(agent);
  return token;
}

// Printers still sending through it keep it.
function deleteAgent(app, agent) {
  const { printingConfig } = require("./printing.js");
  const using = printingConfig(agent.getString("org")).printers.filter((p) => p.agentId === agent.id);
  if (using.length > 0) {
    throw new BadRequestError(using.map((p) => p.name).join(", ") + (using.length === 1 ? " prints" : " print") + " through it: move " + (using.length === 1 ? "it" : "them") + " to another agent first");
  }
  app.delete(agent);
}

// The agent calling, from its token (Authorization: Bearer r2pa_…), with
// its organisation. Marks it as just heard from.
function agentForRequest(e) {
  const header = String(e.request.header.get("Authorization") || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token.indexOf(TOKEN_PREFIX) !== 0) throw new UnauthorizedError("Sign in with the agent's token");
  let agent;
  try {
    agent = $app.findFirstRecordByFilter("print_agents", "tokenHash = {:hash}", { hash: hashToken(token) });
  } catch (_) {
    throw new UnauthorizedError("That agent token isn't valid any more: make a new one in Printer setup");
  }
  const org = $app.findRecordById("organisations", agent.getString("org"));
  if (org.getBool("suspended")) throw new ForbiddenError("This organisation is suspended");
  agent.set("lastSeen", nowString());
  $app.save(agent);
  return { agent: agent, org: org };
}

// The organisation's printers that go through this agent, as the agent
// needs them.
function printersFor(agent) {
  const { printingConfig } = require("./printing.js");
  return printingConfig(agent.getString("org"))
    .printers.filter((p) => p.agentId === agent.id && p.enabled !== false && p.host)
    .map((p) => ({ id: p.id, name: p.name, host: p.host }));
}

// Moves a job on from one status only if it's still in it, in one go, so
// an agent and a waiting print never both act on it. Whether it moved.
function moveJob(app, id, from, to) {
  const result = app
    .db()
    .newQuery("UPDATE print_jobs SET status = {:to}, updated = {:now}" + (to === "cancelled" ? ", data = ''" : "") + " WHERE id = {:id} AND status = {:from}")
    .bind({ id: id, from: from, to: to, now: nowString() })
    .execute();
  return result.rowsAffected() === 1;
}

// Labels waiting for this agent, oldest first, marked as sent to it. Waits
// up to waitMs for one to turn up (the agent's long poll).
function claimJobs(app, agent, waitMs) {
  const until = Date.now() + Math.max(0, Math.min(waitMs, 25000));
  for (;;) {
    const jobs = app.findRecordsByFilter("print_jobs", "agent = {:agent} && status = 'queued'", "created", 20, 0, { agent: agent.id });
    const claimed = [];
    for (const job of jobs) {
      if (moveJob(app, job.id, "queued", "sent")) claimed.push({ id: job.id, host: job.getString("host"), data: job.getString("data") });
    }
    if (claimed.length > 0 || Date.now() >= until) return claimed;
    sleep(250);
  }
}

// The agent's word on a label: { ok, unreachable, message }.
function finishJob(app, agent, jobId, body) {
  let job;
  try {
    job = app.findRecordById("print_jobs", String(jobId || ""));
  } catch (_) {
    throw new NotFoundError("No such print job");
  }
  if (job.getString("agent") !== agent.id) throw new NotFoundError("No such print job");
  if (job.getString("status") === "cancelled") return;
  const ok = !!(body && body.ok);
  job.set("status", ok ? "done" : "failed");
  job.set("unreachable", !ok && !!(body && body.unreachable));
  job.set("message", String((body && body.message) || (ok ? "Printed" : "Didn't print")).slice(0, 1000));
  // The commands aren't needed once it's been tried.
  job.set("data", "");
  app.save(job);
}

// What the agent says about its printers: { printers: { id: { ok,
// message, host } }, version, hostname }.
function saveReport(app, agent, body) {
  const printers = {};
  const given = (body && body.printers) || {};
  for (const id in given) {
    const r = given[id] || {};
    printers[String(id).slice(0, 60)] = { ok: !!r.ok, message: String(r.message || "").slice(0, 200), host: String(r.host || "").slice(0, 255) };
  }
  agent.set("report", {
    printers: printers,
    at: nowString(),
    version: String((body && body.version) || "").slice(0, 20),
    hostname: String((body && body.hostname) || "").slice(0, 100),
  });
  app.save(agent);
}

// Whether a printer that goes through an agent answers, as its agent last
// saw it. { ok, message }, like lib/print.js checkPrinter.
function agentPrinterStatus(agent, printer) {
  if (!agent) return { ok: false, message: "Its print agent was removed" };
  if (!isOnline(agent)) return { ok: false, message: agent.getString("name") + " is offline" };
  const report = reportOf(agent);
  const seen = report.printers[printer.id];
  if (!seen || seen.host !== printer.host || msSince(report.at) > REPORT_MS) return { ok: false, message: "Not checked yet" };
  return { ok: seen.ok, message: seen.ok ? "Online" : "Not reachable from " + agent.getString("name") };
}

// Prints one label through the printer's agent and waits for the answer:
// { ok, unreachable, message } as lib/print.js printLabelPng gives.
function printThroughAgent(app, org, printer, pngBase64, label, who) {
  const { renderRaster } = require("./print.js");
  let agent = null;
  try {
    agent = app.findRecordById("print_agents", printer.agentId);
  } catch (_) {
    agent = null;
  }
  if (!agent || agent.getString("org") !== org) return { ok: false, unreachable: true, message: printer.name + "'s print agent was removed" };
  if (!isOnline(agent)) return { ok: false, unreachable: true, message: agent.getString("name") + " is offline, so " + printer.name + " can't be reached" };

  const raster = renderRaster(pngBase64, label, printer.model);
  if (!raster.ok) return { ok: false, unreachable: false, message: raster.message };

  const job = new Record(app.findCollectionByNameOrId("print_jobs"), {
    org: org,
    agent: agent.id,
    printer: printer.id,
    host: printer.host,
    data: raster.data,
    status: "queued",
    createdBy: who ? who.id : "",
  });
  app.save(job);

  const until = Date.now() + WAIT_MS;
  for (;;) {
    sleep(150);
    let now;
    try {
      now = app.findRecordById("print_jobs", job.id);
    } catch (_) {
      return { ok: false, unreachable: false, message: "The print job went missing" };
    }
    const status = now.getString("status");
    if (status === "done" || status === "failed") {
      app.delete(now);
      return { ok: status === "done", unreachable: now.getBool("unreachable"), message: now.getString("message") };
    }
    if (Date.now() < until) continue;
    // Not taken yet: it won't be, so another printer can have it. Taken:
    // it may still print, so don't send it to another printer as well.
    if (status === "queued" && moveJob(app, job.id, "queued", "cancelled")) {
      return { ok: false, unreachable: true, message: agent.getString("name") + " didn't pick it up" };
    }
    return { ok: false, unreachable: false, message: agent.getString("name") + " took it but didn't say whether it printed" };
  }
}

// Old jobs: the ones the app gave up waiting for, and anything left over.
function cleanUpJobs(app) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace("T", " ");
  app.db().newQuery("DELETE FROM print_jobs WHERE created < {:cutoff}").bind({ cutoff: cutoff }).execute();
}

module.exports = {
  agentsOf,
  agentJson,
  createAgent,
  renameAgent,
  rotateToken,
  deleteAgent,
  agentForRequest,
  printersFor,
  claimJobs,
  finishJob,
  saveReport,
  agentPrinterStatus,
  printThroughAgent,
  cleanUpJobs,
  isOnline,
};
