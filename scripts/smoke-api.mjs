// End-to-end check of the R2 API against a running PocketBase: sets up
// organisations, people and invitations, builds a small catalogue, books it
// on overlapping jobs, quotes, scans, flags, and checks the rules that keep
// organisations apart. Run it against a THROWAWAY database — it creates
// records and leaves them there.
//
//   PB_URL=http://127.0.0.1:3001 \
//   PB_SUPERUSER_EMAIL=… PB_SUPERUSER_PASSWORD=… node scripts/smoke-api.mjs
//
// Against the local dev server no variables are needed (the superuser is
// read from .pb/superuser.txt, as for pnpm seed:demo).
//
// The unit tests (pnpm test) cover the availability and pricing maths in
// detail; this is about the routes, hooks and collection rules around them.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.PB_URL || "http://127.0.0.1:3001";
const run = Date.now().toString(36);
if (!process.env.PB_SUPERUSER_EMAIL && existsSync(new URL("../.pb/superuser.txt", import.meta.url))) {
  const [email, password] = readFileSync(new URL("../.pb/superuser.txt", import.meta.url), "utf8").trim().split(" ");
  process.env.PB_SUPERUSER_EMAIL = email;
  process.env.PB_SUPERUSER_PASSWORD = password;
}

async function call(token, method, path, body, org) {
  const res = await fetch(BASE + path, {
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
  return { status: res.status, json, headers: res.headers };
}

async function ok(token, method, path, body, org) {
  const r = await call(token, method, path, body, org);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function fails(token, method, path, body, status, messagePart, org) {
  const r = await call(token, method, path, body, org);
  assert.equal(r.status, status, `${method} ${path} should fail with ${status}, got ${r.status}: ${JSON.stringify(r.json)}`);
  if (messagePart) assert.match(r.json.message, messagePart);
  return r.json;
}

// A person working in one organisation: every call carries X-Org, and
// records they create are put in that organisation.
function as(token, org) {
  return {
    token,
    org,
    call: (method, path, body) => call(token, method, path, body, org),
    ok: (method, path, body) => ok(token, method, path, body, org),
    fails: (method, path, body, status, messagePart) => fails(token, method, path, body, status, messagePart, org),
    create: (collection, data) => ok(token, "POST", `/api/collections/${collection}/records`, { org, ...data }, org),
  };
}

// A plain white RGB PNG, built by hand so the test needs no image library.
function whitePng(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 255)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let step = 0;
const log = (msg) => console.log(`✔ ${++step}. ${msg}`);
const password = "smoke-password-123";

// --- accounts and organisations ---
const su = (
  await ok(null, "POST", "/api/collections/_superusers/auth-with-password", {
    identity: process.env.PB_SUPERUSER_EMAIL,
    password: process.env.PB_SUPERUSER_PASSWORD,
  })
).token;
await ok(su, "POST", "/api/collections/users/records", {
  email: `platform-${run}@example.com`,
  name: `Platform ${run}`,
  isPlatformAdmin: true,
  verified: true,
  password,
  passwordConfirm: password,
});
const login = async (who) => (await ok(null, "POST", "/api/collections/users/auth-with-password", { identity: `${who}-${run}@example.com`, password })).token;
const platform = await login("platform");

// Anyone can sign up; nobody can sign themselves up as a platform admin.
async function signUp(who) {
  const user = await ok(null, "POST", "/api/collections/users/records", {
    email: `${who}-${run}@example.com`,
    name: `${who} ${run}`,
    password,
    passwordConfirm: password,
  });
  return { id: user.id, token: await login(who) };
}
await fails(
  null,
  "POST",
  "/api/collections/users/records",
  { email: `sneaky-${run}@example.com`, password, passwordConfirm: password, isPlatformAdmin: true },
  400,
);

const orgA = (await ok(platform, "POST", "/api/admin/orgs", { name: `Smoke A ${run}`, adminEmail: `admin-${run}@example.com` })).id;
const adminUser = await signUp("admin");
let me = await ok(adminUser.token, "GET", "/api/me");
assert.equal(me.memberships.length, 0);
const inviteA = me.invitations.find((i) => i.orgId === orgA);
assert.equal(inviteA.roleName, "Admin");
await fails(adminUser.token, "GET", "/api/admin/orgs", null, 403);

// Nobody can verify themselves, or move their account onto an invited
// address, around the email checks.
const selfVerify = await call(adminUser.token, "PATCH", `/api/collections/users/records/${adminUser.id}`, { verified: true });
assert.ok(selfVerify.status >= 400 || selfVerify.json.verified === false, `self-verify: ${JSON.stringify(selfVerify.json)}`);
const sneaky = await signUp("sneaky2");
const emailSwap = await call(sneaky.token, "PATCH", `/api/collections/users/records/${sneaky.id}`, { email: `planner-${run}@example.com` });
assert.ok(emailSwap.status >= 400 || emailSwap.json.email !== `planner-${run}@example.com`, `email swap: ${JSON.stringify(emailSwap.json)}`);
const sneakyRecord = await ok(su, "GET", `/api/collections/users/records/${sneaky.id}`);
assert.equal(sneakyRecord.verified, false);
assert.equal(sneakyRecord.email, `sneaky2-${run}@example.com`);

// Accepting needs a verified address (unless the server trusts emails, as
// local dev does) — otherwise anyone could sign up as someone else's email.
async function verifyAndAccept(user, invitationId) {
  const mine = await ok(user.token, "GET", "/api/me");
  if (mine.verificationRequired) {
    await fails(user.token, "POST", `/api/invitations/${invitationId}/accept`, null, 403, /Verify your email/);
    await ok(platform, "PATCH", `/api/admin/users/${user.id}`, { verified: true });
  }
  await ok(user.token, "POST", `/api/invitations/${invitationId}/accept`);
}
await verifyAndAccept(adminUser, inviteA.id);
me = await ok(adminUser.token, "GET", "/api/me");
assert.deepEqual(me.memberships.map((m) => [m.org.id, m.role.name, m.role.locked]), [[orgA, "Admin", true]]);
assert.ok(me.memberships[0].permissions.length >= 40, "admins hold every permission");
const admin = as(adminUser.token, orgA);

// Every organisation starts with Admin alone, and makes the roles it needs.
const roleIds = async (who) => Object.fromEntries((await who.ok("GET", `/api/orgs/${who.org}/roles`)).map((r) => [r.name, r.id]));
assert.deepEqual(Object.keys(await roleIds(admin)), ["Admin"]);
const ADMIN_ONLY = ["settings.edit", "calendar.manage", "team.manage", "roles.manage", "logs.view", "import.rentman", "integrations.manage", "views.publish"];
const everyPermission = (await admin.ok("GET", "/api/permissions")).groups.flatMap((g) => g.permissions.map((p) => p.key));
await admin.ok("POST", `/api/orgs/${orgA}/roles`, { name: "Planner", permissions: everyPermission.filter((k) => !ADMIN_ONLY.includes(k) && !k.startsWith("templates.")) });
await admin.ok("POST", `/api/orgs/${orgA}/roles`, { name: "Tech", permissions: ["units.flag", "scan.out", "scan.in", "labels.print"] });
const rolesA = await roleIds(admin);
assert.deepEqual(Object.keys(rolesA), ["Admin", "Planner", "Tech"]);

// The admin invites the rest of the team.
const plannerUser = await signUp("planner");
const techUser = await signUp("tech");
for (const [user, who, role] of [
  [plannerUser, "planner", "Planner"],
  [techUser, "tech", "Tech"],
]) {
  const sent = await admin.ok("POST", `/api/orgs/${orgA}/invitations`, { email: `${who}-${run}@example.com`, roleId: rolesA[role] });
  assert.equal(sent.emailed, false, "no mail server here, so the admin passes the link on");
  await fails(adminUser.token, "POST", `/api/invitations/${sent.invitation.id}/accept`, null, 404);
  await verifyAndAccept(user, sent.invitation.id);
}
const planner = as(plannerUser.token, orgA);
const tech = as(techUser.token, orgA);
await admin.fails("POST", `/api/orgs/${orgA}/invitations`, { email: `planner-${run}@example.com`, roleId: rolesA.Tech }, 400, /already a member/);
const declined = await admin.ok("POST", `/api/orgs/${orgA}/invitations`, { email: `decliner-${run}@example.com`, roleId: rolesA.Tech });
const decliner = await signUp("decliner");
await ok(decliner.token, "POST", `/api/invitations/${declined.invitation.id}/decline`);
assert.equal((await ok(decliner.token, "GET", "/api/me")).invitations.length, 0);

// A second organisation, run by someone with nothing to do with A. They
// bring in the tech from A as an admin: roles are per organisation.
const orgB = (await ok(platform, "POST", "/api/admin/orgs", { name: `Smoke B ${run}`, adminEmail: `boss-${run}@example.com` })).id;
const bossUser = await signUp("boss");
await verifyAndAccept(bossUser, (await ok(bossUser.token, "GET", "/api/me")).invitations.find((i) => i.orgId === orgB).id);
const bossB = as(bossUser.token, orgB);
const rolesB = await roleIds(bossB);
await bossB.fails("POST", `/api/orgs/${orgB}/invitations`, { email: `x-${run}@example.com`, roleId: rolesA.Tech }, 400, /this organisation's roles/);
const techInvite = await bossB.ok("POST", `/api/orgs/${orgB}/invitations`, { email: `TECH-${run}@example.com`, roleId: rolesB.Admin });
assert.equal(techInvite.invitation.email, `tech-${run}@example.com`, "addresses are matched without case");
await ok(techUser.token, "POST", `/api/invitations/${techInvite.invitation.id}/accept`);
const techInB = as(techUser.token, orgB);
me = await ok(techUser.token, "GET", "/api/me");
assert.deepEqual(me.memberships.map((m) => [m.org.id, m.role.name]).sort(), [[orgA, "Tech"], [orgB, "Admin"]].sort());
log("organisations: platform admin creates them, invitations need a verified matching address, roles are per organisation");

// --- members ---
const members = await admin.ok("GET", `/api/orgs/${orgA}/members`);
assert.deepEqual(members.map((m) => m.roleName).sort(), ["Admin", "Planner", "Tech"]);
assert.ok(members.every((m) => m.email), "people who manage the team see addresses");
assert.ok((await tech.ok("GET", `/api/orgs/${orgA}/members`)).every((m) => !m.email), "others don't");
const plannerMembership = members.find((m) => m.roleName === "Planner");
const techMembership = members.find((m) => m.roleName === "Tech");
const adminMembership = members.find((m) => m.isAdmin);
await admin.ok("PATCH", `/api/orgs/${orgA}/members/${plannerMembership.id}`, { roleId: rolesA.Tech });
await admin.ok("PATCH", `/api/orgs/${orgA}/members/${plannerMembership.id}`, { roleId: rolesA.Planner });
await tech.fails("PATCH", `/api/orgs/${orgA}/members/${plannerMembership.id}`, { roleId: rolesA.Admin }, 403);
await admin.fails("PATCH", `/api/orgs/${orgA}/members/${adminMembership.id}`, { roleId: rolesA.Tech }, 400, /needs an admin/);
await admin.fails("PATCH", `/api/orgs/${orgA}/members/${plannerMembership.id}`, { roleId: rolesB.Admin }, 400, /this organisation's roles/);
await fails(adminUser.token, "DELETE", `/api/me/memberships/${orgA}`, null, 400, /needs an admin/);
await admin.fails("GET", `/api/orgs/${orgB}/members`, null, 403);
log("members: roles are assigned per organisation, every organisation keeps an admin, outsiders get nothing");

// --- custom roles ---
const catalogue = await admin.ok("GET", "/api/permissions");
assert.ok(catalogue.groups.flatMap((g) => g.permissions).length >= 40);
// A team lead who can run the team and roles, and do warehouse work.
const lead = await admin.ok("POST", `/api/orgs/${orgA}/roles`, {
  name: "Warehouse lead",
  description: "Runs the warehouse crew",
  permissions: ["team.manage", "roles.manage", "scan.out", "scan.in", "units.flag", "units.edit", "nonsense.permission"],
});
assert.deepEqual(lead.permissions, ["units.edit", "units.flag", "scan.out", "scan.in", "team.manage", "roles.manage"], "unknown permissions dropped");
await admin.fails("POST", `/api/orgs/${orgA}/roles`, { name: "warehouse LEAD", permissions: [] }, 400, /already a role/);
const quoteViewer = await admin.ok("POST", `/api/orgs/${orgA}/roles`, { name: "Quote viewer", permissions: ["quotes.view"] });
assert.deepEqual(quoteViewer.permissions, ["prices.view", "quotes.view"], "prerequisites are added");
await planner.fails("POST", `/api/orgs/${orgA}/roles`, { name: "Nope", permissions: [] }, 403);
await admin.fails("PATCH", `/api/orgs/${orgA}/roles/${rolesA.Admin}`, { permissions: [] }, 400, /can't be changed/);
await admin.fails("DELETE", `/api/orgs/${orgA}/roles/${rolesA.Admin}`, null, 400, /can't be deleted/);
await admin.ok("PATCH", `/api/orgs/${orgA}/members/${techMembership.id}`, { roleId: lead.id });
// The tech is now a warehouse lead: team and roles, but nothing they don't hold themselves.
await tech.ok("GET", `/api/orgs/${orgA}/invitations`);
await tech.fails("POST", `/api/orgs/${orgA}/roles`, { name: "Sneaky", permissions: ["settings.edit"] }, 403, /your own role doesn't have/);
await tech.fails("PATCH", `/api/orgs/${orgA}/roles/${lead.id}`, { permissions: [...lead.permissions, "jobs.delete"] }, 403, /your own role doesn't have/);
await tech.fails("PATCH", `/api/orgs/${orgA}/roles/${rolesA.Planner}`, { permissions: [] }, 403, /your own role doesn't have/);
await tech.fails("PATCH", `/api/orgs/${orgA}/members/${plannerMembership.id}`, { roleId: rolesA.Admin }, 403, /Only admins/);
await tech.fails("PATCH", `/api/orgs/${orgA}/members/${adminMembership.id}`, { roleId: rolesA.Tech }, 403, /Only admins/);
await tech.fails("POST", `/api/orgs/${orgA}/invitations`, { email: `boss2-${run}@example.com`, roleId: rolesA.Planner }, 403, /your own role doesn't have/);
const crew = await tech.ok("POST", `/api/orgs/${orgA}/roles`, { name: "Stage crew", permissions: ["scan.out", "scan.in"] });
await tech.ok("POST", `/api/orgs/${orgA}/invitations`, { email: `crew-${run}@example.com`, roleId: crew.id });
await tech.fails("DELETE", `/api/orgs/${orgA}/roles/${crew.id}`, null, 400, /invitation is waiting/);
await tech.fails("PUT", "/api/app-settings", { gstRate: "15" }, 403, /change business, pricing/);
// Collection rules follow the role's permissions too.
const flagged = await planner.create("items", { name: `Flag test ${run}`, kind: "item", tracking: "serial" });
const unit = await planner.create("serials", { item: flagged.id, barcode: `FLAG-${run}`, status: "active" });
await tech.ok("PATCH", `/api/collections/serials/records/${unit.id}`, { notes: "units.edit lets the lead edit units" });
await tech.fails("DELETE", `/api/collections/serials/records/${unit.id}`, null, 404);
await planner.ok("DELETE", `/api/collections/serials/records/${unit.id}`);
await planner.ok("DELETE", `/api/collections/items/records/${flagged.id}`);
// Back to plain tech for everything below.
await admin.ok("PATCH", `/api/orgs/${orgA}/members/${techMembership.id}`, { roleId: rolesA.Tech });
const listedRoles = await tech.ok("GET", `/api/orgs/${orgA}/roles`);
assert.equal(listedRoles.find((r) => r.name === "Stage crew").invitations, 1);
assert.equal(listedRoles.find((r) => r.name === "Tech").members, 1);
log("custom roles: per-action permissions, prerequisites, no handing out more than you have, the Admin role is fixed");

// --- settings ---
await admin.ok("PUT", "/api/app-settings", { dayFactors: "1, 1.5, 2", extraDayFactor: "0.5", gstRate: "15", bufferHours: "0" });
await admin.fails("PUT", "/api/app-settings", { dayFactors: "1, 0.5" }, 400, /go down/);
await planner.fails("PUT", "/api/app-settings", { gstRate: "10" }, 403);
await admin.ok("PUT", "/api/app-settings", { rentmanApiToken: "secret-token" });
const settings = await tech.ok("GET", "/api/app-settings");
assert.equal(settings.rentmanApiToken, undefined);
assert.equal(settings.rentmanApiTokenSet, true);
assert.equal((await bossB.ok("GET", "/api/app-settings")).rentmanApiTokenSet, false, "settings are per organisation");
await admin.ok("PUT", "/api/app-settings", { rentmanApiToken: "" });
await admin.fails("PUT", "/api/app-settings", { timezone: "Mars/Olympus_Mons" }, 400, /time zone/);
await fails(adminUser.token, "GET", "/api/collections/settings/records", null, 403);
// The same person: a tech in A, an admin in B.
await tech.fails("PUT", "/api/app-settings", { gstRate: "15" }, 403);
await techInB.ok("PUT", "/api/app-settings", { gstRate: "15" });
log("settings: per organisation, admins only, and secrets never readable through the API");

// --- first-run setup is closed once anyone exists ---
assert.deepEqual(await ok(null, "GET", "/api/setup"), { needed: false });
await fails(null, "POST", "/api/setup", { name: "Intruder", email: `x-${run}@example.com`, password: "long-enough-password" }, 403, /already set up/);
log("first-run setup is locked once there are users");

// --- catalogue ---
const audio = await planner.create("categories", { name: `Audio ${run}` });
const speakers = await planner.create("categories", { name: "Speakers", parent: audio.id });
await planner.fails("PATCH", `/api/collections/categories/records/${audio.id}`, { parent: speakers.id }, 400, /inside itself/);
await tech.fails("POST", "/api/collections/categories/records", { org: orgA, name: "nope" }, 400);

const k12 = await planner.create("items", { name: `QSC K12 ${run}`, kind: "item", tracking: "serial", price: 80, category: speakers.id });
const stand = await planner.create("items", { name: `Speaker stand ${run}`, kind: "item", tracking: "bulk", stockQty: 4, price: 10 });
const xlr = await planner.create("items", { name: `XLR 10m ${run}`, kind: "item", tracking: "bulk", stockQty: 20, price: 2, barcode: `XLR-${run}` });
const k12Serials = [];
for (const n of [1, 2]) {
  k12Serials.push(await planner.create("serials", { item: k12.id, barcode: `K12-${run}-${n}`, status: "active" }));
}
await planner.fails("POST", "/api/collections/serials/records", { org: orgA, item: xlr.id, barcode: `X-${run}`, status: "active" }, 400, /isn't tracked by serial/);
await planner.fails("POST", "/api/collections/serials/records", { org: orgA, item: k12.id, barcode: `XLR-${run}`, status: "active" }, 400, /already used/);
const pa = await planner.create("items", { name: `PA pair ${run}`, kind: "kit", price: 200 });
await planner.create("item_components", { parent: pa.id, child: k12.id, kind: "component", quantity: 2 });
await planner.create("item_components", { parent: k12.id, child: stand.id, kind: "accessory", quantity: 1 });
await planner.fails("POST", "/api/collections/item_components/records", { org: orgA, parent: xlr.id, child: stand.id, kind: "component", quantity: 1 }, 400, /isn't a kit/);
await planner.fails("POST", "/api/collections/item_components/records", { org: orgA, parent: k12.id, child: pa.id, kind: "accessory", quantity: 1 }, 400, /nested/);
log("catalogue: categories, bulk + serial items, a kit, an accessory, and the rules around them");

// --- automatic codes and barcodes ---
assert.match(k12.code, /^\d{5}$/, "items get a 5-digit code");
assert.equal(Number(stand.code), Number(k12.code) + 1, "codes count up");
assert.match(stand.barcode, /^[1-9]\d{6}$/, "and a 7-digit barcode");
assert.equal(xlr.barcode, `XLR-${run}`, "a barcode you give is kept");
await planner.fails("PATCH", `/api/collections/items/records/${stand.id}`, { code: k12.code }, 400, /already used/);
const autoUnit = await planner.create("serials", { item: k12.id, status: "active" });
assert.match(autoUnit.barcode, /^[1-9]\d{6}$/, "units get a 7-digit barcode too");
const spaced = `${autoUnit.barcode.slice(0, 3)} ${autoUnit.barcode.slice(3, 6)}-${autoUnit.barcode.slice(6)}`;
assert.equal((await tech.ok("GET", `/api/lookup?code=${encodeURIComponent(spaced)}`)).id, autoUnit.id, "typed with spaces and dashes still finds it");
await planner.ok("DELETE", `/api/collections/serials/records/${autoUnit.id}`);
log("items get the next 5-digit code and 7-digit barcodes are generated, kept unique and easy to type");

const client = await planner.create("contacts", { name: `Client ${run}`, email: `client-${run}@example.com` });
const venue = await planner.create("venues", { name: `Venue ${run}` });

// --- the other organisation, with clashing codes ---
const xlrB = await bossB.create("items", { name: `B's XLR ${run}`, kind: "item", tracking: "bulk", stockQty: 3, price: 9, barcode: `XLR-${run}` });
const secretB = await bossB.create("items", { name: `B only ${run}`, kind: "item", tracking: "bulk", stockQty: 1, barcode: `BONLY-${run}` });
const jobInB = await bossB.create("jobs", { name: `B's job ${run}`, status: "confirmed", prepAt: "2030-03-01 08:00:00Z", returnAt: "2030-03-04 12:00:00Z" });
assert.equal(jobInB.number, 1001, "job numbers are per organisation");
log("a second organisation can reuse the same barcodes and job numbers");

// --- jobs ---
await planner.fails("POST", "/api/collections/jobs/records", { org: orgA, name: "bad", status: "confirmed", prepAt: "2030-01-02 08:00:00Z", returnAt: "2030-01-01 08:00:00Z" }, 400, /Return has to be after prep/);
const jobA = await planner.create("jobs", {
  name: `Gala ${run}`,
  status: "confirmed",
  client: client.id,
  venue: venue.id,
  prepAt: "2030-03-01 08:00:00Z",
  billingStart: "2030-03-02 08:00:00Z",
  billingEnd: "2030-03-03 20:00:00Z",
  returnAt: "2030-03-04 12:00:00Z",
});
assert.equal(jobA.number, 1001);
const jobB = await planner.create("jobs", {
  name: `Overlap ${run}`,
  status: "provisional",
  prepAt: "2030-03-03 08:00:00Z",
  returnAt: "2030-03-05 12:00:00Z",
});
assert.equal(jobB.number, jobA.number + 1);
log(`jobs #${jobA.number} and #${jobB.number}, numbered in order, dates validated`);

// --- schedule ---
const periodsOf = async (job) =>
  (await planner.ok("GET", `/api/collections/job_periods/records?sort=start&filter=${encodeURIComponent(`job = "${job.id}"`)}`)).items;
const jobRecord = (job) => planner.ok("GET", `/api/collections/jobs/records/${job.id}`);
const seeded = await periodsOf(jobA);
assert.deepEqual(seeded.map((p) => p.kind).sort(), ["billing", "usage"], "a new project starts with a usage and a billing period");
const [usageA, billingA] = ["usage", "billing"].map((k) => seeded.find((p) => p.kind === k));
assert.equal(billingA.start, "2030-03-02 08:00:00.000Z", "billed over the dates given at creation");
await planner.fails("PATCH", `/api/collections/jobs/records/${jobA.id}`, { prepAt: "2030-02-01 08:00:00Z" }, 400, /schedule/);
await planner.fails("DELETE", `/api/collections/job_periods/records/${usageA.id}`, null, 400, /at least one usage period/);
await planner.fails("PATCH", `/api/collections/job_periods/records/${billingA.id}`, { kind: "other" }, 400, /at least one billing period/);
const crewCall = await planner.create("job_periods", { job: jobA.id, kind: "other", name: "Crew call: riggers", start: "2030-02-28 20:00:00Z", end: "2030-03-01 04:00:00Z" });
await planner.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "billing", name: "Encore", start: "2030-03-03 18:00:00Z", end: "2030-03-03 22:00:00Z" }, 400, /already has its billing period/);
await planner.ok("PATCH", `/api/collections/job_periods/records/${billingA.id}`, { end: "2030-03-03 22:00:00Z" });
let derived = await jobRecord(jobA);
assert.equal(derived.startAt, "2030-02-28 20:00:00.000Z", "the project starts at its earliest period");
assert.equal(derived.prepAt, "2030-03-01 08:00:00.000Z", "a crew call doesn't book the kit");
assert.equal(derived.billingEnd, "2030-03-03 22:00:00.000Z");
const charged = (await planner.ok("GET", `/api/jobs/${jobA.id}/summary`)).pricing;
assert.equal(charged.basis, "billing");
assert.equal(charged.days, 2, "every started 24 hours of the billing period is a day");
await planner.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 09:00:00Z" }, 400, /end after it starts/);
await tech.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 11:00:00Z" }, 400);
await bossB.fails("POST", "/api/collections/job_periods/records", { org: orgB, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 11:00:00Z" }, 400, /another organisation/);
await planner.ok("DELETE", `/api/collections/job_periods/records/${crewCall.id}`);
await planner.ok("PATCH", `/api/collections/job_periods/records/${billingA.id}`, { end: "2030-03-03 20:00:00Z" });
derived = await jobRecord(jobA);
assert.equal(derived.startAt, "2030-03-01 08:00:00.000Z", "removing periods shrinks the project back");
assert.equal(derived.billingEnd, "2030-03-03 20:00:00.000Z");
log("the schedule: one usage period books the kit, one billing period sets the charge, both always kept, only the project's own planners can change it");

// --- price per hour / week / each ---
// jobB is booked (and billed) 2030-03-03 08:00 → 03-05 12:00: 52 hours,
// 3 charged days, 1 week.
const priced = async (priceUnit, price) => {
  const item = await planner.create("items", { name: `Per ${priceUnit} ${run}`, kind: "item", tracking: "bulk", stockQty: 30, price, priceUnit });
  const lines = (await planner.ok("POST", `/api/jobs/${jobB.id}/lines`, { itemId: item.id, quantity: 2 })).lines;
  const line = lines.find((l) => l.item && l.item.id === item.id);
  await planner.ok("DELETE", `/api/job-lines/${line.id}`);
  return line;
};
const each = await priced("each", 18.5);
assert.equal(each.priceMode, "fixed", "sold items are charged once");
assert.equal(each.amount.net, 37, "2 × $18.50");
const hourly = await priced("hour", 10);
assert.equal(hourly.priceMode, "per_hour");
assert.equal(hourly.amount.net, 1040, "2 × $10/hr × 52 hours");
const weekly = await priced("week", 100);
assert.equal(weekly.amount.net, 200, "2 × $100/week × 1 week");
log("prices per hour, day, week or each charge the right way");

// --- isolation ---
const listed = await planner.ok("GET", `/api/collections/items/records?perPage=200&filter=${encodeURIComponent(`name ~ "${run}"`)}`);
assert.ok(listed.items.every((i) => i.org === orgA), "lists only show your organisations' records");
await planner.fails("GET", `/api/collections/items/records/${secretB.id}`, null, 404);
await planner.fails("POST", "/api/collections/items/records", { org: orgB, name: "planted", kind: "item", tracking: "bulk" }, 400);
await planner.fails("PATCH", `/api/collections/items/records/${xlr.id}`, { org: orgB }, 404);
await planner.fails("POST", "/api/collections/serials/records", { org: orgA, item: xlrB.id, barcode: `Z-${run}`, status: "active" }, 400, /another organisation/);
await planner.fails("POST", "/api/collections/jobs/records", { org: orgA, name: "x", status: "enquiry", client: (await bossB.create("contacts", { name: "B's client" })).id, prepAt: "2030-01-01 08:00:00Z", returnAt: "2030-01-02 08:00:00Z" }, 400, /another organisation/);
await planner.fails("GET", `/api/jobs/${jobInB.id}/summary`, null, 403);
await planner.fails("POST", `/api/jobs/${jobA.id}/lines`, { itemId: xlrB.id, quantity: 1 }, 404);
await fails(plannerUser.token, "GET", "/api/availability?start=2030-03-01T00:00:00Z&end=2030-03-02T00:00:00Z", null, 403, /not a member/, orgB);
await tech.fails("GET", `/api/lookup?code=BONLY-${run}`, null, 404);
assert.equal((await tech.ok("GET", `/api/lookup?code=XLR-${run}`)).id, xlr.id, "a shared code finds your own organisation's item");
await bossB.fails("POST", "/api/collections/categories/records", { org: orgA, name: "nope" }, 400);
// Collection rules follow the role in the record's organisation, not the
// highest role someone has anywhere.
await techInB.fails("POST", "/api/collections/categories/records", { org: orgA, name: "nope" }, 400);
await techInB.ok("POST", "/api/collections/categories/records", { org: orgB, name: `B cat ${run}` });
log("isolation: lists, reads, writes, cross-org links, routes and barcode lookups stay inside the organisation");

// --- lines, kit expansion, pricing ---
let summary = await planner.ok("POST", `/api/jobs/${jobA.id}/lines`, { itemId: pa.id, quantity: 1 });
assert.equal(summary.lines.length, 2, "kit line + its component line");
assert.equal(summary.lines[1].lineType, "component");
assert.equal(summary.lines[1].quantity, 2);
summary = await planner.ok("POST", `/api/jobs/${jobA.id}/lines`, { itemId: xlr.id, quantity: 6 });
summary = await planner.ok("POST", `/api/jobs/${jobA.id}/lines`, { itemId: xlr.id, quantity: 2 });
const xlrLine = summary.lines.find((l) => l.item && l.item.id === xlr.id);
assert.equal(xlrLine.quantity, 8, "adding the same item again tops up its line");
summary = await planner.ok("POST", `/api/jobs/${jobA.id}/lines`, { description: "Delivery", quantity: 1, unitPrice: 150 });
// Show 2 Mar 08:00 → 3 Mar 20:00 = 36h = 2 days → factor 1.5
assert.equal(summary.pricing.days, 2);
assert.equal(summary.pricing.factor, 1.5);
// Kit 200 × 1.5 = 300; components free; XLR 8 × 2 × 1.5 = 24; delivery fixed 150
assert.equal(summary.pricing.totals.exGst, 474);
assert.equal(summary.pricing.totals.gst, 71.1);
assert.equal(summary.pricing.totals.total, 545.1);
log("lines: kit expands to components, repeat adds merge, totals = $474 + GST $71.10");

// --- deleting folders ---
const xlrFolder = xlr.category;
const outer = await planner.create("categories", { name: `Outer ${run}` });
const inner = await planner.create("categories", { name: `Inner ${run}`, parent: outer.id });
const spare = await planner.create("items", { name: `Spare ${run}`, kind: "item", tracking: "bulk", stockQty: 1, category: inner.id });
await planner.ok("PATCH", `/api/collections/items/records/${xlr.id}`, { category: inner.id });
await tech.fails("POST", `/api/folders/${outer.id}/delete`, { contents: true }, 403);
const gone = await planner.ok("POST", `/api/folders/${outer.id}/delete`, { contents: true });
assert.deepEqual([gone.deleted, gone.archived], [1, 1], "unused items are deleted, ones on projects archived");
await planner.fails("GET", `/api/collections/items/records/${spare.id}`, null, 404);
await planner.fails("GET", `/api/collections/categories/records/${inner.id}`, null, 404);
const keptXlr = await planner.ok("GET", `/api/collections/items/records/${xlr.id}`);
assert.equal(keptXlr.archived, true);
assert.equal(keptXlr.category, "", "kept at the deleted folder's level");
await planner.ok("PATCH", `/api/collections/items/records/${xlr.id}`, { archived: false, category: xlrFolder });
const shell = await planner.create("categories", { name: `Shell ${run}` });
const loose = await planner.create("items", { name: `Loose ${run}`, kind: "item", tracking: "bulk", stockQty: 1, category: shell.id });
assert.equal((await planner.ok("POST", `/api/folders/${shell.id}/delete`, { contents: false })).moved, 1);
assert.equal((await planner.ok("GET", `/api/collections/items/records/${loose.id}`)).category, "", "keeping contents moves them up");
await planner.ok("DELETE", `/api/collections/items/records/${loose.id}`);
log("deleting a folder: with its contents (used items archived), or keeping them");

summary = await planner.ok("PATCH", `/api/job-lines/${summary.lines[0].id}`, { quantity: 2 });
assert.equal(summary.lines[1].quantity, 4, "component follows the kit's quantity");
assert.equal(summary.lines[1].availability.short, 2, "only 2 K12s exist");
assert.equal(summary.lines[0].componentsShort, true);
summary = await planner.ok("PATCH", `/api/job-lines/${summary.lines[0].id}`, { quantity: 1 });
await planner.fails("PATCH", `/api/job-lines/${summary.lines[1].id}`, { quantity: 3 }, 400, /follows/);
log("changing a kit's quantity moves its components and flags the shortage");

// --- availability across jobs ---
const b = await planner.ok("POST", `/api/jobs/${jobB.id}/lines`, { itemId: k12.id, quantity: 1 });
const k12OnB = b.lines.find((l) => l.item && l.item.id === k12.id);
assert.equal(k12OnB.availability.short, 1, "job A holds both K12s over the overlap");
assert.equal(b.lines.find((l) => l.lineType === "accessory").quantity, 1, "accessory came along");
summary = await planner.ok("GET", `/api/jobs/${jobA.id}/summary`);
const k12OnA = summary.lines.find((l) => l.item && l.item.id === k12.id);
assert.equal(k12OnA.availability.short, 1, "A is short too, because B's pencil overlaps");
assert.equal(k12OnA.availability.shortFirm, 0, "…but only because of a provisional hold");
const window = await tech.ok("GET", `/api/availability?start=2030-03-03T09:00:00Z&end=2030-03-03T10:00:00Z`);
assert.equal(window[k12.id].free, -1);
assert.equal(window[pa.id].free, -1, "kit availability follows its components");
assert.equal(window[xlrB.id], undefined, "another organisation's stock isn't in the answer");
const timeline = await tech.ok("GET", `/api/items/${k12.id}/availability?from=2030-02-28T00:00:00Z&to=2030-03-07T00:00:00Z`);
assert.equal(timeline.bookings.length, 2);
assert.deepEqual(
  timeline.segments.map((s) => s.free),
  [2, 0, -1, 1, 2],
);
log("availability: overlapping jobs, firm vs pencilled, kits and timelines agree");

// --- techs ---
const techView = await tech.ok("GET", `/api/jobs/${jobA.id}/summary`);
assert.equal(techView.pricing, undefined);
assert.equal(techView.lines[0].unitPrice, undefined);
await tech.fails("POST", `/api/jobs/${jobA.id}/lines`, { itemId: xlr.id }, 403);
log("techs see kit lists without prices and can't change lines");

// --- quotes ---
const issued = await planner.ok("POST", `/api/jobs/${jobA.id}/quotes`);
const quote = await planner.ok("GET", `/api/quotes/${issued.quoteId}`);
assert.equal(quote.version, 1);
assert.equal(quote.total, 545.1);
assert.equal(quote.snapshot.client.name, client.name);
await planner.ok("PATCH", `/api/quotes/${quote.id}`, { status: "accepted" });
await bossB.fails("GET", `/api/quotes/${quote.id}`, null, 403);

// PDFs come from print/r2_pdf.py, so the server needs its Python set up
// (scripts/dev-pocketbase.sh does it locally; the Docker image has it).
async function pdf(who, method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: who.token, "X-Org": who.org, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200) throw new Error(`${path} → ${r.status}: ${bytes.toString()}`);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  return bytes;
}
await pdf(planner, "GET", `/api/quotes/${quote.id}/pdf`);
await tech.fails("GET", `/api/quotes/${quote.id}/pdf`, null, 403);
await pdf(tech, "GET", `/api/jobs/${jobA.id}/packing.pdf`);
await bossB.fails("GET", `/api/jobs/${jobA.id}/packing.pdf`, null, 403);
// A small white PNG is enough to check the label PDF plumbing.
const png = whitePng(40, 20).toString("base64");
const labelPdf = await pdf(tech, "POST", "/api/labels/pdf", {
  labels: [{ imageDataUrl: `data:image/png;base64,${png}`, widthMm: 57, heightMm: 32, copies: 3 }],
});
assert.equal((labelPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 3, "one page per copy");
await tech.fails("POST", "/api/labels/pdf", { labels: [{ imageDataUrl: "nope", widthMm: 57, heightMm: 32 }] }, 400, /no PNG/);
const quotesAsTech = await tech.ok("GET", "/api/collections/quotes/records");
assert.equal(quotesAsTech.totalItems, 0, "techs can't list quotes");
log("quote v1 snapshotted at $545.10, accepted; quote, packing list and label PDFs render");

// --- Xero export ---
const candidates = await planner.ok("GET", "/api/exports/xero/jobs?from=2030-03-01&to=2030-03-31");
const candidateA = candidates.find((c) => c.jobId === jobA.id);
assert.equal(candidateA.quote.status, "accepted");
assert.equal(candidateA.changedSinceQuote, false);
assert.equal(candidates.find((c) => c.jobId === jobB.id)?.quote ?? null, null, "a job with no quote has nothing to invoice from");
assert.equal(candidates.find((c) => c.jobId === jobInB.id), undefined, "another organisation's jobs aren't offered");
await tech.fails("GET", "/api/exports/xero/jobs?from=2030-03-01&to=2030-03-31", null, 403);
const xeroRes = await planner.call("GET", `/api/exports/xero.csv?jobs=${jobA.id},${jobB.id},${jobInB.id}&invoiceDate=2030-03-05`);
assert.equal(xeroRes.status, 200);
assert.match(xeroRes.headers.get("content-type"), /^text\/csv/);
const xeroRows = xeroRes.json.trimEnd().split("\r\n");
assert.ok(xeroRows[0].startsWith("*ContactName,EmailAddress,"));
// Kit (contents folded in), XLR line, delivery = 3 invoice lines, all on one
// invoice; B's job is ignored even though it was asked for.
assert.equal(xeroRows.length, 1 + 3);
assert.ok(xeroRows.slice(1).every((r) => r.includes(`,R2-${jobA.number},`) && r.includes(",5/3/2030,25/3/2030,")));
assert.ok(xeroRows[1].includes("Includes 2× QSC K12"), xeroRows[1]);
log("Xero export: invoices from accepted quotes only, kit contents folded in, other organisations' jobs left out");

// --- equipment tracking ---
const stepsA = (await tech.ok("GET", `/api/collections/tracking_steps/records?sort=sortOrder&filter=${encodeURIComponent(`org = "${tech.org}"`)}`)).items;
assert.deepEqual(stepsA.map((x) => `${x.name}:${x.stage}`), ["Prepped:prep", "Loaded:out", "Returned:back"], "every organisation starts with these steps");
const stepId = Object.fromEntries(stepsA.map((x) => [x.name, x.id]));
const jobStatusesA = (await tech.ok("GET", `/api/collections/job_statuses/records?filter=${encodeURIComponent(`org = "${tech.org}"`)}`)).items;
const jobStatusNamed = (id) => jobStatusesA.find((x) => x.id === id)?.name;
const scanA = (code, direction, extra = {}) => tech.call("POST", `/api/jobs/${jobA.id}/scan`, { code, direction, ...extra });
const trackA = (code, name, extra = {}) => tech.call("POST", `/api/jobs/${jobA.id}/scan`, { code, step: stepId[name], ...extra });
const xlrTracked = (summary) => summary.lines.find((l) => l.item?.id === xlr.id);
let s = await trackA(k12Serials[0].barcode, "Prepped");
assert.equal(s.status, 200, JSON.stringify(s.json));
assert.match(s.json.message, /→ Prepped \(1 of 2\)/);
assert.equal(s.json.summary.job.status, "confirmed", "prepping some of the kit doesn't move the project on");
s = await trackA(k12Serials[0].barcode, "Prepped");
assert.match(s.json.message, /already Prepped/);
s = await tech.call("POST", `/api/jobs/${jobB.id}/scan`, { code: k12Serials[0].barcode, step: stepId.Prepped });
assert.match(s.json.message, /still with project #/);
s = await trackA(`XLR-${run}`, "Prepped", { quantity: 9 });
assert.match(s.json.message, /Only 8 more/);
s = await trackA(`XLR-${run}`, "Prepped", { quantity: 8 });
assert.equal(s.status, 200);
assert.deepEqual(xlrTracked(s.json.summary).tracking.at, { [stepId.Prepped]: 8 }, "each line has its own tracking");
s = await trackA(`XLR-${run}`, "Prepped");
assert.match(s.json.message, /already Prepped or further along/);
// Straight from the shelf to the truck is fine.
s = await trackA(k12Serials[1].barcode, "Loaded");
assert.equal(s.status, 200);
assert.equal(s.json.summary.trackingSuggestion?.statusName, "Prepped", "everything prepped (or further): Prepped is offered");
assert.equal(jobStatusNamed(s.json.summary.job.jobStatus), "Confirmed", "but the project's status is never changed by tracking");
s = await trackA(`XLR-${run}`, "Loaded", { quantity: 5 });
assert.deepEqual(xlrTracked(s.json.summary).tracking.at, { [stepId.Prepped]: 3, [stepId.Loaded]: 5 }, "the audio can be loaded while the rest is prepped");
assert.equal(s.json.summary.job.status, "confirmed", "not everything's loaded yet");
// The old direction still works: "out" is the first step that's gone.
s = await scanA(`XLR-${run}`, "out", { quantity: 3 });
assert.equal(s.status, 200, JSON.stringify(s.json));
s = await trackA(k12Serials[0].barcode, "Loaded");
const offer = s.json.summary.trackingSuggestion;
assert.equal(offer?.statusName, "Out", "everything loaded: Out is offered");
await tech.fails("POST", `/api/jobs/${jobA.id}/tracking-status`, { status: jobStatusesA.find((x) => x.name === "Returned").id }, 400, /isn't all at a step/);
await bossB.fails("POST", `/api/jobs/${jobA.id}/tracking-status`, { status: offer.status }, 403);
s = { json: { summary: await tech.ok("POST", `/api/jobs/${jobA.id}/tracking-status`, { status: offer.status }) } };
assert.equal(s.json.summary.job.status, "out", "whoever's scanning can take it up");
assert.equal(s.json.summary.trackingSuggestion, null);
s = await trackA(k12Serials[0].barcode, "Prepped");
assert.equal(s.status, 200, "a unit can go back a step");
assert.equal(s.json.summary.trackingSuggestion, null, "nothing's offered backwards");
s = await scanA(`XLR-${run}`, "in", { quantity: 3 });
const xlrPacking = s.json.summary.packing.items.find((p) => p.itemId === xlr.id);
assert.equal(xlrPacking.out, 5);
assert.equal(xlrPacking.returned, 3);
s = await trackA(k12Serials[1].barcode, "Returned");
assert.equal(s.status, 200);
assert.equal(s.json.stage, "back");
s = await scanA(k12Serials[0].barcode, "in");
assert.equal(s.status, 200);
assert.equal(s.json.serial, k12Serials[0].id, "a scan says which unit it was, for reporting a fault");
assert.equal(s.json.item, k12.id);
assert.equal(s.json.summary.job.status, "out", "not everything's back");
s = await scanA("no-such-code", "out");
assert.equal(s.status, 404);
s = await scanA(`BONLY-${run}`, "out");
assert.equal(s.status, 404, "another organisation's barcode means nothing here");
await tech.fails("POST", `/api/jobs/${jobA.id}/scan`, { code: `XLR-${run}`, step: "nope" }, 400, /Pick one of the tracking steps/);
await bossB.fails("POST", `/api/jobs/${jobA.id}/scan`, { code: `XLR-${run}`, direction: "in" }, 403);
const packingHome = await tech.ok("GET", `/api/home/packing?jobs=${jobA.id},${jobInB.id}`);
assert.deepEqual(Object.keys(packingHome), [jobA.id], "only this organisation's projects");
assert.deepEqual(packingHome[jobA.id], { needed: 10, at: { [stepId.Loaded]: 5, [stepId.Returned]: 5 } });

const boardBefore = await tech.ok("GET", "/api/tracking/projects");
const onBoard = boardBefore.find((p) => p.id === jobA.id);
assert.deepEqual([onBoard.needed, onBoard.at], [10, { [stepId.Loaded]: 5, [stepId.Returned]: 5 }], "the board has each project's kit by step");
assert.ok(boardBefore.some((p) => p.id === jobB.id) && !boardBefore.some((p) => p.id === jobInB.id), "this organisation's projects only");

// Kit still out per project (a project's tracked once anything's scanned on
// it; returned with kit out is overdue), for this organisation only.
const outstanding = await tech.ok("GET", "/api/jobs/outstanding");
assert.equal(outstanding[jobA.id]?.units, 5, "5 units still out on A");
assert.ok(!(jobInB.id in outstanding), "only this organisation's projects");

// The organisation's own steps.
const stepBody = (list) => ({ steps: list });
const keep = stepsA.map((x) => ({ id: x.id, name: x.name, stage: x.stage, colour: x.colour, jobStatus: x.jobStatus }));
await tech.fails("PUT", "/api/tracking-steps", stepBody(keep), 403);
await admin.fails("PUT", "/api/tracking-steps", stepBody(keep.filter((x) => x.stage !== "back")), 400, /coming back/);
await admin.fails("PUT", "/api/tracking-steps", stepBody(keep.map((x) => (x.name === "Prepped" ? { ...x, stage: "out" } : x))), 400, /stays getting ready/);
const savedSteps = await admin.ok(
  "PUT",
  "/api/tracking-steps",
  stepBody([{ name: "Checked", stage: "back", colour: "blue" }, ...keep.filter((x) => x.name !== "Prepped"), { name: "Delivered", stage: "out", colour: "amber", jobStatus: "" }]),
);
assert.deepEqual(savedSteps.map((x) => x.name), ["Loaded", "Delivered", "Checked", "Returned"], "kept in stage order, as given within each");
s = await tech.call("GET", `/api/jobs/${jobA.id}/summary`);
assert.ok(s.json.packing.items.every((p) => !(stepId.Prepped in p.at)), "a removed step's kit moves on to the next one");
// Back to the defaults (Prepped is a new step now; Checked and Delivered go).
await admin.ok("PUT", "/api/tracking-steps", stepBody(keep.map((x) => (x.name === "Prepped" ? { ...x, id: undefined } : x))));
log("equipment tracking: steps per line, skipping and going back a step, project statuses offered (never forced), projects without tracking, and each organisation's own steps");

// --- flags and repairs ---
await tech.fails("POST", `/api/serials/${k12Serials[1].id}/status`, { status: "repair" }, 400, /Open a repair/);
await tech.fails("POST", "/api/repairs", { item: k12.id, serials: [k12Serials[1].id], fault: "Blown driver", job: jobInB.id }, 400, /another organisation/);
const statusesOf = async (who) =>
  (await who.ok("GET", `/api/collections/repair_statuses/records?sort=sortOrder&filter=${encodeURIComponent(`org = "${who.org}"`)}`)).items;
const statusesA = await statusesOf(tech);
assert.deepEqual(statusesA.map((st) => st.name), ["Backlog", "To repair", "In repair", "Repaired", "Unrepairable"], "every organisation starts with these");
const st = Object.fromEntries(statusesA.map((x) => [x.name, x.id]));
const repair = await tech.ok("POST", "/api/repairs", { item: k12.id, serials: [k12Serials[1].id], fault: "Blown driver", job: jobA.id });
assert.equal(repair.number, 1);
assert.equal(repair.status, st["To repair"], "new repairs start in the default status");
assert.equal(repair.job, jobA.id, "the project it came back from");
s = await scanA(k12Serials[1].barcode, "out");
assert.match(s.json.message, /flagged repair/);
const afterRepair = await tech.ok("GET", `/api/availability?start=2030-06-01T00:00:00Z&end=2030-06-02T00:00:00Z`);
assert.equal(afterRepair[k12.id].stock, 1, "a unit on repair isn't stock");
await tech.fails("PATCH", `/api/collections/serials/records/${k12Serials[1].id}`, { status: "active" }, 404);
await tech.fails("POST", `/api/serials/${k12Serials[1].id}/status`, { status: "active" }, 400, /on repair R1/);
await tech.fails("POST", "/api/repairs", { item: k12.id, serials: [k12Serials[1].id], fault: "Again" }, 400, /already on repair R1/);
await bossB.fails("PATCH", `/api/repairs/${repair.id}`, { notes: "mine now" }, 403);

// Files: anything goes, one per request, only members can open them.
async function upload(who, repairId, name, bytes, type) {
  const form = new FormData();
  form.append("files", new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/api/repairs/${repairId}/files`, { method: "POST", headers: { Authorization: who.token, "X-Org": who.org }, body: form });
  return { status: r.status, json: await r.json() };
}
let up = await upload(tech, repair.id, "Damage photo.png", whitePng(40, 20), "image/png");
assert.equal(up.status, 200, JSON.stringify(up.json));
up = await upload(tech, repair.id, "PO 4471 (Sennheiser).pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "application/pdf");
assert.equal(up.json.files.length, 2);
const [photoFile, poFile] = up.json.files;
assert.equal(up.json.fileInfo[poFile].name, "PO 4471 (Sennheiser).pdf", "the name it was uploaded with");
assert.equal(up.json.fileInfo[poFile].by, `tech ${run}`, "and who added it");
assert.equal((await upload(bossB, repair.id, "x.txt", Buffer.from("x"), "text/plain")).status, 403);
assert.match((await upload(tech, repair.id, "huge.bin", Buffer.alloc(25.5 * 1024 * 1024), "application/octet-stream")).json.message, /too big/);
assert.equal((await fetch(`${BASE}/api/files/repairs/${repair.id}/${photoFile}`)).status, 404, "files need a token");
const fileToken = async (who) => (await ok(who.token, "POST", "/api/files/token")).token;
assert.equal((await fetch(`${BASE}/api/files/repairs/${repair.id}/${photoFile}?token=${await fileToken(tech)}`)).status, 200);
assert.equal((await fetch(`${BASE}/api/files/repairs/${repair.id}/${photoFile}?token=${await fileToken(bossB)}`)).status, 404, "not for other organisations");
assert.equal((await fetch(`${BASE}/api/files/repairs/${repair.id}/${photoFile}?thumb=200x200&token=${await fileToken(tech)}`)).status, 200);
const lessFiles = await tech.ok("DELETE", `/api/repairs/${repair.id}/files/${poFile}`);
assert.deepEqual(lessFiles.files, [photoFile]);
assert.equal(lessFiles.fileInfo[poFile], undefined);
await tech.fails("DELETE", `/api/repairs/${repair.id}/files/${poFile}`, null, 404);

// Units carry files too (the PO, a warranty), added by people who can edit units.
async function uploadUnit(who, serialId, name) {
  const form = new FormData();
  form.append("files", new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "application/pdf" }), name);
  const r = await fetch(`${BASE}/api/serials/${serialId}/files`, { method: "POST", headers: { Authorization: who.token, "X-Org": who.org }, body: form });
  return { status: r.status, json: await r.json() };
}
const unitUp = await uploadUnit(planner, k12Serials[0].id, "PO 5120.pdf");
assert.equal(unitUp.status, 200, JSON.stringify(unitUp.json));
const unitFile = unitUp.json.files[0];
assert.equal(unitUp.json.fileInfo[unitFile].name, "PO 5120.pdf");
assert.equal((await uploadUnit(tech, k12Serials[0].id, "x.pdf")).status, 403, "techs can't edit units");
assert.equal((await uploadUnit(bossB, k12Serials[0].id, "x.pdf")).status, 403);
assert.equal((await fetch(`${BASE}/api/files/serials/${k12Serials[0].id}/${unitFile}?token=${await fileToken(tech)}`)).status, 200, "members can open them");
assert.equal((await fetch(`${BASE}/api/files/serials/${k12Serials[0].id}/${unitFile}?token=${await fileToken(bossB)}`)).status, 404);
assert.deepEqual((await planner.ok("DELETE", `/api/serials/${k12Serials[0].id}/files/${unitFile}`)).files, []);

const unitStatus = async () => (await tech.ok("GET", `/api/collections/serials/records/${k12Serials[1].id}`)).status;
await tech.fails("PATCH", `/api/repairs/${repair.id}`, { status: (await statusesOf(bossB))[0].id }, 400, /Pick one of the repair statuses/);
await tech.ok("PATCH", `/api/repairs/${repair.id}`, { status: st["Backlog"] });
assert.equal(await unitStatus(), "repair", "the backlog still keeps it out of service");
await tech.ok("PATCH", `/api/repairs/${repair.id}`, { status: st["In repair"], repairer: "Sound Repairs Ltd" });
let fixed = await tech.ok("PATCH", `/api/repairs/${repair.id}`, { status: st["Repaired"], cost: 120.5 });
assert.ok(fixed.closedAt);
assert.equal(await unitStatus(), "active", "repaired puts it back in service");
// Moving it back (a slip, or it's playing up again) takes it out again.
fixed = await tech.ok("PATCH", `/api/repairs/${repair.id}`, { status: st["To repair"] });
assert.deepEqual([fixed.closedAt, await unitStatus()], ["", "repair"]);
await tech.ok("PATCH", `/api/repairs/${repair.id}`, { status: st["Repaired"] });
assert.equal(await unitStatus(), "active");
up = await upload(tech, repair.id, "Invoice.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "application/pdf");
assert.equal(up.status, 200, "files can still be added once it's closed");
const trail = await tech.ok("GET", `/api/repairs/${repair.id}/activity`);
assert.deepEqual(
  trail.map((t) => t.type),
  ["repair_open", "repair_files", "repair_files", "repair_file_removed", ...Array(5).fill("repair_status"), "repair_files"],
);
assert.equal(trail[3].summary, "Removed PO 4471 (Sennheiser).pdf from repair R1");
assert.equal(trail[6].summary, "Set repair R1 to Repaired");
await bossB.fails("GET", `/api/repairs/${repair.id}/activity`, null, 403);

// Bulk: a quantity out of service until it's repaired; unrepairable, it's gone.
await tech.ok("POST", `/api/items/${stand.id}/out-of-service`, { quantity: 1 });
await tech.fails("POST", `/api/items/${stand.id}/out-of-service`, { quantity: 9 }, 400, /more than the stock/);
const standRepair = await tech.ok("POST", "/api/repairs", { item: stand.id, quantity: 2, fault: "Bent legs" });
assert.equal((await tech.ok("GET", `/api/collections/items/records/${stand.id}`)).outOfServiceQty, 3);
await tech.fails("POST", `/api/items/${stand.id}/out-of-service`, { quantity: 1 }, 400, /on open repairs/);
const standStock = async () => {
  const it = await tech.ok("GET", `/api/collections/items/records/${stand.id}`);
  return [it.stockQty, it.outOfServiceQty];
};
await tech.ok("PATCH", `/api/repairs/${standRepair.id}`, { status: st["Unrepairable"] });
assert.deepEqual(await standStock(), [2, 1], "unrepairable: out of stock for good");
await tech.ok("PATCH", `/api/repairs/${standRepair.id}`, { status: st["In repair"] });
assert.deepEqual(await standStock(), [4, 3], "moved back: in stock, out of service");
await tech.ok("PATCH", `/api/repairs/${standRepair.id}`, { status: st["Unrepairable"] });
assert.deepEqual(await standStock(), [2, 1]);

// Statuses are each organisation's own, within limits.
await tech.fails("PUT", "/api/repair-statuses", { statuses: statusesA }, 403);
const parts = { name: "Waiting for parts", stage: "open", colour: "violet" };
let mine = await admin.ok("PUT", "/api/repair-statuses", { statuses: [...statusesA.slice(0, 3), parts, ...statusesA.slice(3)] });
assert.deepEqual(mine.map((x) => x.name), ["Backlog", "To repair", "In repair", "Waiting for parts", "Repaired", "Unrepairable"]);
await admin.fails("PUT", "/api/repair-statuses", { statuses: mine.map((x) => (x.name === "Unrepairable" ? { ...x, stage: "repaired" } : x)) }, 400, /has repairs in it/);
await admin.fails("PUT", "/api/repair-statuses", { statuses: mine.filter((x) => x.stage !== "repaired") }, 400, /repaired kit/);
await admin.fails("PUT", "/api/repair-statuses", { statuses: mine.filter((x) => x.name !== "Unrepairable") }, 400, /1 repair is Unrepairable/);
await admin.fails("PUT", "/api/repair-statuses", { statuses: mine.filter((x) => x.stage !== "open") }, 400, /new repairs to start in/);
await admin.fails("PUT", "/api/repair-statuses", { statuses: [...mine, { name: "backlog", stage: "open" }] }, 400, /two statuses called/);
mine = await admin.ok("PUT", "/api/repair-statuses", {
  statuses: mine.map((x) => ({ ...x, name: x.name === "In repair" ? "At the repairer" : x.name, isDefault: x.name === "Backlog" })),
});
assert.equal(mine.find((x) => x.isDefault).name, "Backlog", "the default can move");
assert.equal((await tech.ok("POST", "/api/repairs", { item: stand.id, quantity: 1, fault: "Wobbly" })).status, st["Backlog"]);
assert.deepEqual((await statusesOf(bossB)).map((x) => x.name), ["Backlog", "To repair", "In repair", "Repaired", "Unrepairable"], "B's are its own");
await bossB.fails("POST", `/api/serials/${k12Serials[0].id}/status`, { status: "lost" }, 403);
log("repairs: kit out of service until repaired or unrepairable, statuses each organisation's own, files and their project, and units can't be flagged around them");

// --- maintenance ---
const harness = await planner.create("items", { name: `Harness ${run}`, kind: "item", tracking: "serial" });
const harnessUnits = [];
for (const n of [1, 2]) harnessUnits.push(await planner.create("serials", { item: harness.id, status: "active" }));
const hats = await planner.create("items", { name: `Hard hat ${run}`, kind: "item", tracking: "bulk", stockQty: 10 });
const jobsOf = async (filter) =>
  (await planner.ok("GET", `/api/collections/maintenance_jobs/records?perPage=200&sort=dueOn&filter=${encodeURIComponent(filter)}`)).items;
const ppeBody = { name: `PPE inspection ${run}`, kind: "inspection", every: 12, unit: "month", items: [harness.id, hats.id], firstDue: "2031-01-15" };
await tech.fails("POST", "/api/maintenance/plans", ppeBody, 403);
await planner.fails("POST", "/api/maintenance/plans", { ...ppeBody, items: [pa.id] }, 400, /is a kit/);
await planner.fails("POST", "/api/maintenance/plans", { ...ppeBody, every: 0 }, 400, /How often/);
await bossB.fails("POST", "/api/maintenance/plans", ppeBody, 400, /doesn't exist/);
const ppe = await planner.ok("POST", "/api/maintenance/plans", ppeBody);
const ppeJobs = await jobsOf(`plan = "${ppe.id}" && status = "scheduled"`);
assert.equal(ppeJobs.length, 3, "one job per harness, and one for the hard hats");
assert.ok(ppeJobs.every((j) => j.dueOn === "2031-01-15" && j.name === ppeBody.name));
const thirdHarness = await planner.create("serials", { item: harness.id, status: "active" });
assert.equal((await jobsOf(`plan = "${ppe.id}" && status = "scheduled"`)).length, 4, "a new unit gets its own job");
await tech.ok("POST", `/api/serials/${thirdHarness.id}/status`, { status: "retired" });
assert.equal((await jobsOf(`plan = "${ppe.id}" && status = "scheduled"`)).length, 3, "a retired one loses its");

const h1Job = ppeJobs.find((j) => j.serial === harnessUnits[0].id);
await tech.fails("POST", `/api/maintenance/jobs/${h1Job.id}/done`, { result: "pass", doneOn: "2099-01-01" }, 400, /future/);
let mDone = await tech.ok("POST", `/api/maintenance/jobs/${h1Job.id}/done`, { result: "pass", doneOn: "2026-03-31", notes: "All good" });
assert.deepEqual([mDone.job.status, mDone.job.result, mDone.job.doneBy], ["done", "pass", `tech ${run}`]);
const h1Next = await jobsOf(`plan = "${ppe.id}" && status = "scheduled" && serial = "${harnessUnits[0].id}"`);
assert.deepEqual(h1Next.map((j) => j.dueOn), ["2027-03-31"], "the next one is a year from the day it was done");
await tech.fails("POST", `/api/maintenance/jobs/${h1Job.id}/done`, { result: "pass" }, 400, /already been done/);
await bossB.fails("POST", `/api/maintenance/jobs/${h1Next[0].id}/done`, { result: "pass" }, 403);

const h2Job = ppeJobs.find((j) => j.serial === harnessUnits[1].id);
mDone = await tech.ok("POST", `/api/maintenance/jobs/${h2Job.id}/done`, { result: "fail", repair: { fault: "Frayed webbing" } });
assert.equal(mDone.job.repair, mDone.repair.id, "a fail can open a repair");
assert.equal((await tech.ok("GET", `/api/collections/serials/records/${harnessUnits[1].id}`)).status, "repair");
assert.equal((await jobsOf(`plan = "${ppe.id}" && status = "scheduled" && serial = "${harnessUnits[1].id}"`)).length, 1, "and it's still on the plan");
const hatJob = ppeJobs.find((j) => j.item === hats.id);
mDone = await tech.ok("POST", `/api/maintenance/jobs/${hatJob.id}/done`, { result: "fail", failedQty: 2, repair: { fault: "Cracked shells" } });
assert.equal(mDone.repair.quantity, 2);
assert.equal((await tech.ok("GET", `/api/collections/items/records/${hats.id}`)).outOfServiceQty, 2);
up = await (async () => {
  const form = new FormData();
  form.append("files", new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "application/pdf" }), "Inspection cert.pdf");
  const r = await fetch(`${BASE}/api/maintenance/jobs/${hatJob.id}/files`, { method: "POST", headers: { Authorization: tech.token, "X-Org": tech.org }, body: form });
  return { status: r.status, json: await r.json() };
})();
assert.equal(up.json.fileInfo[up.json.files[0]].name, "Inspection cert.pdf", "jobs carry files too");

const oneOff = await tech.ok("POST", "/api/maintenance/jobs", { name: "Replace fan", kind: "service", item: k12.id, serials: [k12Serials[0].id], dueOn: "2030-01-10" });
assert.equal(oneOff.length, 1);
assert.equal((await tech.ok("PATCH", `/api/maintenance/jobs/${oneOff[0].id}`, { dueOn: "2030-02-01" })).dueOn, "2030-02-01");
await tech.fails("PATCH", `/api/maintenance/jobs/${h1Next[0].id}`, { name: "Other" }, 400, /plan's name/);
await tech.fails("DELETE", `/api/maintenance/jobs/${h1Next[0].id}`, null, 400, /from a plan/);
await tech.fails("DELETE", `/api/maintenance/jobs/${h1Job.id}`, null, 400, /stays on record/);
await tech.ok("DELETE", `/api/maintenance/jobs/${oneOff[0].id}`);

const batch = await jobsOf(`plan = "${ppe.id}" && status = "scheduled"`);
const passed = await tech.ok("POST", "/api/maintenance/jobs/pass", { ids: [...batch.map((j) => j.id), h1Job.id], doneOn: "2026-04-01" });
assert.equal(passed.done, batch.length, "an inspection day, passed in one go");
assert.match(passed.failed[h1Job.id], /already been done/);

// Taking an item off a plan takes its scheduled job; its history stays.
await planner.ok("PATCH", `/api/maintenance/plans/${ppe.id}`, { items: [harness.id] });
assert.equal((await jobsOf(`plan = "${ppe.id}" && status = "scheduled" && item = "${hats.id}"`)).length, 0);
assert.equal((await jobsOf(`plan = "${ppe.id}" && status = "done" && item = "${hats.id}"`)).length, 2);

// Test & tag keeps each unit's "Next test & tag" (the organisation's
// zone is Pacific/Auckland, so local midnight is 11:00 or 12:00 UTC).
const lamp = await planner.create("items", { name: `Work lamp ${run}`, kind: "item", tracking: "serial" });
const lampA = await planner.create("serials", { item: lamp.id, status: "active", nextInspection: "2030-05-19 12:00:00.000Z" });
const lampB = await planner.create("serials", { item: lamp.id, status: "active" });
const pat = await planner.ok("POST", "/api/maintenance/plans", { name: "Test & tag", kind: "test_tag", every: 3, unit: "month", items: [lamp.id], firstDue: "2031-06-01" });
const patJobs = await jobsOf(`plan = "${pat.id}"`);
assert.equal(patJobs.find((j) => j.serial === lampA.id).dueOn, "2030-05-20", "a unit's own next test date carries on");
assert.equal(patJobs.find((j) => j.serial === lampB.id).dueOn, "2031-06-01");
assert.equal((await planner.ok("GET", `/api/collections/serials/records/${lampB.id}`)).nextInspection, "2031-05-31 12:00:00.000Z");
await planner.ok("PATCH", `/api/collections/serials/records/${lampB.id}`, { nextInspection: "2031-07-09 12:00:00.000Z" });
assert.equal((await jobsOf(`plan = "${pat.id}" && serial = "${lampB.id}"`))[0].dueOn, "2031-07-10", "changing it on the unit moves the test");
await tech.ok("POST", `/api/maintenance/jobs/${patJobs.find((j) => j.serial === lampA.id).id}/done`, { result: "pass", doneOn: "2026-10-01" });
assert.equal((await jobsOf(`plan = "${pat.id}" && status = "scheduled" && serial = "${lampA.id}"`))[0].dueOn, "2027-01-01");
assert.equal((await planner.ok("GET", `/api/collections/serials/records/${lampA.id}`)).nextInspection, "2026-12-31 11:00:00.000Z");
await planner.ok("DELETE", `/api/maintenance/plans/${pat.id}`);
assert.equal((await jobsOf(`serial = "${lampB.id}"`)).length, 0, "a deleted plan's scheduled jobs go");
const lampHistory = await jobsOf(`serial = "${lampA.id}"`);
assert.deepEqual(lampHistory.map((j) => [j.status, j.plan]), [["done", ""]], "its done ones stay");
await admin.fails("DELETE", `/api/collections/serials/records/${lampA.id}`, null, 400, /maintenance on record/);
assert.ok((await admin.ok("GET", "/api/activity")).some((a) => a.type === "maintenance_done" && a.summary === `Recorded ${ppeBody.name}: failed, repair R${mDone.repair.number}`));
log("maintenance: repeating plans schedule each unit, done work schedules the next, fails open repairs, test & tag keeps the units' dates");

// --- how each organisation works: project statuses ---
const jobStatusesOf = async (who) =>
  (await who.ok("GET", `/api/collections/job_statuses/records?sort=sortOrder&filter=${encodeURIComponent(`org = "${who.org}"`)}`)).items;
let flowStatuses = await jobStatusesOf(planner);
assert.deepEqual(flowStatuses.map((x) => x.name), ["Enquiry", "Provisional", "Confirmed", "Prepped", "Out", "Returned", "Cancelled"], "every organisation starts with these");
const flowId = (name) => flowStatuses.find((x) => x.name === name).id;
assert.equal((await jobRecord(jobA)).jobStatus, flowId("Out"), "projects have their stage's status");
const flow = await planner.create("jobs", { name: "Workflow check", prepAt: "2031-02-01 08:00:00Z", returnAt: "2031-02-02 08:00:00Z" });
assert.deepEqual([flow.jobStatus, flow.status], [flowId("Enquiry"), "enquiry"], "new projects start in the default");
let moved = await planner.ok("PATCH", `/api/collections/jobs/records/${flow.id}`, { jobStatus: flowId("Prepped") });
assert.equal(moved.status, "confirmed", "Prepped holds kit like Confirmed");
moved = await planner.ok("PATCH", `/api/collections/jobs/records/${flow.id}`, { status: "provisional" });
assert.equal(moved.jobStatus, flowId("Provisional"), "setting a stage picks its first status");
await planner.fails("PATCH", `/api/collections/jobs/records/${flow.id}`, { jobStatus: (await jobStatusesOf(bossB))[0].id }, 400, /Pick one of the project statuses/);
await planner.fails("PUT", "/api/job-statuses", { statuses: flowStatuses }, 403);
flowStatuses = await admin.ok("PUT", "/api/job-statuses", {
  statuses: [...flowStatuses.slice(0, 4), { name: "Loaded", stage: "out", colour: "orange" }, ...flowStatuses.slice(4)],
});
assert.deepEqual(flowStatuses.map((x) => x.name), ["Enquiry", "Provisional", "Confirmed", "Prepped", "Loaded", "Out", "Returned", "Cancelled"]);
moved = await planner.ok("PATCH", `/api/collections/jobs/records/${flow.id}`, { status: "out" });
assert.equal(moved.jobStatus, flowId("Loaded"), "kit going out (a first scan out) lands on the first out status");
await planner.ok("PATCH", `/api/collections/jobs/records/${flow.id}`, { jobStatus: flowId("Prepped") });
await admin.fails("PUT", "/api/job-statuses", { statuses: flowStatuses.filter((x) => x.name !== "Prepped") }, 400, /1 project is Prepped/);
flowStatuses = await admin.ok("PUT", "/api/job-statuses", {
  statuses: flowStatuses.filter((x) => x.name !== "Prepped"),
  moves: { [flowId("Prepped")]: flowId("Confirmed") },
});
assert.deepEqual([(await jobRecord(flow)).jobStatus, (await jobRecord(flow)).status], [flowId("Confirmed"), "confirmed"], "a removed status's projects move");
await admin.ok("PUT", "/api/job-statuses", { statuses: flowStatuses.map((x) => (x.name === "Confirmed" ? { ...x, stage: "provisional" } : x)) });
assert.equal((await jobRecord(flow)).status, "provisional", "changing a status's stage takes its projects with it");
flowStatuses = await admin.ok("PUT", "/api/job-statuses", { statuses: flowStatuses });
await admin.fails("PUT", "/api/job-statuses", { statuses: flowStatuses.filter((x) => !["enquiry", "provisional", "confirmed"].includes(x.stage)) }, 400, /start in/);
assert.equal((await jobStatusesOf(bossB)).length, 7, "B's are its own");

// --- and which features it uses ---
// What an organisation has is the platform admin's to set, not its own admins'.
await admin.fails("PATCH", `/api/admin/orgs/${orgA}/features`, { features: { scanning: false } }, 403);
await planner.fails("PATCH", `/api/admin/orgs/${orgA}/features`, { features: { scanning: false } }, 403);
let feats = await ok(platform, "PATCH", `/api/admin/orgs/${orgA}/features`, { features: { scanning: false, repairs: false } });
assert.deepEqual([feats.scanning, feats.repairs, feats.pricing], [false, false, true]);
const techInA = (await ok(techUser.token, "GET", "/api/me")).memberships.find((m) => m.org.id === orgA);
assert.ok(!techInA.permissions.includes("scan.out") && techInA.org.features.scanning === false, "a turned-off feature's permissions count for nobody");
await tech.fails("POST", `/api/jobs/${jobA.id}/scan`, { code: "x", direction: "out" }, 403, /Equipment tracking is turned off/);
await tech.fails("POST", "/api/repairs", { item: stand.id, quantity: 1, fault: "x" }, 403, /Repairs is turned off/);
await tech.ok("POST", `/api/serials/${k12Serials[0].id}/status`, { status: "repair" });
await tech.ok("POST", `/api/serials/${k12Serials[0].id}/status`, { status: "active" });
await ok(platform, "PATCH", `/api/admin/orgs/${orgA}/features`, { features: { pricing: false } });
assert.equal((await admin.ok("GET", `/api/jobs/${jobA.id}/summary`)).includesPrices, false, "no prices anywhere, admins included");
await admin.fails("POST", `/api/jobs/${jobA.id}/quotes`, null, 403, /Prices and quotes is turned off/);
await admin.fails("GET", "/api/exports/xero/jobs?from=2030-03-01&to=2030-03-31", null, 403);
feats = await ok(platform, "PATCH", `/api/admin/orgs/${orgA}/features`, { features: { scanning: true, repairs: true, pricing: true } });
assert.ok(Object.values(feats).every(Boolean), "and back on");
assert.ok((await admin.ok("GET", "/api/activity")).some((a) => a.type === "features_changed" && a.summary === "Turned off Equipment tracking, Repairs"));

// Projects off (a venue that plans in Momentus): inventory and maintenance
// only, and what's only for projects goes with it.
feats = await ok(platform, "PATCH", `/api/admin/orgs/${orgA}/features`, { features: { projects: false } });
assert.deepEqual(
  ["projects", "scanning", "pricing", "crew", "xero", "maintenance", "repairs", "labels"].map((k) => feats[k]),
  [false, false, false, false, false, true, true, true],
  "equipment tracking, prices, crew and Xero need projects",
);
await planner.fails("POST", "/api/collections/jobs/records", { org: orgA, name: "Not now", status: "enquiry", prepAt: "2030-05-01 08:00:00Z", returnAt: "2030-05-02 08:00:00Z" }, 403, /Projects is turned off/);
await planner.fails("PATCH", `/api/collections/jobs/records/${jobA.id}`, { name: "Renamed" }, 403, /Projects is turned off/);
await planner.fails("POST", "/api/collections/contacts/records", { org: orgA, name: "Nobody" }, 403, /Projects is turned off/);
await planner.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "other", name: "Nope", start: "2030-03-01 08:00:00Z", end: "2030-03-01 09:00:00Z" }, 403, /Projects is turned off/);
assert.equal((await planner.ok("GET", `/api/collections/jobs/records/${jobA.id}`)).id, jobA.id, "reads still work, so it's all there when it's back");
assert.deepEqual((await planner.ok("GET", `/api/search?q=${encodeURIComponent(jobA.name)}`)).jobs, [], "search leaves projects out");
const plannerMe = await ok(plannerUser.token, "GET", "/api/me");
const plannerPerms = plannerMe.memberships.find((m) => m.org.id === orgA).permissions;
assert.ok(!plannerPerms.includes("jobs.edit") && !plannerPerms.includes("contacts.create") && plannerPerms.includes("units.flag"), JSON.stringify(plannerPerms));
feats = await ok(platform, "PATCH", `/api/admin/orgs/${orgA}/features`, { features: { projects: true } });
assert.ok(Object.values(feats).every(Boolean), "and everything back with it");
// New organisations can start from a preset.
const venueOrg = await ok(platform, "POST", "/api/admin/orgs", { name: `Smoke venue ${run}`, preset: "inventory" });
const venueRecord = await ok(su, "GET", `/api/collections/organisations/records/${venueOrg.id}`);
assert.deepEqual(venueRecord.features, { projects: false, scanning: false, pricing: false, crew: false, integrations: false, xero: false }, "the inventory preset leaves projects off");
await fails(platform, "POST", "/api/admin/orgs", { name: `Smoke bad ${run}`, preset: "nonsense" }, 400, /Unknown starting point/);
log("each organisation's own project statuses on fixed stages, and features it can turn off, projects included");

// --- crew, and everyone's own dashboards and views ---
// Everyone in the organisation can be rostered: members have their crew
// record already, freelancers are added.
const crewPeople = (await planner.ok("GET", `/api/collections/crew_people/records?perPage=200&filter=${encodeURIComponent(`org = "${orgA}"`)}`)).items;
const techPerson = crewPeople.find((p) => p.user === techUser.id);
assert.ok(techPerson && techPerson.name, "members are on the crew list");
const bossPersonB = (await bossB.ok("GET", `/api/collections/crew_people/records?filter=${encodeURIComponent(`user = "${bossUser.id}"`)}`)).items[0];
await planner.create("job_crew", { job: jobA.id, person: techPerson.id, function: "Sound op" });
await planner.fails("POST", "/api/collections/job_crew/records", { org: orgA, job: jobA.id, person: techPerson.id }, 400, /already on the project/);
await planner.fails("POST", "/api/collections/job_crew/records", { org: orgA, job: jobB.id, person: bossPersonB.id }, 400, /another organisation/);
assert.ok((await tech.call("POST", "/api/collections/job_crew/records", { org: orgA, job: jobB.id, person: techPerson.id })).status >= 400, "techs don't plan crew");
assert.ok((await tech.call("POST", "/api/collections/crew_people/records", { org: orgA, name: "Nope" })).status >= 400, "techs don't add freelancers");
await planner.fails("POST", "/api/collections/crew_people/records", { org: orgA, name: "Sneaky", user: techUser.id }, 400);

// Crew roles, needs on schedule items, and rostering people onto them.
const crewRoles = await admin.ok("PUT", "/api/crew-roles", { roles: [{ name: "Audio operator" }, { name: "Technical labour" }] });
assert.deepEqual(crewRoles.map((r) => r.name), ["Audio operator", "Technical labour"]);
const [audioRole, labourRole] = crewRoles;
await planner.fails("PUT", "/api/crew-roles", { roles: [] }, 403);
const freelancer = await planner.create("crew_people", { name: "  Fran Freelance ", phone: "021 555 0101", skills: [labourRole.id] });
assert.equal(freelancer.name, "Fran Freelance");
const packIn = await planner.create("job_periods", { job: jobA.id, kind: "other", name: "Pack in", start: "2030-03-01 08:00:00Z", end: "2030-03-01 12:00:00Z" });
const labourNeed = await planner.create("crew_needs", { job: jobA.id, period: packIn.id, role: labourRole.id, quantity: 1 });
assert.deepEqual([labourNeed.start, labourNeed.end, labourNeed.customTimes], [packIn.start, packIn.end, false], "a need starts on its item's times");
const audioNeed = await planner.create("crew_needs", { job: jobA.id, period: packIn.id, role: audioRole.id, quantity: 1, customTimes: true, start: "2030-03-01 07:00:00Z", end: "2030-03-01 12:00:00Z" });
await planner.ok("PATCH", `/api/collections/job_periods/records/${packIn.id}`, { start: "2030-03-01 09:00:00Z" });
assert.equal((await planner.ok("GET", `/api/collections/crew_needs/records/${labourNeed.id}`)).start, "2030-03-01 09:00:00.000Z", "and moves with it");
assert.equal((await planner.ok("GET", `/api/collections/crew_needs/records/${audioNeed.id}`)).start, "2030-03-01 07:00:00.000Z", "unless it has its own times");
await planner.fails("POST", "/api/collections/crew_needs/records", { org: orgA, job: jobB.id, period: packIn.id, role: labourRole.id, quantity: 1 }, 400, /isn't on this project/);
const filled = await planner.create("job_crew", { job: jobA.id, person: freelancer.id, need: labourNeed.id });
assert.equal(filled.user, "", "freelancers have no login");
await planner.fails("POST", "/api/collections/job_crew/records", { org: orgA, job: jobA.id, person: techPerson.id, need: labourNeed.id }, 400, /spots are filled/);
await planner.fails("PATCH", `/api/collections/crew_needs/records/${labourNeed.id}`, { quantity: 0 }, 400);
const onAudio = await planner.create("job_crew", { job: jobA.id, person: techPerson.id, need: audioNeed.id });
assert.equal(onAudio.user, techUser.id, "members' slots are theirs, for My projects");
// What Rostering and the Crew tab ask for: slots in some dates, across projects.
const enc = encodeURIComponent;
const range = `need.start <= "2030-03-02 00:00:00.000Z" && need.end >= "2030-02-28 00:00:00.000Z"`;
const booked = await tech.ok("GET", `/api/collections/job_crew/records?expand=need,need.role,need.period,job&filter=${enc(`org = "${orgA}" && need != '' && ${range}`)}`);
assert.deepEqual(booked.items.map((b) => b.expand.need.expand.role.name).sort(), ["Audio operator", "Technical labour"], "everyone can see the roster");
const rangedNeeds = await tech.ok("GET", `/api/collections/crew_needs/records?expand=job,period,role&filter=${enc(`org = "${orgA}" && start <= "2030-03-02 00:00:00.000Z" && end >= "2030-02-28 00:00:00.000Z" && job.status != 'cancelled'`)}`);
assert.equal(rangedNeeds.items.length, 2);
assert.equal(rangedNeeds.items[0].expand.period.name, "Pack in");
const myCrew = await tech.ok("GET", `/api/collections/job_crew/records?expand=job,need,need.role,need.period&filter=${enc(`user = "${techUser.id}"`)}`);
assert.ok(myCrew.items.some((c) => c.expand.need?.expand?.role?.name === "Audio operator"), "and their own slots, for My projects");
await admin.fails("PUT", "/api/crew-roles", { roles: [{ id: audioRole.id, name: "Audio operator" }] }, 400, /Technical labour is needed/);
await planner.fails("DELETE", `/api/collections/crew_people/records/${freelancer.id}`, null, 400, /archive them instead/);
await planner.ok("DELETE", `/api/collections/job_periods/records/${packIn.id}`);
assert.equal((await planner.ok("GET", `/api/collections/job_crew/records?filter=${encodeURIComponent(`need = "${labourNeed.id}" || need = "${audioNeed.id}"`)}`)).items.length, 0, "removing the item takes its crew off it");
await planner.ok("DELETE", `/api/collections/crew_people/records/${freelancer.id}`);
for (const page of ["crew", "rostering", "maintenance", "repairs", "maintenance-history"]) assert.ok(Array.isArray((await tech.ok("GET", `/api/views?page=${page}`)).views), `${page} has saved views`);
log("crew roles, crew needs on schedule items, and rostering members and freelancers onto them");
const minePage = await tech.ok("GET", `/api/collections/jobs/records?filter=${encodeURIComponent(`org = "${orgA}" && job_crew_via_job.user ?= "${techUser.id}"`)}`);
assert.deepEqual(minePage.items.map((j) => j.id), [jobA.id], "my projects are the ones I'm crew on");
const packingNow = await tech.ok("GET", `/api/home/packing?jobs=${jobA.id},${jobB.id}`);
assert.ok(packingNow[jobA.id].needed > 0 && Object.keys(packingNow[jobA.id].at).length > 0, JSON.stringify(packingNow));

let dash = await tech.ok("GET", "/api/dashboards");
assert.deepEqual(dash.dashboards.map((d) => d.name).sort(), ["My projects", "Overview", "Workshop"], "everyone starts with these");
const overview = dash.dashboards.find((d) => d.name === "Overview");
assert.deepEqual([dash.defaultId, dash.home], [overview.id, ""]);
await tech.fails("PATCH", `/api/dashboards/${overview.id}`, { panels: ["mine"] }, 403, /organisation's own/);
await tech.fails("POST", "/api/dashboards", { name: "x", panels: ["Not a panel"] }, 400, /Not a panel/);
const myDash = await tech.ok("POST", "/api/dashboards", { name: "My week", panels: ["mine", "going-out", { id: "repairs" }] });
assert.deepEqual(myDash.panels, [{ id: "mine" }, { id: "going-out" }, { id: "repairs" }]);
assert.ok(!(await planner.ok("GET", "/api/dashboards")).dashboards.some((d) => d.id === myDash.id), "your own until you share it");
await tech.ok("PATCH", `/api/dashboards/${myDash.id}`, { sharedWith: [plannerUser.id] });
assert.ok((await planner.ok("GET", "/api/dashboards")).dashboards.some((d) => d.id === myDash.id && !d.canEdit), "shared with one person");
await planner.fails("PATCH", `/api/dashboards/${myDash.id}`, { name: "Mine now" }, 403, /owner/);
await tech.fails("PATCH", `/api/dashboards/${myDash.id}`, { sharedWith: [bossUser.id] }, 400, /in this organisation/);
await tech.fails("PATCH", `/api/dashboards/${myDash.id}`, { public: true }, 403, /share with everyone/);
const company = await admin.ok("POST", "/api/dashboards", { name: "Company", panels: ["glance"], public: true });
assert.ok((await tech.ok("GET", "/api/dashboards")).dashboards.some((d) => d.id === company.id), "admins can share with everyone");
await admin.ok("PATCH", `/api/dashboards/${company.id}`, { isDefault: true });
assert.equal((await tech.ok("GET", "/api/dashboards")).defaultId, company.id, "and pick everyone's Home");
await admin.fails("DELETE", `/api/dashboards/${company.id}`, null, 400, /default/);
await admin.ok("PATCH", `/api/dashboards/${overview.id}`, { isDefault: true });
await tech.ok("PUT", "/api/me/home", { dashboard: myDash.id });
assert.equal((await tech.ok("GET", "/api/dashboards")).home, myDash.id, "your own Home");
const secret = await admin.ok("POST", "/api/dashboards", { name: "Secret", panels: ["quotes"] });
await planner.fails("PUT", "/api/me/home", { dashboard: secret.id }, 404);

const savedView = await tech.ok("POST", "/api/views", { page: "projects", name: "Out now", config: { view: "out" } });
const viewsOf = async (who, page) => (await who.ok("GET", `/api/views?page=${page}`)).views;
assert.ok(!(await viewsOf(planner, "projects")).some((v) => v.id === savedView.id));
await tech.ok("PATCH", `/api/views/${savedView.id}`, { sharedWith: [plannerUser.id] });
assert.deepEqual((await viewsOf(planner, "projects")).find((v) => v.id === savedView.id).config, { view: "out" });
await tech.fails("PATCH", `/api/views/${savedView.id}`, { public: true }, 403);
// Every list page's views work the same: Inventory's keep filters and columns.
await tech.fails("POST", "/api/views", { page: "inventory", name: "Speakers", config: { columns: ["name"] }, public: true }, 403);
await tech.fails("POST", "/api/views", { page: "nope", name: "Speakers", config: {} }, 400, /Which page/);
const invConfig = { type: "Serialised", archived: false, unavailable: false, columns: ["code", "stock"], widths: { name: 300 }, sortKey: "name", sortDir: "asc" };
const invView = await admin.ok("POST", "/api/views", { page: "inventory", name: "All speakers", config: invConfig, public: true });
let invViews = await tech.ok("GET", "/api/views?page=inventory");
assert.ok(invViews.views.some((v) => v.id === invView.id && v.public && !v.canEdit), "inventory views share the same way");
assert.deepEqual(invViews.views.find((v) => v.id === invView.id).config, invConfig, "filters and columns are kept");
assert.equal(invViews.pick, "");
assert.equal(invViews.defaultId, "", "no default until someone picks one");
// The organisation's default for a page, and each person's own pick.
await tech.fails("PATCH", `/api/views/${invView.id}`, { isDefault: true }, 403);
await admin.ok("PATCH", `/api/views/${invView.id}`, { isDefault: true });
assert.equal((await tech.ok("GET", "/api/views?page=inventory")).defaultId, invView.id, "everyone gets the default");
await admin.fails("DELETE", `/api/views/${invView.id}`, null, 400, /default view/);
await admin.fails("PATCH", `/api/views/${invView.id}`, { public: false }, 400, /has to be shared with everyone/);
await tech.ok("PUT", "/api/me/views/inventory", { view: "standard" });
assert.equal((await tech.ok("GET", "/api/views?page=inventory")).pick, "standard", "picking the page as it comes");
await tech.fails("PUT", "/api/me/views/inventory", { view: savedView.id }, 404);
await tech.ok("PUT", "/api/me/views/projects", { view: savedView.id });
assert.equal((await tech.ok("GET", "/api/views?page=projects")).pick, savedView.id);
assert.equal((await planner.ok("GET", "/api/views?page=inventory")).pick, "", "picks are each person's own");
const adminInA = (await ok(adminUser.token, "GET", "/api/me")).memberships.find((m) => m.org.id === orgA);
assert.ok(adminInA.permissions.includes("views.publish") && !techInA.permissions.includes("views.publish"), "only admins publish, to start with");
log("crew on projects, and everyone's own dashboards and views, shared with people or (admins) everyone");

// --- delete protection ---
await admin.fails("DELETE", `/api/collections/serials/records/${k12Serials[1].id}`, null, 400, /scanned on a project|repairs on record/);
const spareMic = await planner.create("items", { name: `Spare mic ${run}`, kind: "item", tracking: "bulk", stockQty: 2 });
await tech.ok("PATCH", `/api/repairs/${(await tech.ok("POST", "/api/repairs", { item: spareMic.id, quantity: 1, fault: "Dented grille" })).id}`, { status: st["Repaired"] });
await admin.fails("DELETE", `/api/collections/items/records/${spareMic.id}`, null, 400, /repairs on record/);
await planner.fails("DELETE", `/api/collections/items/records/${xlr.id}`, null, 400, /archive it instead/);
await planner.fails("DELETE", `/api/collections/contacts/records/${client.id}`, null, 400, /archive it instead/);
await planner.fails("DELETE", `/api/collections/jobs/records/${jobA.id}`, null, 400);
await planner.fails("POST", "/api/collections/job_lines/records", { org: orgA, job: jobA.id, lineType: "custom", quantity: 1, priceMode: "fixed" }, 403);
log("things in use can't be deleted, and job lines can't be written around the routes");

// --- search, lookup, CSV import ---
const found = await tech.ok("GET", `/api/search?q=${encodeURIComponent(run)}`);
assert.ok(found.items.length >= 3 && found.assets.length === 2 && found.jobs.length === 2);
assert.ok(found.items.every((i) => i.id !== xlrB.id && i.id !== secretB.id), "search stays in the organisation");
const byNumber = await tech.ok("GET", `/api/search?q=%23${jobA.number}`);
assert.deepEqual(byNumber.jobs.map((j) => j.id), [jobA.id], "B's job #1001 isn't found from A");
const look = await tech.ok("GET", `/api/lookup?code=${k12Serials[0].barcode}`);
assert.deepEqual(look, { kind: "serial", id: k12Serials[0].id, itemId: k12.id });

const csvRows = [
  { name: `Desk ${run}`, code: `DESK-${run}`, category: `Audio ${run} / Desks`, quantity: "", price: "$1,200.50", serials: `D-${run}-1; D-${run}-2` },
  { name: `Gaffa ${run}`, quantity: "48", price: "0" },
];
let csv = await planner.ok("POST", "/api/import/csv", { kind: "items", rows: csvRows, dryRun: true });
assert.deepEqual(csv.counts, { items: 2, serials: 2 });
assert.equal(csv.committed, false);
csv = await planner.ok("POST", "/api/import/csv", { kind: "items", rows: [...csvRows, { name: "" }] });
assert.equal(csv.committed, false, "one bad row rolls the whole file back");
assert.equal(csv.errors[0].row, 4);
csv = await planner.ok("POST", "/api/import/csv", { kind: "items", rows: csvRows });
assert.equal(csv.committed, true);
const desks = await planner.ok("GET", `/api/collections/categories/records?filter=${encodeURIComponent(`name="Desks"`)}`);
assert.equal(desks.items[0].parent, audio.id, "category path reuses the existing parent");
assert.equal(desks.items[0].org, orgA);
assert.equal((await bossB.ok("POST", "/api/import/csv", { kind: "items", rows: csvRows })).committed, true, "B can import the same codes");
// Address lookup: too short to look up (and nothing goes out for it).
assert.deepEqual(await tech.ok("GET", "/api/addresses?q=ab"), []);
log("search, scan lookup and CSV import (dry run, all-or-nothing, category paths, per organisation)");

// --- calendar feed (covers the next year, so it needs a job inside that) ---
const soon = await planner.create("jobs", {
  name: `Feed check ${run}`,
  status: "provisional",
  prepAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  returnAt: new Date(Date.now() + 8 * 86400000).toISOString(),
});
await bossB.create("jobs", {
  name: `B feed ${run}`,
  status: "confirmed",
  prepAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  returnAt: new Date(Date.now() + 8 * 86400000).toISOString(),
});
await tech.fails("GET", "/api/ical/link", null, 403);
const { url: feed } = await admin.ok("GET", "/api/ical/link");
const feedPath = new URL(feed).pathname;
const ics = await (await fetch(BASE + feedPath)).text();
assert.match(ics, /BEGIN:VCALENDAR/);
assert.match(ics, new RegExp(`SUMMARY:#${soon.number} Feed check ${run} \\(Provisional\\)`));
assert.doesNotMatch(ics, new RegExp(`B feed ${run}`), "only this organisation's jobs");
assert.doesNotMatch(ics, new RegExp(`#${jobA.number} `), "jobs years away aren't in the feed");
assert.equal((await fetch(BASE + "/api/ical/not-the-token/jobs.ics")).status, 404);
await admin.ok("POST", "/api/ical/rotate");
assert.equal((await fetch(BASE + feedPath)).status, 404, "the old address stops working once rotated");
log("calendar feed: secret address per organisation, jobs as events, rotation");

const stats = await admin.ok("GET", "/api/stats");
assert.ok(stats.items >= 5);
assert.equal(stats.users, 3);
const activity = await admin.ok("GET", "/api/activity");
assert.ok(activity.some((a) => a.type === "scan_out" && a.summary.includes(`#${jobA.number}`)));
assert.ok(activity.every((a) => !String(a.summary).includes(`B feed ${run}`)));
log("stats and activity feed");

// --- stock by location ---
// A bulk item's stock is a quantity per location; the item's total follows.
const [mainStore] = (await admin.ok("GET", `/api/collections/locations/records?filter=${encodeURIComponent(`org = "${orgA}"`)}&sort=created`)).items;
const theatre = await admin.create("locations", { name: `Theatre ${run}` });
const mics = await planner.create("items", { name: `SM58 ${run}`, kind: "item", tracking: "bulk", stockQty: 8 });
const micRows = async () =>
  (await planner.ok("GET", `/api/collections/item_stock/records?filter=${encodeURIComponent(`item = "${mics.id}"`)}&sort=created`)).items.map((r) => [r.location, r.qty, r.bin]);
const micTotal = async () => (await planner.ok("GET", `/api/collections/items/records/${mics.id}`)).stockQty;
assert.deepEqual(await micRows(), [[mainStore.id, 8, ""]], "stock owned starts at the first location");
const micsMoved = await planner.ok("PUT", `/api/items/${mics.id}/stock`, {
  stock: [
    { location: mainStore.id, qty: 3, bin: " Bay 3 " },
    { location: theatre.id, qty: 5 },
  ],
});
assert.equal(micsMoved.item.stockQty, 8);
assert.deepEqual(await micRows(), [[mainStore.id, 3, "Bay 3"], [theatre.id, 5, ""]]);
await planner.ok("PUT", `/api/items/${mics.id}/stock`, { stock: [{ location: theatre.id, qty: 6 }] });
assert.deepEqual([await micRows(), await micTotal()], [[[theatre.id, 6, ""]], 6], "lines left out are removed");
await planner.fails("PUT", `/api/items/${mics.id}/stock`, { stock: [{ location: theatre.id, qty: 1 }, { location: theatre.id, qty: 1 }] }, 400, /once/);
await tech.fails("PUT", `/api/items/${mics.id}/stock`, { stock: [] }, 403);
await bossB.fails("PUT", `/api/items/${mics.id}/stock`, { stock: [] }, 403);
const otherPlace = await bossB.create("locations", { name: `Elsewhere ${run}` });
await planner.fails("PUT", `/api/items/${mics.id}/stock`, { stock: [{ location: otherPlace.id, qty: 1 }] }, 400, /another organisation/);
// Rows changed through the records API move the total too, and the total
// changed some other way moves the rows.
const extra = await planner.create("item_stock", { item: mics.id, location: mainStore.id, qty: 2 });
assert.equal(await micTotal(), 8);
await planner.ok("PATCH", `/api/collections/items/records/${mics.id}`, { stockQty: 5 });
assert.deepEqual(await micRows(), [[theatre.id, 3, ""], [mainStore.id, 2, ""]], "less comes off the largest first");
await planner.ok("DELETE", `/api/collections/item_stock/records/${extra.id}`);
assert.equal(await micTotal(), 3);
// Out of service can't be more than what's left.
await tech.ok("POST", `/api/items/${mics.id}/out-of-service`, { quantity: 2 });
await planner.fails("PUT", `/api/items/${mics.id}/stock`, { stock: [{ location: theatre.id, qty: 1 }] }, 400, /out of service/);
const serialMic = await planner.create("items", { name: `Serial mic ${run}`, kind: "item", tracking: "serial" });
await planner.fails("POST", "/api/collections/item_stock/records", { org: orgA, item: serialMic.id, location: theatre.id, qty: 1 }, 400, /isn't bulk/);
// A location with stock in it can't be deleted.
await admin.fails("DELETE", `/api/collections/locations/records/${theatre.id}`, null, 400);
// Packing lists say where it's kept.
const stockJob = await planner.create("jobs", { name: `Stock job ${run}`, status: "confirmed", prepAt: "2031-05-01 08:00:00Z", returnAt: "2031-05-02 08:00:00Z" });
await planner.ok("PUT", `/api/items/${mics.id}/stock`, { stock: [{ location: mainStore.id, qty: 1, bin: "Bay 3" }, { location: theatre.id, qty: 4 }] });
await planner.ok("POST", `/api/jobs/${stockJob.id}/lines`, { itemId: mics.id, quantity: 1 });
const stockSummary = await planner.ok("GET", `/api/jobs/${stockJob.id}/summary`);
assert.equal(stockSummary.lines.find((l) => l.item?.id === mics.id).item.where, `${mainStore.name}, Bay 3 ×1 · Theatre ${run} ×4`);
log("stock by location: per-location quantities and bins, the item's total kept in step both ways");

// --- print agents ---
// R2 in the cloud can't reach a venue's printers, so a print agent there
// (print/r2_print_agent.py) collects the labels and sends them on. Here the
// test plays the agent.
const madeAgent = await admin.ok("POST", "/api/print-agents", { name: `Pi ${run}` });
assert.match(madeAgent.token, /^r2pa_[a-z0-9]{32}$/);
assert.equal(madeAgent.agent.online, false);
await tech.fails("GET", "/api/print-agents", null, 403);
const agentCall = (method, path, body, token = madeAgent.token) => call(`Bearer ${token}`, method, path, body);
const printingNow = await admin.ok("GET", "/api/printing");
const viaAgent = { id: `agent-printer-${run}`, name: "Workshop QL", host: "192.0.2.10", model: "QL-810W", sizeId: "tape-62", locationId: "", agentId: madeAgent.agent.id, isDefault: true, enabled: true };
const otherAgent = await bossB.ok("POST", "/api/print-agents", { name: `B's Pi ${run}` });
await admin.fails("PUT", "/api/printing", { sizes: printingNow.sizes, printers: [{ ...viaAgent, agentId: otherAgent.agent.id }] }, 400, /print agent/);
await admin.ok("PUT", "/api/printing", { sizes: printingNow.sizes, printers: [viaAgent] });
assert.match((await tech.ok("POST", "/api/printing/check", {}))[viaAgent.id].message, /offline/, "not heard from yet");
assert.equal((await tech.call("POST", "/api/print", { customText: "Early", imageDataUrl: "data:image/png;base64," + whitePng(696, 60).toString("base64"), label: "62" })).status, 502);
assert.equal((await agentCall("GET", "/api/print-agent/jobs?wait=0", null, "r2pa_" + "x".repeat(32))).status, 401);
const firstAsk = await agentCall("GET", "/api/print-agent/jobs?wait=0");
assert.deepEqual(firstAsk.json, { jobs: [], printers: [{ id: viaAgent.id, name: "Workshop QL", host: "192.0.2.10" }] });
assert.deepEqual((await agentCall("GET", "/api/print-agent/jobs?wait=0", null, otherAgent.token)).json.printers, [], "each agent sees its own organisation's printers");
await agentCall("POST", "/api/print-agent/status", { printers: { [viaAgent.id]: { ok: true, message: "Online", host: "192.0.2.10" } }, version: "1", hostname: "pi" });
assert.deepEqual((await tech.ok("POST", "/api/printing/check", {}))[viaAgent.id], { ok: true, message: "Online" });
// A label: the server makes the printer's commands, the agent takes them.
const labelPng = "data:image/png;base64," + whitePng(696, 60).toString("base64");
const printing1 = tech.call("POST", "/api/print", { customText: `Agent ${run}`, imageDataUrl: labelPng, label: "62" });
const taken = (await agentCall("GET", "/api/print-agent/jobs?wait=10")).json.jobs;
assert.equal(taken.length, 1);
assert.equal(taken[0].host, "192.0.2.10");
const commands = Buffer.from(taken[0].data, "base64");
assert.ok(commands.length > 500 && commands.includes(Buffer.from([0x1b, 0x40])), "Brother raster commands, with the initialise");
await agentCall("POST", `/api/print-agent/jobs/${taken[0].id}`, { ok: true, message: "Printed" });
const printed1 = await printing1;
assert.equal(printed1.status, 200, JSON.stringify(printed1.json));
assert.equal(printed1.json.printer, "Workshop QL");
// One the agent can't get to its printer is "unreachable", so the app tries another.
const printing2 = tech.call("POST", "/api/print", { customText: `Agent ${run}`, imageDataUrl: labelPng, label: "62" });
const taken2 = (await agentCall("GET", "/api/print-agent/jobs?wait=10")).json.jobs;
await agentCall("POST", `/api/print-agent/jobs/${taken2[0].id}`, { ok: false, unreachable: true, message: "Couldn't reach the printer" });
const printed2 = await printing2;
assert.equal(printed2.status, 502);
assert.match(printed2.json.message, /Couldn't reach/);
// Removing: not while a printer uses it; a new token retires the old one.
await admin.fails("DELETE", `/api/print-agents/${madeAgent.agent.id}`, null, 400, /Workshop QL/);
const rotated = await admin.ok("POST", `/api/print-agents/${madeAgent.agent.id}/token`);
assert.equal((await agentCall("GET", "/api/print-agent/jobs?wait=0")).status, 401);
assert.equal((await agentCall("GET", "/api/print-agent/jobs?wait=0", null, rotated.token)).status, 200);
await admin.ok("PUT", "/api/printing", { sizes: printingNow.sizes, printers: printingNow.printers });
await admin.ok("DELETE", `/api/print-agents/${madeAgent.agent.id}`);
assert.equal((await agentCall("GET", "/api/print-agent/jobs?wait=0", null, rotated.token)).status, 401);
assert.match((await call(null, "GET", "/api/print-agent/script")).json || "", /R2 print agent/);
log("print agents: labels from the cloud to a venue's printer through its agent, each agent its own organisation's");

// --- platform admin ---
const orgs = await ok(platform, "GET", "/api/admin/orgs");
const rowA = orgs.find((o) => o.id === orgA);
assert.equal(rowA.members, 3);
assert.ok(rowA.items >= 5);
const everyone = await ok(platform, "GET", "/api/admin/users");
assert.deepEqual(
  everyone.find((u) => u.email === `tech-${run}@example.com`).memberships.map((m) => m.roleName).sort(),
  ["Admin", "Tech"],
);
await fails(platform, "PATCH", `/api/admin/users/${everyone.find((u) => u.email === `platform-${run}@example.com`).id}`, { isPlatformAdmin: false }, 400, /your own/);
await fails(platform, "DELETE", `/api/admin/users/${adminUser.id}`, null, 400, /only admin/);
await ok(platform, "DELETE", `/api/admin/users/${decliner.id}`);

// Suspending locks members out without deleting anything.
await ok(platform, "PATCH", `/api/admin/orgs/${orgB}`, { suspended: true });
await bossB.fails("GET", "/api/app-settings", null, 403, /suspended/);
assert.equal((await bossB.ok("GET", `/api/collections/items/records?filter=${encodeURIComponent(`org = "${orgB}"`)}`)).totalItems, 0);
assert.equal((await ok(techUser.token, "GET", "/api/me")).memberships.find((m) => m.org.id === orgB).org.suspended, true);
await ok(platform, "PATCH", `/api/admin/orgs/${orgB}`, { suspended: false });
assert.ok((await bossB.ok("GET", `/api/collections/items/records?filter=${encodeURIComponent(`org = "${orgB}"`)}`)).totalItems >= 2);

// Deleting an organisation takes everything in it.
const orgC = (await ok(platform, "POST", "/api/admin/orgs", { name: `Smoke C ${run}`, adminEmail: `admin-${run}@example.com` })).id;
await ok(adminUser.token, "POST", `/api/invitations/${(await ok(adminUser.token, "GET", "/api/me")).invitations.find((i) => i.orgId === orgC).id}/accept`);
const adminC = as(adminUser.token, orgC);
const itemC = await adminC.create("items", { name: "Doomed", kind: "item", tracking: "bulk", stockQty: 1 });
const jobC = await adminC.create("jobs", { name: "Doomed job", status: "confirmed", prepAt: "2030-05-01 08:00:00Z", returnAt: "2030-05-02 08:00:00Z" });
await adminC.ok("POST", `/api/jobs/${jobC.id}/lines`, { itemId: itemC.id, quantity: 1 });
await adminC.ok("POST", `/api/jobs/${jobC.id}/quotes`);
const repairC = await adminC.ok("POST", "/api/repairs", { item: itemC.id, quantity: 1, fault: "Doomed too", job: jobC.id });
assert.equal((await upload(adminC, repairC.id, "photo.png", whitePng(4, 4), "image/png")).status, 200);
const planC = await adminC.ok("POST", "/api/maintenance/plans", { name: "Doomed plan", kind: "service", every: 1, unit: "week", items: [itemC.id] });
const [jobOfC] = (await adminC.ok("GET", `/api/collections/maintenance_jobs/records?filter=${encodeURIComponent(`plan = "${planC.id}"`)}`)).items;
await adminC.ok("POST", `/api/maintenance/jobs/${jobOfC.id}/done`, { result: "pass" });
// A unit with a file and a repair, and a print agent, go too.
const serialItemC = await adminC.create("items", { name: "Doomed serial", kind: "item", tracking: "serial" });
const unitC = await adminC.create("serials", { item: serialItemC.id, status: "active" });
assert.equal((await uploadUnit(adminC, unitC.id, "manual.pdf")).status, 200);
await adminC.ok("POST", "/api/repairs", { item: serialItemC.id, serials: [unitC.id], fault: "Doomed unit" });
const agentC = await adminC.ok("POST", "/api/print-agents", { name: "Doomed agent" });
await fails(platform, "DELETE", `/api/admin/orgs/${orgC}`, { confirm: "wrong" }, 400, /exactly/);
await ok(platform, "DELETE", `/api/admin/orgs/${orgC}`, { confirm: `Smoke C ${run}` });
await fails(su, "GET", `/api/collections/items/records/${itemC.id}`, null, 404);
await fails(su, "GET", `/api/collections/jobs/records/${jobC.id}`, null, 404);
await fails(su, "GET", `/api/collections/repairs/records/${repairC.id}`, null, 404);
await fails(su, "GET", `/api/collections/serials/records/${unitC.id}`, null, 404);
assert.equal((await call(`Bearer ${agentC.token}`, "GET", "/api/print-agent/jobs?wait=0")).status, 401);
assert.equal((await ok(adminUser.token, "GET", "/api/me")).memberships.some((m) => m.org.id === orgC), false);
log("platform admin: organisation and account overview, suspension, deletion, and guard rails");

console.log(`\nAll ${step} checks passed.`);
