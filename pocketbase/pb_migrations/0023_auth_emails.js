/// <reference path="../pb_data/types.d.ts" />

// People sign up on R2 itself now (see 0022_organisations.js), so the
// emails PocketBase sends them should link into R2's own pages
// (web/src/pages/AuthLinkPages.tsx), not PocketBase's dashboard. {APP_URL}
// is Settings → Application URL, which R2_APP_URL sets on every start (see
// main.pb.js).
const button = (href, text) =>
  `<p><a href="${href}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#167cfb;color:#fff;text-decoration:none;font-weight:600">${text}</a></p>`;

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.verificationTemplate.subject = "Verify your email for {APP_NAME}";
    users.verificationTemplate.body =
      "<p>Hello {RECORD:name},</p>" +
      "<p>Confirm this is your email address. You'll need to before you can join an organisation on {APP_NAME}.</p>" +
      button("{APP_URL}/verify/{TOKEN}", "Verify email") +
      "<p>If you didn't sign up for {APP_NAME}, ignore this email.</p>";
    users.resetPasswordTemplate.subject = "Reset your {APP_NAME} password";
    users.resetPasswordTemplate.body =
      "<p>Hello {RECORD:name},</p>" +
      "<p>Someone asked to reset the password for this email address on {APP_NAME}.</p>" +
      button("{APP_URL}/reset-password/{TOKEN}", "Choose a new password") +
      "<p>If that wasn't you, ignore this email — your password hasn't changed.</p>";
    app.save(users);

    const settings = app.settings();
    if (settings.meta.appName === "Acme") {
      settings.meta.appName = "R2";
      app.save(settings);
    }
  },
  () => {
    // The templates are harmless to keep on rollback.
  },
);
