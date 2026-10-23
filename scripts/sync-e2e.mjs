// End-to-end check of live sync against the mock Rentman and Momentus
// servers. Run against a THROWAWAY database: it creates an organisation and
// leaves it there.
//
//   node scripts/mock-rentman.mjs & node scripts/mock-momentus.mjs &
//   RENTMAN_BASE_URL=http://127.0.0.1:4100 R2_ALLOW_HTTP_MOMENTUS=1 pnpm dev:pb
//   node scripts/sync-e2e.mjs
//
// The superuser comes from .pb/superuser.txt, as for pnpm smoke. Each step
// runs the sync worker straight away (POST /api/sync/tick) instead of
// waiting for its minute.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.PB_URL || "http://127.0.0.1:3001";
const RENTMAN = process.env.MOCK_RENTMAN_URL || "http://127.0.0.1:4100";
const MOMENTUS = process.env.MOCK_MOMENTUS_URL || "http://127.0.0.1:4200";
const run = Date.now().toString(36);
if (!process.env.PB_SUPERUSER_EMAIL && existsSync(new URL("../.pb/superuser.txt", import.meta.url))) {
  const [email, password] = readFileSync(new URL("../.pb/superuser.txt", import.meta.url), "utf8").trim().split(" ");
  process.env.PB_SUPERUSER_EMAIL = email;
  process.env.PB_SUPERUSER_PASSWORD = password;
}

async function call(base, token, method, path, body, org) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: token } : {}),
      ...(org ? { "X-Org": org } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

let step = 0;
const log = (msg) => console.log(`✔ ${++step}. ${msg}`);
const password = "sync-password-123";

await call(RENTMAN, null, "POST", "/_mock/reset");
await call(MOMENTUS, null, "POST", "/_mock/reset");

const su = (await call(BASE, null, "POST", "/api/collections/_superusers/auth-with-password", { identity: process.env.PB_SUPERUSER_EMAIL, password: process.env.PB_SUPERUSER_PASSWORD })).token;
const tick = () => call(BASE, su, "POST", "/api/sync/tick");
await call(BASE, su, "POST", "/api/collections/users/records", { email: `platform-${run}@example.com`, name: "Platform", isPlatformAdmin: true, verified: true, password, passwordConfirm: password });
const login = async (who) => (await call(BASE, null, "POST", "/api/collections/users/auth-with-password", { identity: `${who}-${run}@example.com`, password })).token;
const platform = await login("platform");
const org = (await call(BASE, platform, "POST", "/api/admin/orgs", { name: `Sync ${run}`, adminEmail: `admin-${run}@example.com` })).id;
await call(BASE, null, "POST", "/api/collections/users/records", { email: `admin-${run}@example.com`, name: "Admin", password, passwordConfirm: password });
let admin = await login("admin");
const me = await call(BASE, admin, "GET", "/api/me");
await call(BASE, admin, "POST", `/api/invitations/${me.invitations.find((i) => i.orgId === org).id}/accept`);
admin = await login("admin");
const api = (method, path, body) => call(BASE, admin, method, path, body, org);
const list = async (collection, filter) =>
  (await api("GET", `/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(`org = "${org}"` + (filter ? ` && (${filter})` : ""))}`)).items;
log("organisation and admin set up");

// --- Rentman ---
let integrations = await api("GET", "/api/integrations");
assert.equal(integrations.rentman.config.enabled, false);
const rentman = await api("PUT", "/api/integrations/rentman", { enabled: true, secret: "mock-token" });
assert.ok(rentman.secretSet);
assert.match(rentman.webhookUrl, /\/api\/sync\/rentman\/webhook\/[a-z0-9]{32}$/);
const webhook = BASE + rentman.webhookUrl.slice(rentman.webhookUrl.indexOf("/api/"));
assert.equal((await api("POST", "/api/integrations/rentman/test")).ok, true);
log("Rentman switched on and connected");

await tick();
let items = await list("items");
assert.equal(items.length, 3);
const k12 = items.find((i) => i.code === "K12");
assert.equal(k12.price, 85);
assert.equal((await list("serials")).length, 2);
assert.ok((await list("contacts")).find((c) => c.name === "Big Events Ltd" && c.email === "hello@bigevents.example"));
assert.ok((await list("venues")).find((v) => v.name === "Town Hall"));
const gala = (await list("jobs", 'name = "Annual Gala"'))[0];
assert.ok(gala, "project came in");
assert.equal(gala.status, "confirmed");
assert.equal((await list("job_lines", `job = "${gala.id}"`)).length, 2);
log("first sync brought in equipment, units, contacts, locations and the project with its lines");

await api("PATCH", `/api/collections/items/records/${k12.id}`, { price: 99 });
await tick();
let writes = await call(RENTMAN, null, "GET", "/_mock/log");
assert.ok(writes.find((w) => w.method === "PUT" && w.path === "/equipment/101" && w.body.price === 99), "price change sent to Rentman");
assert.ok(!writes.find((w) => w.path === "/equipment/102"), "unchanged items aren't sent");
log("an R2 edit went to Rentman, and only that field");

await call(RENTMAN, null, "POST", "/_mock/edit/equipment/102", { name: "Shure SM58 (new)" });
await call(RENTMAN, null, "POST", "/_mock/webhook", { url: webhook, eventType: "update", itemType: "Equipment", ids: [102] });
await tick();
items = await list("items");
assert.equal(items.find((i) => i.code === "SM58").name, "Shure SM58 (new)");
assert.equal(items.find((i) => i.code === "K12").price, 99, "R2's edit survived the re-read");
log("a Rentman edit came in through the webhook, without undoing R2's edit");

const rogue = items.find((i) => i.code === "ROGUE");
await api("PATCH", `/api/collections/items/records/${rogue.id}`, { notes: "R2 note" });
await new Promise((r) => setTimeout(r, 1100));
await call(RENTMAN, null, "POST", "/_mock/edit/equipment/103", { internal_remark: "Rentman note" });
await tick();
assert.equal((await api("GET", `/api/collections/items/records/${rogue.id}`)).notes, "Rentman note");
let history = await api("GET", "/api/integrations/rentman/log");
assert.ok(history.some((h) => h.conflicts.some((c) => c.field === "notes" && c.winner === "remote")), "conflict logged");
log("both sides changing the same field: the newer (Rentman) won, and it's in the log");

const created = await api("POST", "/api/collections/items/records", { org, name: "Hazer", kind: "item", tracking: "bulk", stockQty: 2, price: 40 });
await tick();
writes = await call(RENTMAN, null, "GET", "/_mock/log");
assert.ok(writes.find((w) => w.method === "POST" && w.path === "/equipment" && w.body.name === "Hazer"), "new item created in Rentman");
assert.ok((await api("GET", `/api/collections/items/records/${created.id}`)).rentmanId, "and linked");
log("an item made in R2 was created in Rentman");

await call(RENTMAN, null, "POST", "/_mock/edit/projectequipment/701", { quantity: 3 });
await call(RENTMAN, null, "POST", "/_mock/webhook", { url: webhook, eventType: "update", itemType: "ProjectEquipment", ids: [701] });
await call(RENTMAN, null, "POST", "/_mock/webhook", { url: webhook, eventType: "delete", itemType: "ProjectEquipment", ids: [702] });
await tick();
const lines = await list("job_lines", `job = "${gala.id}"`);
assert.equal(lines.length, 1);
assert.equal(lines[0].quantity, 3);
log("project equipment changed and removed in Rentman followed in R2");

await api("PUT", "/api/integrations/rentman", { projectRequests: true });
const start = new Date(Date.now() + 20 * 86400000);
const end = new Date(start.getTime() + 2 * 86400000);
const r2job = await api("POST", "/api/collections/jobs/records", { org, name: `Wedding ${run}`, status: "enquiry", prepAt: start.toISOString(), returnAt: end.toISOString() });
await api("POST", `/api/jobs/${r2job.id}/lines`, { itemId: k12.id, quantity: 2 });
assert.equal((await api("GET", `/api/integrations/link/jobs/${r2job.id}`)).canSendToRentman, true);
await api("POST", `/api/integrations/rentman/project-request/${r2job.id}`);
await tick();
writes = await call(RENTMAN, null, "GET", "/_mock/log");
const request = writes.find((w) => w.method === "POST" && w.path === "/projectrequests");
assert.ok(request && request.body.name === `Wedding ${run}`, "project request sent");
assert.ok(writes.find((w) => w.path.endsWith("/projectrequestequipment") && w.body.equipment === "/equipment/101" && w.body.quantity === 2), "with its equipment");
let jobLink = (await api("GET", `/api/integrations/link/jobs/${r2job.id}`)).link;
assert.equal(jobLink.remoteType, "projectrequests");
log("an R2 project went to Rentman as a project request with its equipment");

// Accepted in Rentman: it comes back as a project and links to the same job.
const project = await call(RENTMAN, null, "POST", `/_mock/accept/${jobLink.remoteId}`);
await call(RENTMAN, null, "POST", "/_mock/webhook", { url: webhook, eventType: "create", itemType: "Project", ids: [project.id] });
await tick();
jobLink = (await api("GET", `/api/integrations/link/jobs/${r2job.id}`)).link;
assert.equal(jobLink.remoteType, "projects", "the accepted project linked back to the R2 job");
assert.equal((await list("jobs", `name = "Wedding ${run}"`)).length, 1, "and didn't come in twice");
log("once accepted in Rentman, the project linked back up instead of coming in twice");

// --- Momentus ---
const momentus = await api("PUT", "/api/integrations/momentus", {
  enabled: true,
  baseUrl: MOMENTUS,
  orgCode: "10",
  apiUserId: "R2API",
  secret: "mock-secret",
  departments: ["AV"],
  pushQuotes: true,
  miscResource: "AV-MISC",
});
assert.ok(momentus.secretSet);
const test = await api("POST", "/api/integrations/momentus/test");
assert.equal(test.ok, true, test.message);
log("Momentus connected: " + test.message);

await api("POST", "/api/integrations/momentus/actions", { action: "sync" });
await tick();
const summit = (await list("jobs", 'name = "Tech Summit 2026"'))[0];
assert.ok(summit, "event came in as a project");
assert.equal(summit.status, "confirmed");
assert.equal((await api("GET", `/api/collections/contacts/records/${summit.client}`)).name, "Acme Conferences");
assert.equal((await api("GET", `/api/collections/venues/records/${summit.venue}`)).name, "Grand Hall");
const ball = (await list("jobs", 'name = "Charity Ball"'))[0];
assert.equal(ball.status, "provisional");
const summitLines = await list("job_lines", `job = "${summit.id}"`);
assert.equal(summitLines.length, 2);
assert.ok(summitLines.find((l) => l.item === k12.id && l.quantity === 4), "order item matched to the R2 item by code");
assert.ok(summitLines.find((l) => l.lineType === "custom" && l.description === "10K projector"));
integrations = await api("GET", "/api/integrations");
assert.equal(integrations.momentus.state.seenStatuses["40"], "Definite");
log("events came in as projects with client, room, status and their AV order lines");

await api("POST", `/api/jobs/${summit.id}/quotes`);
await tick();
let mwrites = await call(MOMENTUS, null, "GET", "/_mock/log");
const order = mwrites.find((w) => w.method === "POST" && w.path === "/api/v1/Orders/10");
assert.ok(order && order.body.Event === 5001, "order created on the event");
assert.equal(mwrites.filter((w) => w.path === "/api/v1/OrderItems/10").length, 2);
log("an issued quote went to Momentus as an order on the event");

await api("POST", `/api/jobs/${summit.id}/quotes`);
await tick();
mwrites = await call(MOMENTUS, null, "GET", "/_mock/log");
assert.equal(mwrites.filter((w) => w.method === "POST" && w.path === "/api/v1/Orders/10").length, 1, "re-quoting reuses the order");
assert.ok(mwrites.filter((w) => w.method === "DELETE").length >= 2, "old order items replaced");
log("re-quoting replaced the same order's items");

await api("PUT", "/api/integrations/momentus", { pushInventory: true });
await api("POST", "/api/integrations/momentus/actions", { action: "pushInventory" });
await tick();
mwrites = await call(MOMENTUS, null, "GET", "/_mock/log");
assert.ok(mwrites.filter((w) => w.method === "POST" && w.path === "/api/v1/Resources/10").length >= 4, "inventory sent as resources");
log("inventory went to Momentus as resources");

await api("POST", "/api/integrations/momentus/actions", { action: "sync" });
await tick();
assert.equal((await list("job_lines", `job = "${summit.id}"`)).length, 2, "R2's own order isn't pulled back in");
log("the order R2 sent isn't pulled back in as more lines");

history = await api("GET", "/api/integrations/momentus/log");
assert.ok(history.length > 0);
const link = await api("GET", `/api/integrations/link/jobs/${summit.id}`);
assert.equal(link.link.provider, "momentus");
log("sync history and record links are readable");

console.log(`\nAll ${step} sync checks passed.`);
