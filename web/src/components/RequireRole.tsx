import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useRole } from "../lib/roles";

// Client-side gate is UX only — the server checks the same permissions
// (requireOrg in pocketbase/pb_hooks/lib/orgs.js, and the collection rules).
// permission: one permission, any of several, or "platform" for R2's own
// operators (the admin panel).
export default function RequireRole({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { can, isPlatformAdmin } = useRole();
  const wanted = Array.isArray(permission) ? permission : [permission];
  const allowed = wanted.some((p) => (p === "platform" ? isPlatformAdmin : can(p)));
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}
