import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = `${root}.crew-feature-browser-data`;
const backend = "http://127.0.0.1:5319";
const email = "crew-browser@example.com", password = "crew-browser-password";
let server: ChildProcess;
let token: string, org: string, jobId: string, pastId: string;

async function api(method: string, path: string, body?: object) {
  const response = await fetch(backend + path, {
    method, headers: { "Content-Type": "application/json", ...(token && { Authorization: token }), ...(org && { "X-Org": org }) },
    body: body && JSON.stringify(body),
  });
  const json = await response.json();
  expect(response.status, JSON.stringify(json)).toBe(200);
  return json;
}

test.beforeAll(async () => {
  await mkdir(dir, { recursive: true });
  server = spawn(process.env.PB_BINARY || `${root}.pb/pocketbase-0.39.11`, [
    "serve", "--http=127.0.0.1:5319", `--dir=${dir}`,
    `--hooksDir=${root}pocketbase/pb_hooks`, `--migrationsDir=${root}pocketbase/pb_migrations`,
  ], { stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(backend + "/api/health")).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(ready, "disposable PocketBase started").toBe(true);
  await api("POST", "/api/setup", { name: "Crew tester", email, password, businessName: "Crew browser" });
  const auth = await api("POST", "/api/collections/users/auth-with-password", { identity: email, password });
  token = auth.token;
  org = (await api("GET", "/api/me")).memberships[0].org.id;
  const dashboards = await api("GET", "/api/dashboards");
  await api("PUT", "/api/me/home", { dashboard: dashboards.dashboards.find((d: { name: string }) => d.name === "My projects").id });
  const create = (collection: string, data: object) => api("POST", `/api/collections/${collection}/records`, { org, ...data });
  const roles = (await api("GET", "/api/collections/crew_roles/records")).items;
  const person = (await api("GET", "/api/collections/crew_people/records")).items[0];
  for (const [name, start, end] of [
    ["Future assigned project", "2040-01-01 08:00:00Z", "2040-01-01 10:00:00Z"],
    ["Past assigned project", "2020-01-01 08:00:00Z", "2020-01-01 10:00:00Z"],
  ]) {
    const job = await create("jobs", { name, prepAt: start, startAt: start, endAt: end, returnAt: end });
    if (name.startsWith("Future")) jobId = job.id;
    else pastId = job.id;
    const period = await create("job_periods", { job: job.id, kind: "other", name: "Show day", start, end });
    const need = await create("crew_needs", { job: job.id, period: period.id, role: roles[0].id, quantity: 2 });
    await create("job_crew", { job: job.id, person: person.id, need: need.id });
  }
});

test.afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(dir, { recursive: true, force: true });
});

test("turning rostering off hides the active roster and both My projects surfaces, and on restores them", async ({ page }) => {
  await api("PATCH", `/api/admin/orgs/${org}/features`, { features: { crew: false } });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("http://127.0.0.1:4199/");
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^My projects/ })).toHaveCount(0);
  await page.goto(`/projects/${jobId}`);
  await expect(page.getByRole("heading", { name: "Future assigned project" })).toBeVisible();
  await expect(page.getByText("Crew", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Crew tester", { exact: true }).locator("visible=true")).toHaveCount(1); // account menu only
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /Schedule/ }).click();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(0);
  await page.getByRole("button", { name: /Add.*(item|period)/i }).first().click();
  await expect(page.getByRole("button", { name: "+ Crew role" })).toHaveCount(0);
  await page.getByRole("button", { name: /Cancel|Close/ }).last().click();
  await page.getByRole("radio", { name: "Calendar", exact: true }).click();
  await page.getByText("Show day", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Show day", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toHaveCount(0);
  await expect(page.getByText("Crew tester", { exact: true }).locator("visible=true")).toHaveCount(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/projects?view=mine");
  await expect(page.getByRole("heading", { name: "Mine", exact: true })).toBeVisible();
  await expect(page.getByText(/^0 projects(?: found)?$/)).toBeVisible();
  await expect(page.getByText(/(Future|Past) assigned project/)).toHaveCount(0);
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("option", { name: "Mine (0)" })).toHaveCount(1);
  await expect(page.getByLabel("Crew", { exact: true })).toHaveCount(0);
  for (const path of ["/crew", "/rostering"]) {
    await page.goto(path);
    await page.waitForURL("http://127.0.0.1:4199/");
    await expect(page.getByRole("link", { name: /^(Crew|Rostering)$/ })).toHaveCount(0);
  }
  await api("PATCH", `/api/admin/orgs/${org}/features`, { features: { crew: true } });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^My projects/ })).toBeVisible();
  await expect(page.getByText(/Future assigned project/)).toBeVisible();
  await expect(page.getByText(/Past assigned project/)).toBeVisible();
  await page.getByRole("link", { name: "All mine" }).click();
  await expect(page.getByText(/Future assigned project/)).toBeVisible();
  await expect(page.getByText(/Past assigned project/)).toBeVisible();
  await page.goto(`/projects/${jobId}?tab=crew`);
  await expect(page.getByRole("button", { name: "+ Crew need" }).first()).toBeVisible();
  await expect(page.getByText("Crew tester", { exact: true }).locator("visible=true")).toHaveCount(2);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: /Schedule/ }).click();
  await page.getByRole("radio", { name: "Calendar", exact: true }).click();
  await page.getByText("Show day", { exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Crew need" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add period", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ Crew role" })).toBeVisible();
  await page.goto(`/projects/${pastId}`);
  await expect(page.getByText("1 of 2 filled", { exact: true })).toBeVisible();
});
