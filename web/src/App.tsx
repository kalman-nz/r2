import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import EquipmentList from "./pages/EquipmentList";
import EquipmentDetail from "./pages/EquipmentDetail";
import InventoryAuditPage from "./pages/InventoryAuditPage";
import AssetDetail from "./pages/AssetDetail";
import ProjectsList from "./pages/ProjectsList";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectFinancialsPage from "./pages/ProjectFinancialsPage";
import SettingsPage from "./pages/SettingsPage";
import CustomLabelPage from "./pages/CustomLabelPage";
import LogsPage from "./pages/LogsPage";
import LabelEditor from "./pages/LabelEditor";
import UserDetail from "./pages/UserDetail";
import LoginPage from "./pages/LoginPage";
import RequireAuth from "./components/RequireAuth";
import RequireAdmin from "./components/RequireAdmin";
import ScanInput from "./components/ScanInput";
import { pb, useAuthRecord } from "./lib/pocketbase";
import { api } from "./lib/api";

function navClass({ isActive }: { isActive: boolean }) {
  return `px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white hover:bg-neutral-900"
  }`;
}

function usePageViewLogging() {
  const location = useLocation();
  useEffect(() => {
    api.logEvent("page_view", { path: location.pathname }).catch(() => {});
  }, [location.pathname]);
}

// Header always shows "Rentman+"; the business name (if set at Settings >
// General) appears alongside it. The browser tab prefixes "Rentman+" too,
// but with the short name instead — the full name rarely fits.
function useBusinessName() {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const shortOrFull = settings?.businessShortName || settings?.businessName;
  const tabTitle = shortOrFull ? `Rentman+ | ${shortOrFull}` : "Rentman+";
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);
  return settings?.businessName || null;
}

function AppShell() {
  const record = useAuthRecord();
  const businessName = useBusinessName();
  usePageViewLogging();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-800 px-4 py-3 flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="w-7 h-7 rounded-md shrink-0" />
          <span className="font-semibold tracking-tight">{businessName || "Rentman+"}</span>
        </div>
        <nav className="flex gap-1 flex-1">
          <NavLink to="/equipment" className={navClass}>
            Assets
          </NavLink>
          <NavLink to="/custom-label" className={navClass}>
            Custom label
          </NavLink>
          {record?.isAdmin === true && (
            <NavLink to="/audit" className={navClass}>
              Audit
            </NavLink>
          )}
          {record?.isAdmin === true && (
            <NavLink to="/project-financials" className={navClass}>
              Financials
            </NavLink>
          )}
          {record?.isAdmin === true && (
            <NavLink to="/logs" className={navClass}>
              Logs
            </NavLink>
          )}
          {record?.isAdmin === true && (
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          )}
        </nav>
        <ScanInput />
        <span className="text-sm text-neutral-500">{record?.name || record?.email}</span>
        <button
          onClick={() => pb.authStore.clear()}
          className="text-sm px-3 py-1.5 rounded-md border border-neutral-800 hover:bg-neutral-900"
        >
          Log out
        </button>
      </header>
      <main className="flex-1 p-4">
        <Routes>
          <Route path="/" element={<Navigate to="/equipment" replace />} />
          <Route path="/equipment" element={<EquipmentList />} />
          <Route path="/equipment/:id" element={<EquipmentDetail />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/custom-label" element={<CustomLabelPage />} />
          <Route
            path="/audit"
            element={
              <RequireAdmin>
                <InventoryAuditPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/project-financials"
            element={
              <RequireAdmin>
                <ProjectFinancialsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/logs"
            element={
              <RequireAdmin>
                <LogsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/labels/:id"
            element={
              <RequireAdmin>
                <LabelEditor />
              </RequireAdmin>
            }
          />
          <Route
            path="/settings/*"
            element={
              <RequireAdmin>
                <SettingsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/users/:id"
            element={
              <RequireAdmin>
                <UserDetail />
              </RequireAdmin>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
