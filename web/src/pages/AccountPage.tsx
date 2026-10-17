import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { pb, useAuthRecord } from "../lib/pocketbase";
import { useOrg } from "../lib/org";
import { errorText } from "../lib/errors";
import { useToast } from "../components/ToastProvider";
import Field from "../components/Field";
import VerifyEmailBanner from "../components/VerifyEmailBanner";

// Your own account: name and password. (Roles belong to organisations —
// each one's admins set yours there.)
export default function AccountPage() {
  const record = useAuthRecord();
  const { me, refresh } = useOrg();
  const { showToast } = useToast();
  const [name, setName] = useState(record?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => setName(record?.name ?? ""), [record?.name]);

  if (!record) return null;
  const email: string = record.email;
  const verified = me?.user.verified ?? record.verified;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      await pb.collection("users").update(record!.id, { name: name.trim() });
      await refresh();
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await pb.collection("users").update(record!.id, { oldPassword, password, passwordConfirm: password });
      // A new password signs every session out, this one included.
      await pb.collection("users").authWithPassword(email, password);
      setOldPassword("");
      setPassword("");
      showToast("success", "Password changed. Other devices will need to sign in again.");
    } catch (err) {
      showToast("error", `Couldn't change it: ${errorText(err)}`);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto w-full flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-gray-900">Your account</h1>

      {!verified && me?.verificationRequired && <VerifyEmailBanner email={email} />}

      <form onSubmit={saveName} className="card p-4 flex flex-col gap-3">
        <Field label="Email">
          <div className="flex items-center gap-2 text-sm text-gray-900 py-1.5">
            {email}
            <span className={`text-xs font-medium ${verified ? "text-green-700" : "text-amber-700"}`}>{verified ? "Verified" : "Not verified"}</span>
          </div>
        </Field>
        <Field label="Name" hint="What your team sees on projects, scans and the activity log.">
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="input py-2" />
        </Field>
        <div>
          <button type="submit" disabled={savingName || !name.trim() || name.trim() === record.name} className="btn-primary">
            {savingName ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className="card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Change password</h2>
        <Field label="Current password">
          <input
            required
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
            className="input py-2"
          />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="input py-2"
          />
        </Field>
        <div>
          <button type="submit" disabled={savingPassword} className="btn-primary">
            {savingPassword ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>

      <p className="text-sm text-gray-500">
        Your organisations and invitations are on the{" "}
        <Link to="/orgs" className="text-[#167cfb] hover:underline">
          Organisations
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
