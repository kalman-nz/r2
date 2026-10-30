/// <reference path="../pb_data/types.d.ts" />

// Print agents: a small program at a venue (print/r2_print_agent.py) that
// takes labels from R2 in the cloud to the Brother printers on the venue's
// own network, which the server can't reach (lib/printAgents.js). A printer
// goes through one when it names it (printers[].agentId in the
// organisation's printer setup).
//
// print_agents  An organisation's agents: a name, the hash of the token it
//               signs in with, when it was last heard from, and what it
//               last said about its printers (report).
// print_jobs    A label on its way: the printer's own commands (made by the
//               server, base64), queued → sent → done or failed (or
//               cancelled when nobody took it in time). Gone within the hour.
//
// No API rules: only routes_print_agents.pb.js and routes_print.pb.js use them.

migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organisations");
    const users = app.findCollectionByNameOrId("users");

    const agents = new Collection({
      type: "base",
      name: "print_agents",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "name", required: true, max: 80 },
        { type: "text", name: "tokenHash", required: true, max: 128, hidden: true },
        { type: "date", name: "lastSeen" },
        { type: "json", name: "report", maxSize: 200000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_print_agents_token ON print_agents (tokenHash)", "CREATE INDEX idx_print_agents_org ON print_agents (org)"],
    });
    app.save(agents);

    const jobs = new Collection({
      type: "base",
      name: "print_jobs",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "relation", name: "org", required: true, collectionId: orgs.id, maxSelect: 1, cascadeDelete: true },
        { type: "relation", name: "agent", required: true, collectionId: agents.id, maxSelect: 1, cascadeDelete: true },
        { type: "text", name: "printer", max: 60 },
        { type: "text", name: "host", max: 255 },
        { type: "text", name: "data", max: 20000000 },
        { type: "select", name: "status", required: true, maxSelect: 1, values: ["queued", "sent", "done", "failed", "cancelled"] },
        { type: "bool", name: "unreachable" },
        { type: "text", name: "message", max: 1000 },
        { type: "relation", name: "createdBy", collectionId: users.id, maxSelect: 1 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_print_jobs_agent ON print_jobs (agent, status)", "CREATE INDEX idx_print_jobs_created ON print_jobs (created)"],
    });
    app.save(jobs);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("print_jobs"));
    app.delete(app.findCollectionByNameOrId("print_agents"));
  },
);
