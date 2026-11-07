const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Opt in with PB_BINARY. All server state is disposable and project-local.
const binary = process.env.PB_BINARY;
const root = path.resolve(__dirname, "../..");
const base = `http://127.0.0.1:${process.env.CREW_API_PORT || 4318}`;
const password = "disposable-crew-test-password";

async function database(t, { legacy = false } = {}) {
  const dir = path.join(root, ".pb", `crew-api-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  let source = root;
  if (legacy) {
    source = path.join(dir, "baseline");
    mkdirSync(source);
    // The pre-upgrade release can create legacy records through its real API.
    const archive = spawnSync("git", ["archive", "faa43be", "pocketbase/pb_hooks", "pocketbase/pb_migrations"], { cwd: root });
    assert.equal(archive.status, 0, archive.stderr.toString());
    const extract = spawnSync("tar", ["-xf", "-", "-C", source], { input: archive.stdout });
    assert.equal(extract.status, 0, extract.stderr.toString());
  }
  const flagsFor = (from) => [
    "--dir", dir, "--migrationsDir", path.join(from, "pocketbase/pb_migrations"),
    "--hooksDir", path.join(from, "pocketbase/pb_hooks"), "--hooksWatch=false",
  ];
  const flags = flagsFor(source);
  const setup = spawnSync(binary, ["superuser", "upsert", "crew-test@example.com", password, ...flags], { encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stderr + setup.stdout);
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const start = async (from) => {
    server = spawn(binary, ["serve", "--http", new URL(base).host, ...flagsFor(from)], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    server.stdout.on("data", (data) => { output += data; });
    server.stderr.on("data", (data) => { output += data; });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {}
      assert.equal(server.exitCode, null, output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`PocketBase did not start: ${output}`);
  };
  await start(source);
  let token = "";
  let orgId = "";
  const call = async (method, endpoint, body, auth = token) => {
    const response = await fetch(base + endpoint, {
      method, headers: { "Content-Type": "application/json", Authorization: auth, "X-Org": orgId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const ok = async (method, endpoint, body) => {
    const result = await call(method, endpoint, body);
    assert.ok(result.status < 300, `${method} ${endpoint}: ${JSON.stringify(result)}`);
    return result.body;
  };
  await ok("POST", "/api/setup", { name: "Planner", email: "planner@example.com", password, businessName: "Crew test" });
  const login = await ok("POST", "/api/collections/users/auth-with-password", { identity: "planner@example.com", password });
  token = login.token;
  orgId = (await ok("GET", "/api/me")).memberships[0].org.id;
  const superuser = (await ok("POST", "/api/collections/_superusers/auth-with-password", { identity: "crew-test@example.com", password })).token;
  return {
    call, ok, get orgId() { return orgId; }, userId: login.record.id,
    create: (collection, body) => ok("POST", `/api/collections/${collection}/records`, { org: orgId, ...body }),
    suCall: (method, endpoint, body) => call(method, endpoint, body, superuser),
    switchOrg: (id) => { orgId = id; },
    restart: async () => {
      server.kill("SIGTERM");
      await once(server, "exit");
      await start(root);
    },
  };
}

async function fixture(api, year = "2026") {
  const org = { id: api.orgId };
  const job = await api.create("jobs", { org: org.id, name: "Show", prepAt: `${year}-11-07 08:00:00Z`, returnAt: `${year}-11-07 12:00:00Z` });
  const person = await api.create("crew_people", { org: org.id, name: "Alex" });
  return { org, job, person };
}

test("direct assignment writes reject an omitted crew need", { skip: !binary }, async (t) => {
  const api = await database(t);
  const { org, job, person } = await fixture(api);
  const result = await api.call("POST", "/api/collections/job_crew/records", { org: org.id, job: job.id, person: person.id });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.match(result.body.message, /crew need/i);
});

test("assignments require this project's crew need on creates and edits, including superuser writes", { skip: !binary }, async (t) => {
  const api = await database(t);
  const { job, person, org } = await fixture(api);
  const [role] = await api.ok("PUT", "/api/crew-roles", { roles: [{ name: "Operator", levels: ["Basic", "Advanced"] }] });
  const period = await api.create("job_periods", { job: job.id, name: "Show day", kind: "other", start: "2026-11-07 08:00:00Z", end: "2026-11-07 10:00:00Z" });
  const need = await api.create("crew_needs", { job: job.id, period: period.id, role: role.id, quantity: 1, level: "Advanced" });
  const assignment = await api.create("job_crew", { job: job.id, person: person.id, need: need.id });
  const endpoint = `/api/collections/job_crew/records/${assignment.id}`;
  for (const call of [api.call, api.suCall]) {
    for (const empty of ["", null]) {
      const create = await call("POST", "/api/collections/job_crew/records", { org: org.id, job: job.id, person: person.id, need: empty });
      assert.equal(create.status, 400, JSON.stringify(create));
      const update = await call("PATCH", endpoint, { need: empty });
      assert.equal(update.status, 400, JSON.stringify(update));
    }
  }
  const otherJob = await api.create("jobs", { name: "Another show", prepAt: "2026-11-07 08:00:00Z", returnAt: "2026-11-07 12:00:00Z" });
  const otherPeriod = await api.create("job_periods", { job: otherJob.id, kind: "other", name: "Other show day", start: period.start, end: period.end });
  const otherNeed = await api.create("crew_needs", { job: otherJob.id, period: otherPeriod.id, role: role.id, quantity: 1 });
  for (const call of [api.call, api.suCall]) {
    assert.equal((await call("POST", "/api/collections/job_crew/records", { org: org.id, job: job.id, person: person.id, need: otherNeed.id })).status, 400);
    const result = await call("PATCH", endpoint, { need: otherNeed.id });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /isn't on this project/);
  }
  const saved = await api.ok("PATCH", endpoint, { sortOrder: 10 });
  assert.equal(saved.need, need.id, "partial edits retain the mandatory need");
  assert.equal((await api.ok("GET", endpoint)).need, need.id, "failed edits leave the assignment intact");
});

test("need-based assignment preserves slot limits, skill levels, custom times, double bookings and unassignment", { skip: !binary }, async (t) => {
  const api = await database(t);
  const { job, person } = await fixture(api);
  const [role] = await api.ok("PUT", "/api/crew-roles", { roles: [{ name: "Operator", levels: ["Basic", "Advanced"] }] });
  await api.ok("PATCH", `/api/collections/crew_people/records/${person.id}`, { skills: [role.id], skillLevels: { [role.id]: "Advanced" } });
  const period = await api.create("job_periods", { job: job.id, name: "Show day", kind: "other", start: "2026-11-07 08:00:00Z", end: "2026-11-07 10:00:00Z" });
  const need = await api.create("crew_needs", { job: job.id, period: period.id, role: role.id, quantity: 1, level: "Advanced" });
  const custom = await api.create("crew_needs", { job: job.id, period: period.id, role: role.id, quantity: 1, level: "Basic", customTimes: true, start: "2026-11-07 07:00:00Z", end: "2026-11-07 11:00:00Z" });
  const first = await api.create("job_crew", { job: job.id, person: person.id, need: need.id });
  const duplicate = await api.call("POST", "/api/collections/job_crew/records", { org: api.orgId, job: job.id, person: person.id, need: need.id });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.message, /already on that/);
  const another = await api.create("crew_people", { name: "Sam" });
  const full = await api.call("POST", "/api/collections/job_crew/records", { org: api.orgId, job: job.id, person: another.id, need: need.id });
  assert.equal(full.status, 400);
  assert.match(full.body.message, /spots are filled/);
  const overlap = await api.create("job_crew", { job: job.id, person: person.id, need: custom.id });
  assert.equal(overlap.need, custom.id, "double bookings remain permitted");
  await api.ok("PATCH", `/api/collections/job_periods/records/${period.id}`, { start: "2026-11-07 09:00:00Z" });
  assert.equal((await api.ok("GET", `/api/collections/crew_needs/records/${need.id}`)).start, "2026-11-07 09:00:00.000Z");
  const retained = await api.ok("GET", `/api/collections/crew_needs/records/${custom.id}`);
  assert.equal(retained.start, "2026-11-07 07:00:00.000Z");
  assert.equal(retained.level, "Basic");
  await api.ok("DELETE", `/api/collections/job_crew/records/${first.id}`);
  assert.equal((await api.call("GET", `/api/collections/job_crew/records/${first.id}`)).status, 404);
  const replacement = await api.create("job_crew", { job: job.id, person: another.id, need: need.id });
  assert.equal(replacement.need, need.id, "unassignment frees the slot");
});

test("upgrading removes whole-project assignments everywhere but preserves crew-need assignments after restarts", { skip: !binary }, async (t) => {
  const api = await database(t, { legacy: true });
  const legacyIds = [];
  const validIds = [];
  for (const disabled of [false, true]) {
    if (disabled) {
      const org = await api.ok("POST", "/api/admin/orgs", { name: "Disabled organisation", adminEmail: "planner@example.com" });
      const roles = await api.suCall("GET", `/api/collections/roles/records?filter=${encodeURIComponent(`org = "${org.id}" && name = "Admin"`)}`);
      const membership = await api.suCall("POST", "/api/collections/memberships/records", { org: org.id, user: api.userId, role: roles.body.items[0].id });
      assert.equal(membership.status, 200, JSON.stringify(membership));
      api.switchOrg(org.id);
    }
    const { org, job, person } = await fixture(api, "2019");
    const [role] = await api.ok("PUT", "/api/crew-roles", { roles: [{ name: "Operator", levels: ["Basic", "Advanced"] }] });
    const period = await api.create("job_periods", { job: job.id, name: "Historical show", kind: "other", start: "2019-01-01 08:00:00Z", end: "2019-01-01 10:00:00Z" });
    const need = await api.create("crew_needs", { job: job.id, period: period.id, role: role.id, quantity: 2, level: "Advanced" });
    const members = await api.ok("GET", `/api/collections/crew_people/records?filter=${encodeURIComponent(`org = "${org.id}" && user = "${api.userId}"`)}`);
    const valid = await api.create("job_crew", { job: job.id, person: members.items[0].id, need: need.id, function: "Obsolete free text" });
    const whole = await api.create("job_crew", { job: job.id, person: person.id, function: "Project manager" });
    legacyIds.push(whole.id);
    validIds.push({ assignment: valid.id, need: need.id, period: period.id, org: org.id, job: job.id, disabled });
    if (disabled) await api.ok("PATCH", `/api/admin/orgs/${org.id}/features`, { features: { crew: false } });
  }
  await api.restart();
  for (let run = 0; run < 2; run++) {
    for (const id of legacyIds) assert.equal((await api.suCall("GET", `/api/collections/job_crew/records/${id}`)).status, 404, "whole-project assignments are deleted");
    for (const valid of validIds) {
      const assignment = await api.suCall("GET", `/api/collections/job_crew/records/${valid.assignment}`);
      assert.equal(assignment.status, 200);
      assert.equal(assignment.body.need, valid.need);
      const need = await api.suCall("GET", `/api/collections/crew_needs/records/${valid.need}`);
      assert.equal(need.body.period, valid.period);
      assert.equal(need.body.quantity, 2);
      assert.equal(need.body.level, "Advanced");
      if (!valid.disabled) {
        api.switchOrg(valid.org);
        const mine = await api.ok("GET", `/api/collections/jobs/records?filter=${encodeURIComponent(`org = "${valid.org}" && job_crew_via_job.user ?= "${api.userId}"`)}`);
        assert.ok(mine.items.some((job) => job.id === valid.job), "surviving historical assignments still make projects mine");
      }
    }
    const assignments = await api.suCall("GET", "/api/collections/job_crew/records");
    assert.equal(assignments.body.totalItems, 2, "no replacement assignments are guessed");
    if (run === 0) await api.restart();
  }
});
