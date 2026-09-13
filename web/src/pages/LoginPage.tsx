import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { pb } from "../lib/pocketbase";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (pb.authStore.isValid) {
    const from = (location.state as { from?: Location })?.from?.pathname ?? "/equipment";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("users").authWithPassword(email, password);
      const from = (location.state as { from?: Location })?.from?.pathname ?? "/equipment";
      navigate(from, { replace: true });
    } catch {
      setError("Couldn't sign in — check your email and password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4 card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 mb-1">
          <img src="/favicon.svg" alt="" className="w-9 h-9 rounded-md" />
          <h1 className="text-xl font-semibold text-gray-900">Rentman+</h1>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-gray-500">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-gray-500">
            Password
          </label>
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
        <p className="text-xs text-gray-500 text-center">
          Don't have an account? Ask whoever manages your workshop's Rentman+ setup to create one for you.
        </p>
      </form>
    </div>
  );
}
