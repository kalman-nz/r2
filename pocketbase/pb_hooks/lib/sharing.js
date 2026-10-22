// Sharing for everyone's own dashboards and saved views (dashboards,
// list_views, equipment_views; pb_migrations/0036): each is its owner's, and
// they can share it with people they pick (sharedWith) or with everyone in
// the organisation (public). Making something public, or taking it back,
// needs views.publish (an admin's by default). Ones with no owner are the
// organisation's own: whoever can publish looks after them.

// What someone can see, for findRecordsByFilter with { org, me }.
const VISIBLE = "org = {:org} && (owner = {:me} || public = true || sharedWith.id ?= {:me})";

function canEdit(ctx, me, record) {
  const owner = record.getString("owner");
  return owner ? owner === me : ctx.can("views.publish");
}

function requireEdit(ctx, me, record) {
  if (!canEdit(ctx, me, record)) {
    throw new ForbiddenError(record.getString("owner") ? "Only its owner can change it" : "Only people who can share with everyone can change the organisation's own");
  }
}

// body: { sharedWith?: [userIds], public?: bool }. People must be in the
// organisation; the owner doesn't need to be listed.
function applySharing(app, ctx, record, body) {
  const { membershipOf } = require("./orgs.js");
  if (body.sharedWith !== undefined) {
    if (!Array.isArray(body.sharedWith)) throw new BadRequestError("sharedWith must be a list of people");
    const ids = [];
    for (const raw of body.sharedWith) {
      const id = String(raw);
      if (id === record.getString("owner") || ids.indexOf(id) !== -1) continue;
      if (!membershipOf(app, id, ctx.orgId)) throw new BadRequestError("You can only share with people in this organisation");
      ids.push(id);
    }
    record.set("sharedWith", ids);
  }
  if (body.public !== undefined && !!body.public !== record.getBool("public")) {
    if (!ctx.can("views.publish")) throw new ForbiddenError("Only people who can share with everyone (admins, to start with) can change that");
    record.set("public", !!body.public);
  }
}

// What the web app needs to show and offer: whose it is, who it's shared
// with, and what this person can do with it. names: { userId: name }.
function sharingJson(ctx, me, record, names) {
  const owner = record.getString("owner");
  return {
    ownerId: owner,
    ownerName: owner ? names[owner] || "" : "",
    isOwner: owner === me,
    canEdit: canEdit(ctx, me, record),
    public: record.getBool("public"),
    sharedWith: record.getStringSlice("sharedWith").map((id) => ({ id: id, name: names[id] || "" })),
  };
}

// { userId: name } for everyone these records mention.
function namesFor(app, records) {
  const ids = {};
  for (const r of records) {
    if (r.getString("owner")) ids[r.getString("owner")] = true;
    for (const id of r.getStringSlice("sharedWith")) ids[id] = true;
  }
  const names = {};
  for (const u of app.findRecordsByIds("users", Object.keys(ids))) if (u) names[u.id] = u.getString("name") || u.getString("email");
  return names;
}

module.exports = { VISIBLE, canEdit, requireEdit, applySharing, sharingJson, namesFor };
