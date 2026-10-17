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

// Every organisation starts with Admin, Planner and Tech.
const roleIds = async (who) => Object.fromEntries((await who.ok("GET", `/api/orgs/${who.org}/roles`)).map((r) => [r.name, r.id]));
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
const crew = await tech.ok("POST", `/api/orgs/${orgA}/roles`, { name: "Crew", permissions: ["scan.out", "scan.in"] });
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
assert.equal(listedRoles.find((r) => r.name === "Crew").invitations, 1);
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

const k12 = await planner.create("items", { name: `QSC K12 ${run}`, kind: "item", tracking: "serial", dayRate: 80, category: speakers.id });
const stand = await planner.create("items", { name: `Speaker stand ${run}`, kind: "item", tracking: "bulk", stockQty: 4, dayRate: 10 });
const xlr = await planner.create("items", { name: `XLR 10m ${run}`, kind: "item", tracking: "bulk", stockQty: 20, dayRate: 2, barcode: `XLR-${run}` });
const k12Serials = [];
for (const n of [1, 2]) {
  k12Serials.push(await planner.create("serials", { item: k12.id, barcode: `K12-${run}-${n}`, status: "active" }));
}
await planner.fails("POST", "/api/collections/serials/records", { org: orgA, item: xlr.id, barcode: `X-${run}`, status: "active" }, 400, /isn't tracked by serial/);
await planner.fails("POST", "/api/collections/serials/records", { org: orgA, item: k12.id, barcode: `XLR-${run}`, status: "active" }, 400, /already used/);
const pa = await planner.create("items", { name: `PA pair ${run}`, kind: "kit", dayRate: 200 });
await planner.create("item_components", { parent: pa.id, child: k12.id, kind: "component", quantity: 2 });
await planner.create("item_components", { parent: k12.id, child: stand.id, kind: "accessory", quantity: 1 });
await planner.fails("POST", "/api/collections/item_components/records", { org: orgA, parent: xlr.id, child: stand.id, kind: "component", quantity: 1 }, 400, /isn't a kit/);
await planner.fails("POST", "/api/collections/item_components/records", { org: orgA, parent: k12.id, child: pa.id, kind: "accessory", quantity: 1 }, 400, /nested/);
log("catalogue: categories, bulk + serial items, a kit, an accessory, and the rules around them");

const client = await planner.create("contacts", { name: `Client ${run}`, email: `client-${run}@example.com` });
const venue = await planner.create("venues", { name: `Venue ${run}` });

// --- the other organisation, with clashing codes ---
const xlrB = await bossB.create("items", { name: `B's XLR ${run}`, kind: "item", tracking: "bulk", stockQty: 3, dayRate: 9, barcode: `XLR-${run}` });
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
const showDay2 = await planner.create("job_periods", { job: jobA.id, kind: "billing", name: "Encore", start: "2030-03-03 18:00:00Z", end: "2030-03-03 22:00:00Z" });
let derived = await jobRecord(jobA);
assert.equal(derived.startAt, "2030-02-28 20:00:00.000Z", "the project starts at its earliest period");
assert.equal(derived.prepAt, "2030-03-01 08:00:00.000Z", "a crew call doesn't book the kit");
assert.equal(derived.billingEnd, "2030-03-03 22:00:00.000Z");
const charged = (await planner.ok("GET", `/api/jobs/${jobA.id}/summary`)).pricing;
assert.equal(charged.basis, "billing");
assert.equal(charged.days, 2, "overlapping billing periods count once");
await planner.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 09:00:00Z" }, 400, /end after it starts/);
await tech.fails("POST", "/api/collections/job_periods/records", { org: orgA, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 11:00:00Z" }, 400);
await bossB.fails("POST", "/api/collections/job_periods/records", { org: orgB, job: jobA.id, kind: "other", name: "x", start: "2030-03-02 10:00:00Z", end: "2030-03-02 11:00:00Z" }, 400, /another organisation/);
await planner.ok("DELETE", `/api/collections/job_periods/records/${crewCall.id}`);
await planner.ok("DELETE", `/api/collections/job_periods/records/${showDay2.id}`);
derived = await jobRecord(jobA);
assert.equal(derived.startAt, "2030-03-01 08:00:00.000Z", "removing periods shrinks the project back");
assert.equal(derived.billingEnd, "2030-03-03 20:00:00.000Z");
log("the schedule: usage books the kit, billing sets the charge, both always kept, only the project's own planners can change it");

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

// --- scanning ---
const scanA = (code, direction, extra = {}) => tech.call("POST", `/api/jobs/${jobA.id}/scan`, { code, direction, ...extra });
let s = await scanA(k12Serials[0].barcode, "out");
assert.equal(s.status, 200, JSON.stringify(s.json));
assert.equal(s.json.summary.job.status, "out", "first scan out moves the job to out");
s = await scanA(k12Serials[0].barcode, "out");
assert.match(s.json.message, /already out on this project/);
s = await tech.call("POST", `/api/jobs/${jobB.id}/scan`, { code: k12Serials[0].barcode, direction: "out" });
assert.match(s.json.message, /still out on project #/);
s = await scanA(`XLR-${run}`, "out", { quantity: 9 });
assert.match(s.json.message, /Only 8 more/);
s = await scanA(`XLR-${run}`, "out", { quantity: 8 });
assert.equal(s.status, 200);
s = await scanA(`XLR-${run}`, "in", { quantity: 3 });
const xlrPacking = s.json.summary.packing.items.find((p) => p.itemId === xlr.id);
assert.equal(xlrPacking.out, 5);
s = await scanA(k12Serials[0].barcode, "in");
assert.equal(s.status, 200);
s = await scanA("no-such-code", "out");
assert.equal(s.status, 404);
s = await scanA(`BONLY-${run}`, "out");
assert.equal(s.status, 404, "another organisation's barcode means nothing here");
await bossB.fails("POST", `/api/jobs/${jobA.id}/scan`, { code: `XLR-${run}`, direction: "in" }, 403);
log("scanning: double-scans, cross-job scans, over-scans and other organisations' codes refused");

// --- flags ---
await tech.ok("POST", `/api/serials/${k12Serials[1].id}/status`, { status: "repair", note: "blown driver" });
s = await scanA(k12Serials[1].barcode, "out");
assert.match(s.json.message, /flagged repair/);
const afterRepair = await tech.ok("GET", `/api/availability?start=2030-06-01T00:00:00Z&end=2030-06-02T00:00:00Z`);
assert.equal(afterRepair[k12.id].stock, 1, "a unit in repair isn't stock");
await tech.fails("PATCH", `/api/collections/serials/records/${k12Serials[1].id}`, { status: "active" }, 404);
await tech.ok("POST", `/api/items/${stand.id}/out-of-service`, { quantity: 1 });
await tech.fails("POST", `/api/items/${stand.id}/out-of-service`, { quantity: 9 }, 400, /more than the stock/);
await bossB.fails("POST", `/api/serials/${k12Serials[0].id}/status`, { status: "lost" }, 403);
log("techs can flag units for repair (and that removes them from stock) but not edit them");

// --- delete protection ---
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
  { name: `Desk ${run}`, code: `DESK-${run}`, category: `Audio ${run} / Desks`, quantity: "", dayRate: "$1,200.50", serials: `D-${run}-1; D-${run}-2` },
  { name: `Gaffa ${run}`, quantity: "48", dayRate: "0" },
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
await planner.fails("POST", "/api/import/rentman", null, 403);
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
await fails(platform, "DELETE", `/api/admin/orgs/${orgC}`, { confirm: "wrong" }, 400, /exactly/);
await ok(platform, "DELETE", `/api/admin/orgs/${orgC}`, { confirm: `Smoke C ${run}` });
await fails(su, "GET", `/api/collections/items/records/${itemC.id}`, null, 404);
await fails(su, "GET", `/api/collections/jobs/records/${jobC.id}`, null, 404);
assert.equal((await ok(adminUser.token, "GET", "/api/me")).memberships.some((m) => m.org.id === orgC), false);
log("platform admin: organisation and account overview, suspension, deletion, and guard rails");

console.log(`\nAll ${step} checks passed.`);
