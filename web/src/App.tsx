import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
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

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0" {...props}>
      {children}
    </svg>
  );
}

const icons = {
  assets: (
    <Icon>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </Icon>
  ),
  label: (
    <Icon>
      <path d="M3 8a2 2 0 0 1 2-2h9l7 6-7 6H5a2 2 0 0 1-2-2V8z" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Icon>
  ),
  audit: (
    <Icon>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
      <rect x="5" y="6" width="14" height="15" rx="2" />
      <path d="M9 12.5l1.8 1.8L15 10" />
    </Icon>
  ),
  financials: (
    <Icon>
      <path d="M4 19V5" />
      <rect x="7" y="12" width="3.5" height="7" />
      <rect x="13" y="8" width="3.5" height="11" />
      <path d="M4 19h16" />
    </Icon>
  ),
  logs: (
    <Icon>
      <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M9 12h6M9 16h6M9 8h3" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  ),
  logout: (
    <Icon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  ),
};

function sidebarLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 mx-2 px-2.5 h-9 rounded-md text-sm font-medium border-l-2 ${
    isActive
      ? "bg-white/10 text-white border-[#167cfb]"
      : "text-zinc-400 border-transparent hover:bg-white/5 hover:text-white"
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
    <div className="min-h-screen flex">
      <aside className="w-52 shrink-0 flex flex-col h-screen sticky top-0 py-3" style={{ background: "#2b2d31" }}>
        <div className="flex items-center gap-2.5 px-4 h-9 mb-3 shrink-0">
          <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-white font-bold text-xs shrink-0">
            R+
          </div>
          <span className="text-white font-semibold text-sm tracking-tight truncate">Rentman+</span>
        </div>

        <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5">
          <NavLink to="/equipment" className={sidebarLinkClass}>
            {icons.assets}
            Assets
          </NavLink>
          <NavLink to="/custom-label" className={sidebarLinkClass}>
            {icons.label}
            Custom label
          </NavLink>
          {record?.isAdmin === true && (
            <NavLink to="/logs" className={sidebarLinkClass}>
              {icons.logs}
              Logs
            </NavLink>
          )}
        </nav>

        {record?.isAdmin === true && (
          <NavLink to="/settings" className={sidebarLinkClass}>
            {icons.settings}
            Settings
          </NavLink>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-gray-200 bg-white px-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {businessName && <span className="text-sm font-medium text-gray-700 truncate">{businessName}</span>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ScanInput />
            <div className="w-7 h-7 rounded-full bg-[#167cfb]/10 text-[#167cfb] text-xs font-semibold flex items-center justify-center shrink-0">
              {(record?.name || record?.email || "?").slice(0, 1).toUpperCase()}
            </div>
            <span className="text-sm text-gray-600 max-w-32 truncate hidden sm:inline">{record?.name || record?.email}</span>
            <button
              onClick={() => pb.authStore.clear()}
              title="Log out"
              className="flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              {icons.logout}
            </button>
          </div>
        </header>
        <main className="flex-1 p-5 min-w-0">
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
