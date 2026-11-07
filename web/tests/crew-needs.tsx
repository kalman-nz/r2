import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { NeedForm, PeriodNeeds } from "../src/components/crew/Needs";
import CrewRows, { type CrewDraft } from "../src/components/crew/CrewRows";
import { ConfirmProvider } from "../src/components/ConfirmProvider";
import Modal from "../src/components/Modal";
import { ToastProvider } from "../src/components/ToastProvider";
import { useJobCrewNeeds } from "../src/lib/crew";
import type { CrewRole, JobPeriod } from "../src/lib/api";

const period: JobPeriod = {
  id: "period-1", subproject: "", kind: "other", name: "Show day",
  start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "", space: "",
};
const roles: CrewRole[] = [
  {
    id: "role-1", collectionId: "roles", collectionName: "crew_roles", org: "org-1",
    name: "Audio operator", levels: ["Basic", "Advanced"], sortOrder: 0,
  },
  {
    id: "role-2", collectionId: "roles", collectionName: "crew_roles", org: "org-1",
    name: "Lighting operator", levels: ["Junior", "Senior"], sortOrder: 1,
  },
  {
    id: "role-3", collectionId: "roles", collectionName: "crew_roles", org: "org-1",
    name: "Stagehand", levels: [], sortOrder: 2,
  },
];
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function Fixture() {
  const { data: needs = [] } = useJobCrewNeeds("job-1");
  return (
    <Modal title="Show day" onClose={() => {}}>
      {new URLSearchParams(location.search).has("edit") && needs.length > 0
        ? <NeedForm jobId="job-1" period={period} need={needs[0]} needs={needs} roles={roles} onDone={() => {}} />
        : <PeriodNeeds jobId="job-1" period={period} needs={needs} crew={[]} roles={roles} canEdit rosterHref="/" />}
    </Modal>
  );
}

export function InlineFixture() {
  const [crew, setCrew] = useState<CrewDraft[]>([]);
  return (
    <>
      <CrewRows roles={roles} crew={crew} onChange={setCrew} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          {new URLSearchParams(location.search).has("inline") ? <InlineFixture /> : <Fixture />}
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
