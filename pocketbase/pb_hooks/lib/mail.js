// Email through PocketBase's own mailer (Dashboard → Settings → Mail).
// Without SMTP set up nothing is sent and callers say so, so the person can
// pass the link on themselves.

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The public address of this install (Dashboard → Settings → Application URL).
function appUrl() {
  return String($app.settings().meta.appURL || "").replace(/\/$/, "");
}

// Returns true if the email went out, false if mail isn't set up.
function sendMail(to, subject, html) {
  const settings = $app.settings();
  if (!settings.smtp.enabled) return false;
  $app.newMailClient().send(
    new MailerMessage({
      from: { address: settings.meta.senderAddress, name: settings.meta.senderName },
      to: [{ address: to }],
      subject: subject,
      html: html,
    }),
  );
  return true;
}

function sendInvitation(email, orgName, inviterName, roleName) {
  const link = (href) => '<a href="' + escapeHtml(href) + '">' + escapeHtml(href) + "</a>";
  return sendMail(
    email,
    "You're invited to " + orgName + " on R2",
    "<p>" +
      escapeHtml(inviterName || "Someone") +
      " has invited you to join <strong>" +
      escapeHtml(orgName) +
      "</strong> on R2, with the " +
      escapeHtml(roleName) +
      " role.</p><p>New to R2? Create your account with this email address:<br>" +
      link(appUrl() + "/signup?email=" + encodeURIComponent(email)) +
      "</p><p>Already have one? Sign in to accept:<br>" +
      link(appUrl() + "/orgs") +
      "</p>",
  );
}

module.exports = { appUrl, sendMail, sendInvitation };
