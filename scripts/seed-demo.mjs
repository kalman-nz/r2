// Fills an EMPTY R2 database with a fictional AV hire company — inventory,
// units, kits, accessories, contacts, venues and a few overlapping jobs —
// for local development and showing R2 to people. Every name is made up.
//
//   PB_URL=http://127.0.0.1:3001 \
//   PB_SUPERUSER_EMAIL=… PB_SUPERUSER_PASSWORD=… node scripts/seed-demo.mjs
//
// Against the local dev server (`pnpm dev:pb`) no variables are needed: the
// superuser it made is read from .pb/superuser.txt.
//
// It creates two logins sharing one random password, printed at the end:
// demo-admin@example.com (a platform admin, and admin of the demo company)
// and demo-tech@example.com (a tech there). A second, empty organisation has
// invited demo-admin, so there's an invitation to accept. Don't run it
// against a database with real data in it.
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.PB_URL || "http://127.0.0.1:3001";
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
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const su = (
  await call(null, "POST", "/api/collections/_superusers/auth-with-password", {
    identity: process.env.PB_SUPERUSER_EMAIL,
    password: process.env.PB_SUPERUSER_PASSWORD,
  })
).token;

const existing = await call(su, "GET", "/api/collections/items/records?perPage=1");
if (existing.totalItems > 0) {
  console.error("This database already has inventory in it — the demo seed only runs on an empty one.");
  process.exit(1);
}

const password = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
async function account(who, name, isPlatformAdmin) {
  await call(su, "POST", "/api/collections/users/records", {
    email: `${who}@example.com`,
    name,
    isPlatformAdmin,
    verified: true,
    password,
    passwordConfirm: password,
    emailVisibility: true,
  });
  return (await call(null, "POST", "/api/collections/users/auth-with-password", { identity: `${who}@example.com`, password })).token;
}
const admin = await account("demo-admin", "Demo Admin", true);
const tech = await account("demo-tech", "Demo Tech", false);

// The demo company, joined the way everyone joins: by invitation.
const created = await call(admin, "POST", "/api/admin/orgs", { name: "Demo AV Hire Ltd", adminEmail: "demo-admin@example.com" });
const org = created.id;
await call(admin, "POST", `/api/invitations/${created.invitation.id}/accept`);
const roles = await call(admin, "GET", `/api/orgs/${org}/roles`);
const techInvite = await call(admin, "POST", `/api/orgs/${org}/invitations`, {
  email: "demo-tech@example.com",
  roleId: roles.find((r) => r.name === "Tech").id,
});
await call(tech, "POST", `/api/invitations/${techInvite.invitation.id}/accept`);
await call(admin, "POST", "/api/admin/orgs", { name: "Harbourside Staging Co", adminEmail: "demo-admin@example.com" });

const api = (method, path, body) => call(admin, method, path, body, org);
const create = (collection, data) => api("POST", `/api/collections/${collection}/records`, { org, ...data });

await api("PUT", "/api/app-settings", {
  businessName: "Demo AV Hire Ltd",
  businessShortName: "Demo AV",
  businessAddress: "1 Example Street\nTauranga 3110",
  businessPhone: "07 000 0000",
  businessEmail: "hire@example.com",
  gstNumber: "000-000-000",
  quoteTerms: "Demo terms: 50% deposit to confirm. Balance due on return. Damaged or missing equipment is charged at replacement value.",
});

const warehouse = await create("locations", { name: "Main warehouse" });
const cat = {};
for (const [name, parent] of [
  ["Audio", ""],
  ["Speakers", "Audio"],
  ["Microphones", "Audio"],
  ["Mixers", "Audio"],
  ["Lighting", ""],
  ["Video", ""],
  ["Cables & power", ""],
  ["Stands & staging", ""],
]) {
  cat[name] = (await create("categories", { name, parent: parent ? cat[parent].id : "" })).id;
}

// [name, code, category, tracking, quantity, day rate, extra fields]
const catalogue = [
  ["Powered speaker 12in", "SPK12", "Speakers", "serial", 6, 80, { weightKg: 18, powerW: 1000, replacementValue: 2400 }],
  ["Subwoofer 18in", "SUB18", "Speakers", "serial", 2, 120, { weightKg: 45, powerW: 1600, replacementValue: 3600 }],
  ["Dynamic vocal mic", "MIC58", "Microphones", "serial", 10, 15, { replacementValue: 180 }],
  ["Wireless handheld mic", "WMIC", "Microphones", "serial", 4, 60, { replacementValue: 1500 }],
  ["Digital mixer 16ch", "MIX16", "Mixers", "serial", 1, 180, { weightKg: 9, powerW: 150, replacementValue: 3200 }],
  ["Digital mixer 48ch", "MIX48", "Mixers", "serial", 1, 250, { weightKg: 22, powerW: 250, replacementValue: 9000 }],
  ["DI box", "DI", "Audio", "bulk", 12, 8, {}],
  ["LED wash fixture", "WASH", "Lighting", "serial", 8, 70, { weightKg: 7, powerW: 300, bufferHours: 4 }],
  ["Profile spot 750W", "SPOT", "Lighting", "serial", 12, 25, { weightKg: 8, powerW: 750 }],
  ["LED par", "PAR", "Lighting", "bulk", 24, 15, { powerW: 90 }],
  ["Projector 6000lm", "PROJ", "Video", "serial", 2, 150, { powerW: 450, replacementValue: 5500 }],
  ["Fast-fold screen 3m", "SCR3", "Video", "bulk", 2, 90, {}],
  ["XLR cable 10m", "XLR10", "Cables & power", "bulk", 60, 2, {}],
  ["XLR cable 5m", "XLR5", "Cables & power", "bulk", 40, 2, {}],
  ["IEC power cable 2m", "IEC2", "Cables & power", "bulk", 50, 1, {}],
  ["Speaker cable 10m", "SPKC10", "Cables & power", "bulk", 20, 4, {}],
  ["Extension lead 10m", "EXT10", "Cables & power", "bulk", 15, 5, {}],
  ["Speaker stand", "STAND", "Stands & staging", "bulk", 12, 10, {}],
  ["Boom mic stand", "BOOM", "Stands & staging", "bulk", 20, 5, {}],
];

const items = {};
for (const [name, code, category, tracking, quantity, dayRate, extra] of catalogue) {
  const item = await create("items", {
    name,
    code,
    category: cat[category],
    kind: "item",
    tracking,
    stockQty: tracking === "bulk" ? quantity : 0,
    dayRate,
    barcode: tracking === "bulk" ? `DEMO-${code}` : "",
    locationInWarehouse: category,
    ...extra,
  });
  items[code] = item;
  if (tracking === "serial") {
    for (let n = 1; n <= quantity; n++) {
      await create("serials", {
        item: item.id,
        barcode: `${code}-${String(n).padStart(3, "0")}`,
        serialNumber: `SN${code}${1000 + n}`,
        status: code === "WASH" && n === 8 ? "repair" : "active",
        location: warehouse.id,
        nextInspection: new Date(Date.now() + (n * 40 - 60) * 86400000).toISOString(),
      });
    }
  }
}

const smallPa = await create("items", {
  name: "Small PA package",
  code: "PA-S",
  category: cat.Audio,
  kind: "kit",
  dayRate: 300,
  description: "Two powered speakers on stands, 16-channel mixer, cabling",
});
for (const [index, [code, quantity]] of [
  ["SPK12", 2],
  ["STAND", 2],
  ["MIX16", 1],
  ["XLR10", 4],
].entries()) {
  await create("item_components", { parent: smallPa.id, child: items[code].id, kind: "component", quantity, sortOrder: (index + 1) * 10 });
}
await create("item_components", { parent: items.SPK12.id, child: items.IEC2.id, kind: "accessory", quantity: 1 });
await create("item_components", { parent: items.MIC58.id, child: items.XLR10.id, kind: "accessory", quantity: 1 });
await create("item_components", { parent: items.MIC58.id, child: items.BOOM.id, kind: "accessory", quantity: 1, chargeable: true });

const contacts = {};
for (const c of [
  { name: "Kōwhai Events Ltd", kind: "company", contactPerson: "Aroha Example", email: "aroha@example.com", phone: "021 000 001" },
  { name: "Southern Lights Productions", kind: "company", contactPerson: "Sam Example", email: "sam@example.com" },
  { name: "Riverbank School", kind: "company", contactPerson: "Office", email: "office@example.com" },
]) {
  contacts[c.name] = await create("contacts", { ...c, billingAddress: "PO Box 0000\nExampleville" });
}
const venues = {};
for (const v of [
  { name: "Example Town Hall", address: "2 Civic Square", notes: "Loading dock at rear. 32A three-phase on stage left." },
  { name: "Riverside Pavilion", address: "Riverside Park" },
  { name: "Kōwhai Gardens Marquee", address: "Kōwhai Gardens", notes: "Generator power only." },
]) {
  venues[v.name] = await create("venues", v);
}

// Jobs over the next fortnight, overlapping so the warning shows: the
// conference needs more powered speakers than are free while the gala's out.
const day = (offset, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const jobs = [
  {
    name: "Spring Gala Dinner",
    status: "confirmed",
    client: contacts["Kōwhai Events Ltd"].id,
    venue: venues["Example Town Hall"].id,
    prepAt: day(3, 9),
    billingStart: day(4, 17),
    billingEnd: day(4, 23),
    returnAt: day(5, 12),
    quoteNotes: "Includes delivery, setup and pack-down by our crew.",
    lines: [
      { itemId: smallPa.id, quantity: 1 },
      { itemId: items.SPK12.id, quantity: 2 },
      { itemId: items.MIC58.id, quantity: 4 },
      { itemId: items.WMIC.id, quantity: 2 },
      { itemId: items.WASH.id, quantity: 6 },
      { description: "Delivery & collection", quantity: 1, unitPrice: 150, group: "Services" },
      { description: "Sound technician (hours)", quantity: 8, unitPrice: 65, group: "Services" },
    ],
  },
  {
    name: "Product launch",
    status: "provisional",
    client: contacts["Southern Lights Productions"].id,
    venue: venues["Riverside Pavilion"].id,
    prepAt: day(4, 8),
    billingStart: day(5, 10),
    billingEnd: day(5, 16),
    returnAt: day(6, 12),
    lines: [
      { itemId: items.SPK12.id, quantity: 3 },
      { itemId: items.PROJ.id, quantity: 1 },
      { itemId: items.SCR3.id, quantity: 1 },
      { itemId: items.MIX48.id, quantity: 1 },
    ],
  },
  {
    name: "School prizegiving",
    status: "enquiry",
    client: contacts["Riverbank School"].id,
    prepAt: day(9, 8),
    returnAt: day(10, 16),
    lines: [{ itemId: smallPa.id, quantity: 1 }, { itemId: items.MIC58.id, quantity: 2 }],
  },
  {
    name: "Wedding dry hire",
    status: "out",
    client: contacts["Kōwhai Events Ltd"].id,
    venue: venues["Kōwhai Gardens Marquee"].id,
    prepAt: day(-1, 10),
    returnAt: day(1, 10),
    lines: [{ itemId: items.PAR.id, quantity: 12 }, { itemId: items.EXT10.id, quantity: 6 }],
  },
];
for (const { lines, ...job } of jobs) {
  const record = await create("jobs", job);
  for (const line of lines) await api("POST", `/api/jobs/${record.id}/lines`, line);
}

await api("POST", "/api/labels", {
  name: "Asset tag 62 × 29",
  widthMm: 62,
  heightMm: 29,
  elements: [
    { id: "qr", type: "qr", x: 2, y: 2, width: 25, height: 25, dataField: "qrcodes", lockAspect: true },
    { id: "name", type: "text", x: 29, y: 3, width: 31, height: 12, dataField: "equipmentName", fontSize: 4, bold: true, wrap: true },
    { id: "code", type: "text", x: 29, y: 17, width: 31, height: 9, dataField: "qrcodes", fontSize: 3.5 },
  ],
});

console.log(`Seeded demo data. Sign in as demo-admin@example.com or demo-tech@example.com, password ${password}`);
