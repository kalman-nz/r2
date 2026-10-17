import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import AuthLayout from "../components/AuthLayout";
import Field from "../components/Field";

// Where the links in R2's account emails land (the templates are set in
// pb_migrations/0023_auth_emails.js). Neither needs you to be signed in.

export function VerifyEmailPage() {
  const { token = "" } = useParams();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");
  // Once only: the token can't be spent twice (React runs effects twice in
  // development).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    pb.collection("users")
      .confirmVerification(token)
      .then(async () => {
        if (pb.authStore.isValid) {
          await pb.collection("users").authRefresh().catch(() => {});
          await queryClient.invalidateQueries({ queryKey: ["me"] });
        }
        setState("done");
      })
      .catch((err) => {
        setError(errorText(err));
        setState("failed");
      });
  }, [token, queryClient]);

  const next = pb.authStore.isValid ? (
    <Link to="/orgs" className="btn-primary py-2 text-center">
      Continue
    </Link>
  ) : (
    <Link to="/login" className="btn-primary py-2 text-center">
      Sign in
    </Link>
  );

  if (state === "working") return <AuthLayout title="Verifying your email…">{null}</AuthLayout>;
  if (state === "failed") {
    return (
      <AuthLayout title="That link didn't work" subtitle="It may have expired or already been used. Sign in to send a new one.">
        <p className="text-red-600 text-sm text-center">{error}</p>
        {next}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Email verified" subtitle="You can accept invitations to organisations now.">
      {next}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("users").confirmPasswordReset(token, password, password);
      // Changing the password signs every device out.
      pb.authStore.clear();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <Link to="/login" className="text-[#167cfb] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="New password" hint="At least 8 characters. You'll sign in with it next.">
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
          {submitting ? "Saving…" : "Set password"}
        </button>
      </form>
    </AuthLayout>
  );
}
