/// <reference path="../pb_data/types.d.ts" />
// "Find photo" on an item: searches online and lets the local vision model
// pick the best match (lib/photoSearch.js). Needs items.edit, the same as
// uploading a photo by hand. Slow (tens of seconds): it waits on the model.

routerAdd(
  "POST",
  "/api/items/{id}/find-photo",
  (e) => {
    const { findOrNull } = require(`${__hooks}/lib/records.js`);
    const { requireRecordOrg } = require(`${__hooks}/lib/orgs.js`);
    const { findItemPhoto } = require(`${__hooks}/lib/photoSearch.js`);
    const item = findOrNull($app, "items", e.request.pathValue("id"));
    if (!item) throw new NotFoundError("Item not found");
    const ctx = requireRecordOrg(e, item, "items.edit");
    require(`${__hooks}/lib/features.js`).requireFeature(ctx.org, "ai");
    const found = findItemPhoto($app, item);
    return e.json(200, { item: item, found: found });
  },
  $apis.requireAuth("users"),
);
