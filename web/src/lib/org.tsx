import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type FeatureKey, type Invitation, type Me, type Membership, type OrgRef, type RoleRef } from "./api";
import { currentOrgId, setCurrentOrgId } from "./currentOrg";
import { useAuthRecord } from "./pocketbase";

// Who the signed-in person is across organisations (GET /api/me), and which
// organisation the app is working in. Someone can belong to several, with a
// different role in each; the app shows one at a time and the header
// switches between them. UX only — the server checks membership and role
// on every request.

interface OrgState {
  me: Me | undefined;
  // false only while the very first /api/me is loading
  ready: boolean;
  memberships: Membership[];
  invitations: Invitation[];
  org: OrgRef | null;
  role: RoleRef | null;
  // what your role in it allows (lib/permissions.js on the server), less
  // what the organisation has turned off
  can: (permission: string) => boolean;
  // whether the organisation uses a feature (Settings → Features)
  feature: (key: FeatureKey) => boolean;
  isPlatformAdmin: boolean;
  switchOrg: (id: string) => void;
  refresh: () => Promise<unknown>;
}

const OrgContext = createContext<OrgState | null>(null);

// The last answer, so the app opens straight into the right organisation
// (and still knows it offline) while /api/me is re-checked.
const ME_KEY = "r2.me";

function storedMe(userId: string): Me | undefined {
  try {
    const me = JSON.parse(localStorage.getItem(ME_KEY) ?? "null") as Me | null;
    return me?.user?.id === userId ? me : undefined;
  } catch {
    return undefined;
  }
}

function storeMe(me: Me) {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    // fine — just not remembered
  }
}

export function forgetStoredMe() {
  try {
    localStorage.removeItem(ME_KEY);
  } catch {
    // nothing stored then
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const userId = useAuthRecord()?.id ?? "";
  const query = useQuery({
    queryKey: ["me", userId],
    queryFn: async () => {
      const me = await api.me();
      storeMe(me);
      return me;
    },
    enabled: !!userId,
    // Invitations and role changes arrive without this person doing
    // anything, so look again now and then (it's one small request).
    refetchInterval: 60_000,
    initialData: () => storedMe(userId),
    initialDataUpdatedAt: 0,
  });
  const me = query.data;
  const [selected, setSelected] = useState(currentOrgId);

  const usable = useMemo(() => (me?.memberships ?? []).filter((m) => !m.org.suspended), [me]);
  const active = usable.find((m) => m.org.id === selected) ?? usable[0] ?? null;
  const orgId = active?.org.id ?? "";
  // Settled here, before anything inside renders, so their requests and
  // cached queries are this organisation's. (Without an answer from
  // /api/me — offline — keep the last one.)
  if (me && orgId !== currentOrgId()) setCurrentOrgId(orgId);

  const permissions = active?.permissions;
  const can = useCallback((permission: string) => !!permissions && permissions.includes(permission), [permissions]);
  // On unless the organisation's turned it off (and on before /api/me says).
  const features = active?.org.features;
  const feature = useCallback((key: FeatureKey) => features?.[key] !== false, [features]);

  const switchOrg = useCallback((id: string) => {
    setCurrentOrgId(id);
    setSelected(id);
  }, []);
  const { refetch } = query;
  const refresh = useCallback(() => refetch(), [refetch]);

  const value = useMemo<OrgState>(
    () => ({
      me,
      ready: !userId || !!me || query.isError,
      memberships: me?.memberships ?? [],
      invitations: me?.invitations ?? [],
      org: active?.org ?? null,
      role: active?.role ?? null,
      can,
      feature,
      isPlatformAdmin: me?.user.isPlatformAdmin ?? false,
      switchOrg,
      refresh,
    }),
    [me, userId, query.isError, active, can, feature, switchOrg, refresh],
  );
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgState {
  const state = useContext(OrgContext);
  if (!state) throw new Error("useOrg needs an OrgProvider");
  return state;
}

// For a page showing one record (a job, an item…): if it belongs to another
// of your organisations — a link a colleague sent — switch to that one, so
// everything around it (dropdowns, availability, search) matches.
export function useFollowOrg(recordOrg: string | undefined) {
  const { org, memberships, switchOrg } = useOrg();
  useEffect(() => {
    if (!recordOrg || !org || recordOrg === org.id) return;
    if (memberships.some((m) => m.org.id === recordOrg && !m.org.suspended)) switchOrg(recordOrg);
  }, [recordOrg, org, memberships, switchOrg]);
}
