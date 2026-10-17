/// <reference path="../pb_data/types.d.ts" />

// scripts/dev-pocketbase.sh trusts unverified email addresses so
// invitations can be accepted without a mail server (lib/members.js). Shout
// about it so it's never left on in production.
if ($os.getenv("R2_DEV_TRUST_EMAILS") === "1") {
  console.warn("R2_DEV_TRUST_EMAILS=1: invitations can be accepted without a verified email. Development only.");
}

// The address people reach R2 at, used for the links in emails
// (verification, password reset, invitations). Set R2_APP_URL wherever R2
// is deployed; it overrides Dashboard → Settings → Application URL on every
// start, so it can't drift from the deployment.
onBootstrap((e) => {
  e.next();
  const url = ($os.getenv("R2_APP_URL") || "").replace(/\/$/, "");
  if (!url) return;
  const settings = e.app.settings();
  if (settings.meta.appURL === url) return;
  settings.meta.appURL = url;
  e.app.save(settings);
});

// Logs a "login" event into the generic logs collection on every genuinely
// successful password sign-in to the "users" collection. Login (unlike
// page views/prints) happens entirely browser<->PocketBase, bypassing our
// own Fastify server — a hook here is the only reliable place to catch it
// (a client-fired call after login could be skipped or spoofed).
//
// e.next() runs the real auth flow (password check, token issuance). If
// the password is wrong, e.next() throws and the code below never runs —
// only successful logins get logged.
onRecordAuthWithPasswordRequest((e) => {
  e.next();
  if (e.collection.name !== "users" || !e.record) return;
  const logs = e.app.findCollectionByNameOrId("logs");
  // Platform-wide (no organisation): signing in isn't tied to one.
  const record = new Record(logs, {
    org: "",
    type: "login",
    who: e.record.get("name") || e.record.get("email"),
    details: {},
    createdAt: new Date().toISOString(),
  });
  e.app.save(record);
}, "users");
