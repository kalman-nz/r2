import { useAuthRecord } from "./pocketbase";
import { useOrg } from "./org";

// What your role in the current organisation allows (lib/org.tsx). Roles
// are each organisation's own, made of permissions (Settings → Roles); see
// pocketbase/pb_hooks/lib/permissions.js for the list. UX only — the server
// checks the same permissions in collection rules and routes.
export function useRole() {
  const record = useAuthRecord();
  const { role, can, isPlatformAdmin } = useOrg();
  return { record, role, can, isAdmin: !!role?.locked, isPlatformAdmin };
}

// Shorthand for the common case: const can = useCan(); can("jobs.edit")
export function useCan() {
  return useOrg().can;
}

// Whether you could give someone this role: the server refuses a role with
// permissions your own lacks, and only admins can make admins. null means
// no limit (platform admins in the admin panel).
export function mayGrant(role: { locked: boolean; permissions: string[] }, mine: { isAdmin: boolean; can: (p: string) => boolean } | null) {
  if (!mine || mine.isAdmin) return true;
  return !role.locked && role.permissions.every(mine.can);
}

// The least-privileged role, as a sensible default for invitations.
export function smallestRole<T extends { locked: boolean; permissions: string[] }>(roles: T[]): T | undefined {
  return [...roles].sort((a, b) => Number(a.locked) - Number(b.locked) || a.permissions.length - b.permissions.length)[0];
}
