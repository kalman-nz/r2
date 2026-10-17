import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ClientResponseError } from "pocketbase";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import AuthLayout from "../components/AuthLayout";
import Field from "../components/Field";

// Anyone can make an account; it's empty until an organisation's admin
// invites its email address (the invitation is waiting on the
// Organisations page). Invitation emails link here with ?email= filled in.
export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (pb.authStore.isValid) return <Navigate to="/orgs" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const address = email.trim();
    try {
      await pb.collection("users").create({ name: name.trim(), email: address, password, passwordConfirm: password });
    } catch (err) {
      const taken = err instanceof ClientResponseError && err.response?.data?.email?.code === "validation_not_unique";
      setError(taken ? "There's already an account for that email — sign in instead." : errorText(err));
      setSubmitting(false);
      return;
    }
    try {
      await pb.collection("users").authWithPassword(address, password);
      // Joining an organisation needs a verified address; send the link now.
      pb.collection("users")
        .requestVerification(address)
        .catch(() => {});
      navigate("/orgs", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your R2 account"
      subtitle="Use the email address your invitation was sent to."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" state={location.state} className="text-signal-ink hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Your name">
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="input py-2" />
        </Field>
        <Field label="Email">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className="input py-2" />
        </Field>
        <Field label="Password" hint="At least 8 characters">
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
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary py-2">
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
