import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ClientResponseError } from "pocketbase";
import { pb } from "../lib/pocketbase";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isValid, setIsValid] = useState(pb.authStore.isValid);

  useEffect(() => {
    return pb.authStore.onChange(() => setIsValid(pb.authStore.isValid));
  }, []);

  // The cached auth record (name/isAdmin/etc) is only as fresh as the last
  // login — PocketBase doesn't push updates when the underlying user row
  // changes server-side (e.g. someone gets promoted to admin). Refresh it
  // once per app load so permission changes show up without forcing a
  // manual log out/in; if the session's gone stale entirely (deleted user,
  // expired token), this clears it and RequireAuth naturally redirects.
  //
  // React's dev-mode StrictMode double-invokes this effect, and the SDK
  // auto-cancels the first of two identical in-flight requests — that
  // cancellation surfaces here as a rejected promise with isAbort: true,
  // not a real auth failure (confirmed empirically: it was wiping a valid
  // session and bouncing every dev-mode page load back to /login). Only
  // clear the store for a genuine rejection from the server.
  useEffect(() => {
    if (!pb.authStore.isValid) return;
    pb.collection("users")
      .authRefresh()
      .catch((err) => {
        if (err instanceof ClientResponseError && err.isAbort) return;
        pb.authStore.clear();
      });
  }, []);

  if (!isValid) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
