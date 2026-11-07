// Public-API upgrade check. It builds legacy data with the integration
// checkout's hooks, upgrades that isolated database, and checks cleanup and
// current write rules through the REST API.
//
// CREW_TEST_DATA_DIR=/path/inside/session-state/files/crew-api-ticket-10 \
// CREW_TEST_BASE_ROOT=/path/to/integration/checkout \
// PB_EXECUTABLE=/path/to/pocketbase-0.39.11 \
// node scripts/crew-eligibility-upgrade.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseRoot = process.env.CREW_TEST_BASE_ROOT ? path.resolve(process.env.CREW_TEST_BASE_ROOT) : "";
const dataDir = process.env.CREW_TEST_DATA_DIR ? path.resolve(process.env.CREW_TEST_DATA_DIR) : "";
const pb = process.env.PB_EXECUTABLE ? path.resolve(process.env.PB_EXECUTABLE) : "";
const port = 4320;
const base = `http://127.0.0.1:${port}`;
const run = Date.now().toString(36);
const email = `crew-upgrade-${run}@example.invalid`;
const password = `isolated-${run}-crew-password`;
let server;
let serverOutput = "";
let createdDataDir = false;
let checks = 0;

function command(args, dirs) {
  const result = spawnSync(
    pb,
    [...args, "--dir", dataDir, "--hooksDir", dirs.hooks, "--migrationsDir", dirs.migrations, "--publicDir", path.join(repo, "web/dist"), "--hooksWatch=false"],
    { cwd: dirs.root, encoding: "utf8", env: { ...process.env, R2_DEV_TRUST_EMAILS: "1" } },
  );
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr || result.stdout}`);
}

function startServer(dirs) {
  serverOutput = "";
  server = spawn(
    pb,
    ["serve", "--http", `127.0.0.1:${port}`, "--dir", dataDir, "--hooksDir", dirs.hooks, "--migrationsDir", dirs.migrations, "--publicDir", path.join(repo, "web/dist"), "--hooksWatch=false"],
    { cwd: dirs.root, env: { ...process.env, R2_DEV_TRUST_EMAILS: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-6000);
    });
  }
  return waitForServer();
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`PocketBase stopped before becoming ready:\n${serverOutput}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PocketBase did not start on ${base}:\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  server = undefined;
}

async function call(token, method, route, body, org) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: token } : {}),
      ...(org ? { "X-Org": org } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

async function ok(token, method, route, body, org) {
  const result = await call(token, method, route, body, org);
  assert.ok(result.status < 300, `${method} ${route} failed (${result.status}): ${JSON.stringify(result.json)}`);
  return result.json;
}

async function fails(token, method, route, body, org, message) {
  const result = await call(token, method, route, body, org);
  assert.equal(result.status, 400, `${method} ${route} should be rejected: ${JSON.stringify(result.json)}`);
  if (message) assert.match(result.json.message, message);
  checks++;
  return result.json;
}

const dirs = (root) => ({ root, hooks: path.join(root, "pocketbase/pb_hooks"), migrations: path.join(root, "pocketbase/pb_migrations") });

async function createOrg(platform) {
  const created = await ok(platform, "POST", "/api/admin/orgs", { name: `Crew upgrade ${run} ${checks}`, adminEmail: email });
  await ok(platform, "POST", `/api/invitations/${created.invitation.id}/accept`);
  return created.id;
}

async function createProject(token, org, name, start) {
  const job = await ok(token, "POST", "/api/collections/jobs/records", {
    org,
    name,
    status: "confirmed",
    prepAt: start,
    returnAt: start.replace("08:00", "18:00"),
  }, org);
  const page = await ok(token, "GET", `/api/collections/job_periods/records?perPage=100&filter=${encodeURIComponent(`job = "${job.id}"`)}`, undefined, org);
  return { job, periods: page.items };
}

async function createCrewFixtures(token, org, label, date) {
  const { job, periods } = await createProject(token, org, `${label} crew project`, date);
  const usage = periods.find((period) => period.kind === "usage");
  const billing = periods.find((period) => period.kind === "billing");
  assert.ok(usage && billing, "new projects have usage and billing schedule items");
  const rolePage = await ok(token, "GET", `/api/collections/crew_roles/records?perPage=100&filter=${encodeURIComponent(`org = "${org}"`)}`, undefined, org);
  const firstRole = rolePage.items[0];
  const secondRole = rolePage.items[1];
  assert.ok(firstRole && secondRole, "organisations start with crew roles");
  const peoplePage = await ok(token, "GET", `/api/collections/crew_people/records?perPage=100&filter=${encodeURIComponent(`org = "${org}"`)}`, undefined, org);
  const person = peoplePage.items.find((candidate) => candidate.user);
  assert.ok(person, "the project planner has a crew person record");
  const other = await ok(token, "POST", "/api/collections/job_periods/records", {
    org,
    job: job.id,
    kind: "other",
    name: `${label} crew call`,
    start: date,
    end: date.replace("08:00", "10:00"),
  }, org);

  const invalid = [];
  for (const [period, role] of [[usage, firstRole], [billing, secondRole]]) {
    const need = await ok(token, "POST", "/api/collections/crew_needs/records", {
      org,
      job: job.id,
      period: period.id,
      role: role.id,
      quantity: 1,
    }, org);
    const assignment = await ok(token, "POST", "/api/collections/job_crew/records", {
      org,
      job: job.id,
      person: person.id,
      need: need.id,
    }, org);
    invalid.push({ need: need.id, assignment: assignment.id });
  }
  const defaultNeed = await ok(token, "POST", "/api/collections/crew_needs/records", {
    org,
    job: job.id,
    period: other.id,
    role: firstRole.id,
    quantity: 1,
  }, org);
  const assigned = await ok(token, "POST", "/api/collections/job_crew/records", {
    org,
    job: job.id,
    person: person.id,
    need: defaultNeed.id,
  }, org);
  const customNeed = await ok(token, "POST", "/api/collections/crew_needs/records", {
    org,
    job: job.id,
    period: other.id,
    role: secondRole.id,
    quantity: 1,
    customTimes: true,
    start: date.replace("08:00", "06:00"),
    end: date.replace("08:00", "07:00"),
  }, org);
  return {
    org,
    job: job.id,
    other: other.id,
    usage: usage.id,
    billing: billing.id,
    person: person.id,
    invalid,
    defaultNeed: defaultNeed.id,
    assigned: assigned.id,
    customNeed: customNeed.id,
  };
}

async function main() {
  if (!process.env.PB_EXECUTABLE || !existsSync(pb) || !process.env.CREW_TEST_BASE_ROOT || !existsSync(path.join(baseRoot, "pocketbase/pb_migrations"))) {
    throw new Error("Set PB_EXECUTABLE and CREW_TEST_BASE_ROOT to the original PocketBase executable and integration checkout.");
  }
  if (!dataDir || !dataDir.includes(`${path.sep}session-state${path.sep}`) || path.basename(dataDir) !== "crew-api-ticket-10" || dataDir === path.join(baseRoot, ".pb/pb_data")) {
    throw new Error("CREW_TEST_DATA_DIR must be a new isolated directory under session-state, never .pb/pb_data.");
  }
  if (existsSync(dataDir)) throw new Error(`Refusing to reuse existing test data directory: ${dataDir}`);
  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(port, "127.0.0.1", () => portProbe.close(resolve));
  }).catch((error) => {
    throw new Error(`The isolated API port ${port} is not available: ${error.message}`);
  });
  mkdirSync(dataDir, { recursive: true });
  createdDataDir = true;

  const oldDirs = dirs(baseRoot);
  const newDirs = dirs(repo);
  command(["superuser", "upsert", "crew-upgrade@example.invalid", password], oldDirs);
  await startServer(oldDirs);

  const superuser = (await ok(null, "POST", "/api/collections/_superusers/auth-with-password", {
    identity: "crew-upgrade@example.invalid",
    password,
  })).token;
  await ok(superuser, "POST", "/api/collections/users/records", {
    email,
    name: `Crew upgrader ${run}`,
    isPlatformAdmin: true,
    verified: true,
    password,
    passwordConfirm: password,
  });
  const platform = (await ok(null, "POST", "/api/collections/users/auth-with-password", { identity: email, password })).token;
  const orgOne = await createOrg(platform);
  const orgTwo = await createOrg(platform);
  const data = [
    await createCrewFixtures(platform, orgOne, "Current", "2030-03-01 08:00:00Z"),
    await createCrewFixtures(platform, orgTwo, "History", "2005-03-01 08:00:00Z"),
  ];
  await ok(platform, "PATCH", `/api/admin/orgs/${orgTwo}/features`, { features: { crew: false } });
  await stopServer();

  command(["migrate", "up"], newDirs);
  await startServer(newDirs);

  for (const fixture of data) {
    for (const old of fixture.invalid) {
      const need = await call(platform, "GET", `/api/collections/crew_needs/records/${old.need}`, undefined, fixture.org);
      assert.equal(need.status, 404, `legacy need ${old.need} is deleted`);
      const assignment = await ok(platform, "GET", `/api/collections/job_crew/records?filter=${encodeURIComponent(`id = "${old.assignment}"`)}`, undefined, fixture.org);
      assert.equal(assignment.items.length, 0, "assignments on deleted legacy needs are removed");
    }
    assert.equal((await ok(platform, "GET", `/api/collections/crew_needs/records/${fixture.defaultNeed}`, undefined, fixture.org)).period, fixture.other);
    assert.equal((await ok(platform, "GET", `/api/collections/crew_needs/records/${fixture.customNeed}`, undefined, fixture.org)).customTimes, true);
    assert.equal((await ok(platform, "GET", `/api/collections/job_crew/records/${fixture.assigned}`, undefined, fixture.org)).need, fixture.defaultNeed);
    checks += 5;
  }

  const current = data[0];
  const createdNeed = await ok(platform, "POST", "/api/collections/crew_needs/records", {
    org: current.org,
    job: current.job,
    period: current.other,
    role: (await ok(platform, "GET", `/api/collections/crew_needs/records/${current.defaultNeed}`, undefined, current.org)).role,
    quantity: 1,
  }, current.org);
  assert.equal(createdNeed.period, current.other, "public API accepts a need on an other item");
  const createdAssignment = await ok(platform, "POST", "/api/collections/job_crew/records", {
    org: current.org,
    job: current.job,
    person: current.person,
    need: createdNeed.id,
  }, current.org);
  assert.equal(createdAssignment.need, createdNeed.id, "public API accepts an assignment to an eligible need");
  checks += 2;
  for (const period of [current.usage, current.billing]) {
    await fails(platform, "POST", "/api/collections/crew_needs/records", {
      org: current.org,
      job: current.job,
      period,
      role: createdNeed.role,
      quantity: 1,
    }, current.org, /Crew needs can only be added to other schedule items/);
  }
  await fails(platform, "PATCH", `/api/collections/crew_needs/records/${createdNeed.id}`, { period: current.usage }, current.org, /Crew needs can only be added to other schedule items/);
  await fails(platform, "PATCH", `/api/collections/job_periods/records/${current.other}`, { kind: "usage" }, current.org, /Remove its crew needs before changing it to usage or billing/);
  assert.equal((await ok(platform, "GET", `/api/collections/job_periods/records/${current.other}`, undefined, current.org)).kind, "other");
  assert.equal((await ok(platform, "GET", `/api/collections/crew_needs/records/${createdNeed.id}`, undefined, current.org)).period, current.other);
  checks += 2;

  const defaultNeed = await ok(platform, "GET", `/api/collections/crew_needs/records/${current.defaultNeed}`, undefined, current.org);
  const customNeed = await ok(platform, "GET", `/api/collections/crew_needs/records/${current.customNeed}`, undefined, current.org);
  await ok(platform, "PATCH", `/api/collections/job_periods/records/${current.other}`, {
    start: "2030-03-01 09:00:00Z",
    end: "2030-03-01 11:00:00Z",
  }, current.org);
  assert.equal((await ok(platform, "GET", `/api/collections/crew_needs/records/${defaultNeed.id}`, undefined, current.org)).start, "2030-03-01 09:00:00.000Z");
  const customAfter = await ok(platform, "GET", `/api/collections/crew_needs/records/${customNeed.id}`, undefined, current.org);
  assert.equal(customAfter.start, customNeed.start, "custom times outside the item window are retained");
  assert.equal(customAfter.end, customNeed.end);
  checks += 3;

  await stopServer();
  await startServer(newDirs);
  for (const fixture of data) {
    assert.equal((await ok(platform, "GET", `/api/collections/crew_needs/records/${fixture.defaultNeed}`, undefined, fixture.org)).period, fixture.other);
    assert.equal((await ok(platform, "GET", `/api/collections/job_crew/records/${fixture.assigned}`, undefined, fixture.org)).need, fixture.defaultNeed);
    checks += 2;
  }

  console.log(`Passed ${checks} public API assertions against isolated upgrade fixtures across enabled, disabled, current, and historical organisations.`);
}

try {
  await main();
} finally {
  await stopServer();
  if (createdDataDir) rmSync(dataDir, { recursive: true, force: true });
}
