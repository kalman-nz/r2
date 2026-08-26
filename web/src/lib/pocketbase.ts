import { useEffect, useState } from "react";
import PocketBase, { type RecordModel } from "pocketbase";

// Same-origin — PocketBase now serves this SPA itself (as well as the
// /api/* routes below), so there's no separate host/port to configure.
export const pb = new PocketBase("");

// Reads pb.authStore.record reactively — a plain read only reflects
// whatever was cached at the last login/authRefresh, so anything (isAdmin,
// name) that can change server-side needs this instead of pb.authStore.record
// directly, or the UI won't update until a full reload.
export function useAuthRecord(): RecordModel | null {
  const [record, setRecord] = useState(pb.authStore.record);
  useEffect(() => pb.authStore.onChange(() => setRecord(pb.authStore.record)), []);
  return record;
}
