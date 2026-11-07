import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("crew feature retains readable records but blocks writes and assignment visibility per organisation", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const dir = `${root}.crew-feature-test-data`;
  const base = "http://127.0.0.1:4319";
  await mkdir(dir, { recursive: true });
  const server = spawn(process.env.PB_BINARY || `${root}.pb/pocketbase-0.39.11`, [
    "serve", "--http=127.0.0.1:4319", `--dir=${dir}`,
    `--hooksDir=${root}pocketbase/pb_hooks`, `--migrationsDir=${root}pocketbase/pb_migrations`,
  ], { stdio: "ignore" });
  let token;
  async function request(method, path, body, org, status = 200) {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(token && { Authorization: token }), ...(org && { "X-Org": org }) },
      body: body && JSON.stringify(body),
    });
    const json = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetch(base + "/api/health")).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "disposable PocketBase started");
    const email = "crew-feature@example.com", password = "crew-feature-password";
    await request("POST", "/api/setup", { name: "Crew feature tester", email, password, businessName: "Crew A" });
    const auth = await request("POST", "/api/collections/users/auth-with-password", { identity: email, password });
    token = auth.token;
    const orgA = (await request("GET", "/api/me")).memberships[0].org.id;
    const orgB = (await request("POST", "/api/admin/orgs", { name: "Crew B", adminEmail: email })).id;
    const invitation = (await request("GET", "/api/me")).invitations.find((i) => i.orgId === orgB);
    await request("POST", `/api/invitations/${invitation.id}/accept`);
    const create = (collection, body, org) => request("POST", `/api/collections/${collection}/records`, { org, ...body }, org);
    async function fixture(org, start, end, name) {
      const job = await create("jobs", { name, prepAt: start, startAt: start, endAt: end, returnAt: end }, org);
      const period = await create("job_periods", { job: job.id, kind: "other", name: "Show", start, end }, org);
      const roles = await request("GET", `/api/collections/crew_roles/records?filter=${encodeURIComponent(`org="${org}"`)}`, null, org);
      const person = (await request("GET", `/api/collections/crew_people/records?filter=${encodeURIComponent(`org="${org}" && user="${auth.record.id}"`)}`, null, org)).items[0];
      const need = await create("crew_needs", { job: job.id, period: period.id, role: roles.items[0].id, quantity: 2 }, org);
      const assignment = await create("job_crew", { job: job.id, person: person.id, need: need.id }, org);
      return { job, need, assignment, person, period };
    }
    const past = await fixture(orgA, "2020-01-01 08:00:00Z", "2020-01-01 10:00:00Z", "Past crew");
    const future = await fixture(orgA, "2040-01-01 08:00:00Z", "2040-01-01 10:00:00Z", "Future crew");
    const other = await fixture(orgB, "2041-01-01 08:00:00Z", "2041-01-01 10:00:00Z", "Other organisation");
    const freelancer = await create("crew_people", { name: "Retained freelancer" }, orgA);
    const freelanceAssignment = await create("job_crew", { job: past.job.id, person: freelancer.id, need: past.need.id }, orgA);
    await request("PATCH", `/api/admin/orgs/${orgA}/features`, { features: { crew: false } });
    await request("PATCH", `/api/collections/job_crew/records/${past.assignment.id}`, { function: "Changed" }, orgA, 403);
    for (const [collection, record, createBody, patch] of [
      ["job_crew", past.assignment, { job: past.job.id, person: past.person.id, need: past.need.id }, { function: "Changed" }],
      ["crew_needs", past.need, { job: past.job.id, period: past.period.id, role: past.need.role, quantity: 1 }, { quantity: 3 }],
      ["crew_people", freelancer, { name: "Freelancer" }, { phone: "021234567" }],
    ]) {
      await request("POST", `/api/collections/${collection}/records`, { org: orgA, ...createBody }, orgA, 403);
      await request("PATCH", `/api/collections/${collection}/records/${record.id}`, patch, orgA, 403);
      await request("DELETE", `/api/collections/${collection}/records/${record.id}`, null, orgA, 403);
      assert.equal((await request("GET", `/api/collections/${collection}/records/${record.id}`, null, orgA)).id, record.id);
    }
    await request("POST", `/api/jobs/${past.job.id}/crew-needs`, { needs: [{ period: past.period.id, role: past.need.role, quantity: 1 }] }, orgA, 403);
    assert.deepEqual(await request("GET", "/api/jobs/crew?mine=true", null, orgA), []);
    assert.deepEqual(await request("GET", "/api/jobs/crew", null, orgA), []);
    assert.deepEqual((await request("GET", "/api/jobs/crew?mine=true", null, orgB)).map((c) => c.id), [other.assignment.id]);
    await request("PATCH", `/api/collections/job_crew/records/${other.assignment.id}`, { function: "Still active" }, orgB);
    await request("PATCH", `/api/admin/orgs/${orgA}/features`, { features: { crew: true } });
    const active = await request("GET", "/api/jobs/crew?mine=true", null, orgA);
    assert.deepEqual(active.map((c) => c.job).sort(), [past.job.id, future.job.id].sort());
    assert.deepEqual(active.map((c) => c.id).sort(), [past.assignment.id, future.assignment.id].sort());
    assert.equal(active.find((c) => c.id === past.assignment.id).expand.need.id, past.need.id);
    assert.deepEqual((await request("GET", "/api/jobs/crew", null, orgA)).map((c) => c.id).sort(), [past.assignment.id, future.assignment.id, freelanceAssignment.id].sort());
    await request("PATCH", `/api/collections/job_crew/records/${past.assignment.id}`, { function: "Restored" }, orgA);
    await request("PATCH", `/api/admin/orgs/${orgA}/features`, { features: { projects: false } });
    assert.deepEqual(await request("GET", "/api/jobs/crew?mine=true", null, orgA), []);
    await request("PATCH", `/api/collections/job_crew/records/${past.assignment.id}`, { function: "Changed" }, orgA, 403);
    token = null;
    await request("POST", "/api/collections/users/records", { email: "outsider@example.com", name: "Outsider", password, passwordConfirm: password });
    token = (await request("POST", "/api/collections/users/auth-with-password", { identity: "outsider@example.com", password })).token;
    await request("GET", "/api/jobs/crew?mine=true", null, orgB, 403);
    await request("GET", `/api/collections/job_crew/records/${other.assignment.id}`, null, orgB, 404);
    await request("PATCH", `/api/collections/job_crew/records/${other.assignment.id}`, { function: "Not allowed" }, orgB, 404);
  } finally {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
    await rm(dir, { recursive: true, force: true });
  }
});
