import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type PresetKey } from "../lib/api";
import { errorText } from "../lib/errors";
import AuthLayout from "../components/AuthLayout";
import Field from "../components/Field";
import PresetPicker from "../components/PresetPicker";

function returnPath(state: unknown): string {
  return (state as { from?: Location } | null)?.from?.pathname ?? "/";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { data: setup } = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus, enabled: !pb.authStore.isValid });

  if (pb.authStore.isValid) return <Navigate to={returnPath(location.state)} replace />;
  if (setup?.needed) return <FirstRun />;
  if (forgot) return <ForgotPassword initialEmail={email} onBack={() => setForgot(false)} />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("users").authWithPassword(email.trim(), password);
      navigate(returnPath(location.state), { replace: true });
    } catch {
      setError("Couldn't sign in — check your email and password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in to R2"
      footer={
        <>
          New to R2?{" "}
          <Link to="/signup" state={location.state} className="text-signal-ink hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="input py-2" />
        </Field>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="text-sm text-gray-500">
              Password
            </label>
            <button type="button" onClick={() => setForgot(true)} className="text-xs text-gray-500 hover:text-gray-900">
              Forgot password?
            </button>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input py-2"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary py-2">
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}

function ForgotPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("users").requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  const back = (
    <button type="button" onClick={onBack} className="text-signal-ink hover:underline">
      Back to sign in
    </button>
  );
  if (sent) {
    return (
      <AuthLayout title="Check your email" footer={back}>
        <p className="text-sm text-gray-600 text-center">
          If there's an R2 account for <strong>{email.trim()}</strong>, we've emailed it a link to choose a new password.
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={back}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="input py-2" />
        </Field>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" disabled={submitting} className="btn-primary py-2">
          {submitting ? "Sending…" : "Email me a link"}
        </button>
      </form>
    </AuthLayout>
  );
}

// A brand-new install: the first account runs the platform (it can create
// more organisations from the admin panel) and the first business on it.
function FirstRun() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [preset, setPreset] = useState<PresetKey>("hire");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.setup({ name: name.trim(), email: email.trim(), password, businessName: businessName.trim(), preset });
      await pb.collection("users").authWithPassword(email.trim(), password);
      navigate("/settings/general", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Set up R2"
      subtitle="Create the first account. It can manage every organisation on this R2, starting with your business."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Business name">
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className="input py-2" placeholder="e.g. Harbour AV Hire" />
        </Field>
        <PresetPicker value={preset} onChange={setPreset} />
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
          {submitting ? "Setting up…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
