import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
import JobsList from "./pages/JobsList";
import JobDetail from "./pages/JobDetail";
import ScanPage from "./pages/ScanPage";
import ExportsPage from "./pages/ExportsPage";
import QuoteView from "./pages/QuoteView";
import PackingList from "./pages/PackingList";
import ItemsList from "./pages/ItemsList";
import ItemDetail from "./pages/ItemDetail";
import SerialDetail from "./pages/SerialDetail";
import { ContactDetail, ContactsList, VenueDetail, VenuesList } from "./pages/Directory";
import SettingsPage, { useSettingsAccess } from "./pages/SettingsPage";
import LogsPage from "./pages/LogsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import { ResetPasswordPage, VerifyEmailPage } from "./pages/AuthLinkPages";
import OrgsPage from "./pages/OrgsPage";
import AccountPage from "./pages/AccountPage";
import RequireAuth from "./components/RequireAuth";
import RequireRole from "./components/RequireRole";
import GlobalSearch from "./components/GlobalSearch";
import { OrgSwitcher, UserMenu } from "./components/HeaderMenus";
import { useRole } from "./lib/roles";
import { useOrg } from "./lib/org";
import { api } from "./lib/api";

// The two label pages carry the label renderer, and the admin panel is for
// a handful of people; load them on demand.
const CustomLabelPage = lazy(() => import("./pages/CustomLabelPage"));
const LabelEditor = lazy(() => import("./pages/LabelEditor"));
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0" {...props}>
      {children}
    </svg>
  );
}

const icons = {
  jobs: (
    <Icon>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </Icon>
  ),
  inventory: (
    <Icon>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </Icon>
  ),
  scan: (
    <Icon>
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 8v8M11 8v8M14 8v8M17 8v8" />
    </Icon>
  ),
  contacts: (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3 3 0 0 1 0 6.9" />
      <path d="M18.5 14a6.5 6.5 0 0 1 3.5 5.8" />
    </Icon>
  ),
  venues: (
    <Icon>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Icon>
  ),
  exports: (
    <Icon>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Icon>
  ),
  label: (
    <Icon>
      <path d="M3 8a2 2 0 0 1 2-2h9l7 6-7 6H5a2 2 0 0 1-2-2V8z" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
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
  orgs: (
    <Icon>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11" />
      <path d="M8 8h3M8 12h3M8 16h3M2 21h20" />
    </Icon>
  ),
  admin: (
    <Icon>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  ),
};

// Icons only on phones (the scan page needs the width), labels from md up.
function sidebarLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 mx-2 px-2.5 h-9 rounded-md text-sm font-medium border-l-2 ${
    isActive ? "bg-white/10 text-white border-[#167cfb]" : "text-zinc-400 border-transparent hover:bg-white/5 hover:text-white"
  }`;
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={sidebarLinkClass} title={label}>
      {icon}
      <span className="hidden md:inline truncate">{label}</span>
    </NavLink>
  );
}

function usePageViewLogging() {
  const location = useLocation();
  useEffect(() => {
    api.logEvent("page_view", { path: location.pathname }).catch(() => {});
  }, [location.pathname]);
}

// The browser tab shows "R2", plus the business's short name when set.
function useTabTitle(enabled: boolean) {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings, enabled });
  const shortOrFull = enabled ? settings?.businessShortName || settings?.businessName : "";
  const tabTitle = shortOrFull ? `R2 | ${shortOrFull}` : "R2";
  useEffect(() => {
    document.title = tabTitle;
  }, [tabTitle]);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function AppShell() {
  const { org, memberships } = useOrg();
  const { can, isPlatformAdmin } = useRole();
  const settingsOpen = useSettingsAccess().length > 0;
  useTabTitle(!!org);
  const online = useOnline();
  usePageViewLogging();
  return (
    <div className="h-screen flex overflow-hidden">
      <aside className="w-14 md:w-52 shrink-0 flex flex-col h-screen sticky top-0 py-3" style={{ background: "#2b2d31" }}>
        <div className="flex items-center gap-2.5 px-3.5 md:px-4 h-9 mb-3 shrink-0">
          <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-white font-bold text-xs shrink-0">R2</div>
          <span className="hidden md:inline text-white font-semibold text-sm tracking-tight truncate">R2</span>
        </div>

        <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5">
          {org ? (
            <>
              <NavItem to="/jobs" icon={icons.jobs} label="Jobs" />
              <NavItem to="/inventory" icon={icons.inventory} label="Inventory" />
              {(can("scan.out") || can("scan.in")) && <NavItem to="/scan" icon={icons.scan} label="Scan" />}
              <NavItem to="/contacts" icon={icons.contacts} label="Contacts" />
              <NavItem to="/venues" icon={icons.venues} label="Venues" />
              {can("labels.print") && <NavItem to="/custom-label" icon={icons.label} label="Custom label" />}
              {can("export.xero") && <NavItem to="/exports" icon={icons.exports} label="Exports" />}
              {can("logs.view") && <NavItem to="/logs" icon={icons.logs} label="Logs" />}
            </>
          ) : (
            <NavItem to="/orgs" icon={icons.orgs} label="Organisations" />
          )}
        </nav>

        {isPlatformAdmin && <NavItem to="/admin" icon={icons.admin} label="Platform admin" />}
        {org && settingsOpen && <NavItem to="/settings" icon={icons.settings} label="Settings" />}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="h-12 border-b border-gray-200 bg-white px-3 md:px-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {memberships.length > 0 ? <OrgSwitcher /> : <span className="text-sm font-medium text-gray-700">R2</span>}
            {!online && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap"
                title="Showing what was last loaded. Changes and scans need a connection."
              >
                Offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {org && <GlobalSearch />}
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-y-auto p-3 md:p-5 min-w-0">
          <Suspense fallback={<p className="text-gray-500 text-sm">Loading…</p>}>
            <Routes>
              {/* Yours, whichever organisation you're in (or none yet). */}
              <Route path="/orgs" element={<OrgsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route
                path="/admin/*"
                element={
                  <RequireRole permission="platform">
                    <AdminPage />
                  </RequireRole>
                }
              />
              {org ? (
                <>
                  <Route path="/" element={<Navigate to="/jobs" replace />} />
                  <Route path="/jobs" element={<JobsList />} />
                  <Route path="/jobs/:id" element={<JobDetail />} />
                  <Route path="/jobs/:id/scan" element={<ScanPage />} />
                  <Route path="/scan" element={<ScanPage />} />
                  <Route path="/inventory" element={<ItemsList />} />
                  <Route path="/inventory/:id" element={<ItemDetail />} />
                  <Route path="/assets/:id" element={<SerialDetail />} />
                  <Route path="/contacts" element={<ContactsList />} />
                  <Route path="/contacts/:id" element={<ContactDetail />} />
                  <Route path="/venues" element={<VenuesList />} />
                  <Route path="/venues/:id" element={<VenueDetail />} />
                  <Route
                    path="/custom-label"
                    element={
                      <RequireRole permission="labels.print">
                        <CustomLabelPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/exports"
                    element={
                      <RequireRole permission="export.xero">
                        <ExportsPage />
                      </RequireRole>
                    }
                  />
                  {/* Old Rentman+ bookmarks */}
                  <Route path="/equipment/*" element={<Navigate to="/inventory" replace />} />
                  <Route
                    path="/logs"
                    element={
                      <RequireRole permission="logs.view">
                        <LogsPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="/labels/:id"
                    element={
                      <RequireRole permission={["templates.create", "templates.edit"]}>
                        <LabelEditor />
                      </RequireRole>
                    }
                  />
                  <Route path="/settings/*" element={<SettingsPage />} />
                </>
              ) : (
                // Not in an organisation yet (or only suspended ones):
                // everything else waits for an invitation.
                <Route path="*" element={<Navigate to="/orgs" replace />} />
              )}
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// Waits for /api/me the first time, then gives each organisation a fresh
// shell, so nothing on screen carries over from the last one.
function OrgShell() {
  const { ready, org } = useOrg();
  if (!ready) return <div className="h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div>;
  return <AppShell key={org?.id ?? "none"} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      {/* Links in account emails (pb_migrations/0023_auth_emails.js) */}
      <Route path="/verify/:token" element={<VerifyEmailPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      {/* Print views: no sidebar or header, laid out for A4. The server
          checks the role in the quote's or job's own organisation. */}
      <Route
        path="/print/quotes/:id"
        element={
          <RequireAuth>
            <QuoteView />
          </RequireAuth>
        }
      />
      <Route
        path="/print/jobs/:id/packing"
        element={
          <RequireAuth>
            <PackingList />
          </RequireAuth>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <OrgShell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
