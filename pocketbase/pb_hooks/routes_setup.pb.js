/// <reference path="../pb_data/types.d.ts" />
// First-run setup: a brand-new install has no accounts, so the login page
// asks for the first one instead (pages/LoginPage.tsx). That person becomes
// a platform admin (able to create and manage every organisation) and the
// admin of a first organisation. The moment any account exists this closes
// for good, so open a new install straight after deploying it.

routerAdd("GET", "/api/setup", (e) => {
  return e.json(200, { needed: $app.countRecords("users") === 0 });
});

// body: { name, email, password, businessName? }
routerAdd("POST", "/api/setup", (e) => {
  const { validateNewAccount } = require(`${__hooks}/lib/users.js`);
  const { setSetting } = require(`${__hooks}/lib/settings.js`);
  const { createDefaultRoles } = require(`${__hooks}/lib/permissions.js`);
  const { logEvent } = require(`${__hooks}/lib/log.js`);
  const body = e.requestInfo().body || {};
  const data = validateNewAccount(body);
  const orgName = (typeof body.businessName === "string" && body.businessName.trim()) || "My organisation";

  let orgId = "";
  $app.runInTransaction((tx) => {
    if (tx.countRecords("users") > 0) throw new ForbiddenError("R2 is already set up — sign in instead");
    const user = new Record(tx.findCollectionByNameOrId("users"), {
      name: data.name,
      email: data.email,
      emailVisibility: true,
      isPlatformAdmin: true,
      // Nobody can verify an address before mail is set up, and this person
      // set the install up.
      verified: true,
    });
    user.set("password", data.password);
    user.set("passwordConfirm", data.password);
    tx.save(user);
    const org = new Record(tx.findCollectionByNameOrId("organisations"), { name: orgName, suspended: false, features: {}, createdBy: user.id });
    tx.save(org);
    const roles = createDefaultRoles(tx, org.id);
    tx.save(new Record(tx.findCollectionByNameOrId("memberships"), { org: org.id, user: user.id, role: roles.Admin.id }));
    orgId = org.id;
  });
  setSetting(orgId, "businessName", orgName);
  logEvent("", "setup", data.name, { email: data.email });
  return e.json(200, { ok: true });
});
