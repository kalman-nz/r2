/// <reference path="../pb_data/types.d.ts" />
// Print agents (lib/printAgents.js): Settings → Printer setup makes and
// removes them (settings.edit), and the agent at the venue
// (print/r2_print_agent.py) signs in to these with its token, not as a
// person:
//
//   GET  /api/print-agent/jobs?wait=20   labels to print (waits for one),
//                                        and its printers to keep an eye on
//   POST /api/print-agent/jobs/{id}      how one went: { ok, unreachable, message }
//   POST /api/print-agent/status         its printers: { printers: { id: { ok, message, host } } }
//
// Same require()-inside-the-handler rule as the other route files.

routerAdd(
  "GET",
  "/api/print-agents",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { agentsOf, agentJson } = require(`${__hooks}/lib/printAgents.js`);
    const ctx = requireOrg(e, "settings.edit");
    return e.json(200, agentsOf($app, ctx.orgId).map(agentJson));
  },
  $apis.requireAuth("users"),
);

// { name } → { agent, token }. The token is shown this once.
routerAdd(
  "POST",
  "/api/print-agents",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { createAgent, agentJson } = require(`${__hooks}/lib/printAgents.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const ctx = requireOrg(e, "settings.edit");
    const made = createAgent($app, ctx.orgId, (e.requestInfo().body || {}).name, e.auth);
    logEvent(ctx.orgId, "print_agent", e.auth.get("name") || e.auth.get("email"), { agent: made.agent.id, name: made.agent.getString("name"), action: "created" });
    return e.json(200, { agent: agentJson(made.agent), token: made.token });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "PATCH",
  "/api/print-agents/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { renameAgent, agentJson } = require(`${__hooks}/lib/printAgents.js`);
    const agent = findOrNull($app, "print_agents", e.request.pathValue("id"));
    if (!agent) throw new NotFoundError("Print agent not found");
    requireRecordOrg(e, agent, "settings.edit");
    return e.json(200, agentJson(renameAgent($app, agent, (e.requestInfo().body || {}).name)));
  },
  $apis.requireAuth("users"),
);

// A new token; the old one stops working. → { agent, token }
routerAdd(
  "POST",
  "/api/print-agents/{id}/token",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { rotateToken, agentJson } = require(`${__hooks}/lib/printAgents.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const agent = findOrNull($app, "print_agents", e.request.pathValue("id"));
    if (!agent) throw new NotFoundError("Print agent not found");
    const ctx = requireRecordOrg(e, agent, "settings.edit");
    const token = rotateToken($app, agent);
    logEvent(ctx.orgId, "print_agent", e.auth.get("name") || e.auth.get("email"), { agent: agent.id, name: agent.getString("name"), action: "new token" });
    return e.json(200, { agent: agentJson(agent), token: token });
  },
  $apis.requireAuth("users"),
);

routerAdd(
  "DELETE",
  "/api/print-agents/{id}",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { deleteAgent } = require(`${__hooks}/lib/printAgents.js`);
    const { logEvent } = require(`${__hooks}/lib/log.js`);
    const agent = findOrNull($app, "print_agents", e.request.pathValue("id"));
    if (!agent) return e.json(200, { ok: true });
    const ctx = requireRecordOrg(e, agent, "settings.edit");
    deleteAgent($app, agent);
    logEvent(ctx.orgId, "print_agent", e.auth.get("name") || e.auth.get("email"), { agent: agent.id, name: agent.getString("name"), action: "removed" });
    return e.json(200, { ok: true });
  },
  $apis.requireAuth("users"),
);

// --- for the agent itself ---

routerAdd("GET", "/api/print-agent/jobs", (e) => {
  const { agentForRequest, claimJobs, printersFor } = require(`${__hooks}/lib/printAgents.js`);
  const { agent } = agentForRequest(e);
  const wait = Number(e.requestInfo().query.wait || 0);
  const jobs = claimJobs($app, agent, isFinite(wait) ? wait * 1000 : 0);
  return e.json(200, { jobs: jobs, printers: printersFor(agent) });
});

routerAdd("POST", "/api/print-agent/jobs/{id}", (e) => {
  const { agentForRequest, finishJob } = require(`${__hooks}/lib/printAgents.js`);
  const { agent } = agentForRequest(e);
  finishJob($app, agent, e.request.pathValue("id"), e.requestInfo().body || {});
  return e.json(200, { ok: true });
});

routerAdd("POST", "/api/print-agent/status", (e) => {
  const { agentForRequest, saveReport } = require(`${__hooks}/lib/printAgents.js`);
  const { agent } = agentForRequest(e);
  saveReport($app, agent, e.requestInfo().body || {});
  return e.json(200, { ok: true });
});

// The agent itself, to download onto the computer at the venue. No
// secrets in it, so no sign-in.
routerAdd("GET", "/api/print-agent/script", (e) => {
  const { printDir } = require(`${__hooks}/lib/python.js`);
  let script;
  try {
    script = $os.readFile(printDir() + "/r2_print_agent.py");
  } catch (_) {
    throw new NotFoundError("The print agent isn't on this server");
  }
  e.response.header().set("Content-Disposition", 'attachment; filename="r2_print_agent.py"');
  e.response.header().set("Cache-Control", "no-store");
  return e.blob(200, "text/x-python; charset=utf-8", script);
});

// Labels nobody's waiting for any more.
cronAdd("print_jobs_cleanup", "*/15 * * * *", () => {
  require(`${__hooks}/lib/printAgents.js`).cleanUpJobs($app);
});
