import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PeriodNeeds } from "../src/components/crew/Needs";
import { ConfirmProvider } from "../src/components/ConfirmProvider";
import Modal from "../src/components/Modal";
import { ToastProvider } from "../src/components/ToastProvider";
import { useJobCrewNeeds } from "../src/lib/crew";
import type { CrewRole, JobPeriod } from "../src/lib/api";

const period: JobPeriod = {
  id: "period-1", subproject: "", kind: "other", name: "Show day",
  start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "", space: "",
};
const roles: CrewRole[] = [{
  id: "role-1", collectionId: "roles", collectionName: "crew_roles", org: "org-1",
  name: "Audio operator", levels: [], sortOrder: 0,
}];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function Fixture() {
  const { data: needs = [] } = useJobCrewNeeds("job-1");
  return (
    <Modal title="Show day" onClose={() => {}}>
      <PeriodNeeds jobId="job-1" period={period} needs={needs} crew={[]} roles={roles} canEdit rosterHref="/" />
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <Fixture />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
