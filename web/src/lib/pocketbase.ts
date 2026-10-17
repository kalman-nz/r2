import { useEffect, useState } from "react";
import PocketBase, { type RecordModel } from "pocketbase";

// Same-origin — PocketBase now serves this SPA itself (as well as the
// /api/* routes below), so there's no separate host/port to configure.
//
// Must be "/", not "" — the SDK's buildURL only skips appending the
// *current page's path* (window.location.pathname) when baseURL starts
// with "/". With "", logging in from e.g. /login sent requests to
// /login/api/collections/users/auth-with-password instead of
// /api/collections/users/auth-with-password, breaking auth from any route
// other than the root.
export const pb = new PocketBase("/");

// The SDK cancels a pending request when an identical one starts. With
// react-query running several list queries for the same collection at once
// (a contacts dropdown and the contacts page), that silently cancels real
// requests, so turn it off and let react-query dedupe instead.
pb.autoCancellation(false);

// Reads pb.authStore.record reactively — a plain read only reflects
// whatever was cached at the last login/authRefresh, so anything (isAdmin,
// name) that can change server-side needs this instead of pb.authStore.record
// directly, or the UI won't update until a full reload.
export function useAuthRecord(): RecordModel | null {
  const [record, setRecord] = useState(pb.authStore.record);
  useEffect(() => pb.authStore.onChange(() => setRecord(pb.authStore.record)), []);
  return record;
}
