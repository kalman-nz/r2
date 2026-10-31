/// <reference path="../pb_data/types.d.ts" />

// Two collection rules tightened after an audit of every collection's
// list, view, create, update and delete rules:
//
// - users: the accounts that aren't in any organisation yet (new sign-ups,
//   platform admins) could be listed by anyone, signed in or not. In a
//   PocketBase rule a missing value equals an empty one, so "an
//   organisation of yours ?= one of theirs" held when neither side had any.
//   Now it takes a signed-in account and an organisation the two share.
// - logs: platform admins could read every organisation's activity log
//   through the API. They see the platform-wide entries (sign-ins), as 0022
//   meant; an organisation's own log is for its members with logs.view
//   (the app reads it through /api/activity either way).
//
// Also an index for finding units by serial number: each one is on only
// one unit in an organisation now (lib/validation.js validateSerial).

const can = (perm) =>
  `(@collection.memberships.user ?= @request.auth.id && @collection.memberships.org ?= org && @collection.memberships.role.permissions ?~ '"${perm}"' && org.suspended = false)`;

const USERS_BEFORE =
  "id = @request.auth.id || @request.auth.isPlatformAdmin = true || @request.auth.memberships_via_user.org ?= memberships_via_user.org";
const USERS_AFTER =
  "@request.auth.id != '' && (id = @request.auth.id || @request.auth.isPlatformAdmin = true || (memberships_via_user.org ?= @request.auth.memberships_via_user.org && memberships_via_user.org ?!= ''))";
const LOGS_BEFORE = "(org != '' && " + can("logs.view") + ") || @request.auth.isPlatformAdmin = true";
const LOGS_AFTER = "(org != '' && " + can("logs.view") + ") || (org = '' && @request.auth.isPlatformAdmin = true)";

const SERIAL_NUMBER_INDEX = "CREATE INDEX idx_serials_serial_number ON serials (org, serialNumber COLLATE NOCASE) WHERE serialNumber != ''";

function setRules(app, users, logs) {
  const u = app.findCollectionByNameOrId("users");
  u.listRule = users;
  u.viewRule = users;
  app.save(u);
  const l = app.findCollectionByNameOrId("logs");
  l.listRule = logs;
  l.viewRule = logs;
  app.save(l);
}

migrate(
  (app) => {
    setRules(app, USERS_AFTER, LOGS_AFTER);
    const serials = app.findCollectionByNameOrId("serials");
    const indexes = [];
    for (const index of serials.indexes) indexes.push(index);
    indexes.push(SERIAL_NUMBER_INDEX);
    serials.indexes = indexes;
    app.save(serials);
  },
  (app) => {
    setRules(app, USERS_BEFORE, LOGS_BEFORE);
    const serials = app.findCollectionByNameOrId("serials");
    const indexes = [];
    for (const index of serials.indexes) if (index.indexOf("idx_serials_serial_number") === -1) indexes.push(index);
    serials.indexes = indexes;
    app.save(serials);
  },
);
