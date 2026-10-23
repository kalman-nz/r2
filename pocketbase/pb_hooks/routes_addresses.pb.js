/// <reference path="../pb_data/types.d.ts" />
// Address lookup as you type (lib/addresses.js): ?q=12 Example St.
// Anyone in the organisation can look addresses up.
routerAdd(
  "GET",
  "/api/addresses",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { searchAddresses } = require(`${__hooks}/lib/addresses.js`);
    const ctx = requireOrg(e);
    return e.json(200, searchAddresses(ctx.orgId, e.requestInfo().query.q));
  },
  $apis.requireAuth("users"),
);
