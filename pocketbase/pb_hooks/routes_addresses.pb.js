/// <reference path="../pb_data/types.d.ts" />
// Address lookup as you type (lib/addresses.js): ?q=12 Example St, or
// ?warm=1 when the address box is focused, to open the connection early.
// Anyone in the organisation can look addresses up.
routerAdd(
  "GET",
  "/api/addresses",
  (e) => {
    const { requireOrg } = require(`${__hooks}/lib/orgs.js`);
    const { searchAddresses, warmAddressLookup } = require(`${__hooks}/lib/addresses.js`);
    const ctx = requireOrg(e);
    const query = e.requestInfo().query;
    if (query.warm) {
      warmAddressLookup();
      return e.json(200, []);
    }
    return e.json(200, searchAddresses(ctx.orgId, query.q));
  },
  $apis.requireAuth("users"),
);
