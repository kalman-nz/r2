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
  // Only clear the store when the server actually rejects the session
  // (401/403, or 404 for a deleted user). A cancelled request, no network
  // (status 0 — the app opening offline from its service worker, or on bad
  // warehouse Wi-Fi) or a server hiccup must not sign anyone out.
  useEffect(() => {
    if (!pb.authStore.isValid) return;
    pb.collection("users")
      .authRefresh()
      .catch((err) => {
        if (err instanceof ClientResponseError && [401, 403, 404].includes(err.status)) pb.authStore.clear();
      });
  }, []);

  if (!isValid) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
