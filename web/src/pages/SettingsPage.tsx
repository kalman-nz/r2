import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
import LabelsList from "./LabelsList";
import PrinterSettings from "../components/PrinterSettings";
import GeneralSettings, { CalendarFeed } from "../components/GeneralSettings";
import PricingSettings from "../components/PricingSettings";
import CatalogSettings from "../components/CatalogSettings";
import CustomFieldsSettings from "../components/CustomFieldsSettings";
import RepairStatusesSettings from "../components/RepairStatusesSettings";
import ImportSettings from "../components/ImportSettings";
import AccountingSettings from "../components/AccountingSettings";
import MembersSettings from "../components/MembersSettings";
import RolesSettings from "../components/RolesSettings";
import LogsPage from "./LogsPage";
import RequireRole from "../components/RequireRole";
import { useRole } from "../lib/roles";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

type NavItem = { to: string; label: string; group: string; permissions: string[]; icon: ReactNode; wide?: boolean };

// Grouped in the nav under these headings, in this order. Each section
// shows to anyone whose role has any of its permissions.
const GROUPS = ["Organisation", "Finance", "Inventory", "Data"];

const NAV_ITEMS: NavItem[] = [
  {
    to: "general",
    label: "Business details",
    group: "Organisation",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <path d="M3 21V9l9-6 9 6v12" />
        <path d="M9 21v-6h6v6" />
      </Icon>
    ),
  },
  {
    to: "pricing",
    label: "Pricing & tax",
    group: "Finance",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <path d="M20 12l-8 8-9-9V3h8z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </Icon>
    ),
  },
  {
    to: "accounting",
    label: "Accounting",
    group: "Finance",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15v2" />
      </Icon>
    ),
  },
  {
    to: "inventory",
    label: "Storage locations",
    group: "Inventory",
    permissions: ["locations.create", "locations.edit", "locations.delete"],
    icon: (
      <Icon>
        <path d="M21 8l-9-5-9 5 9 5 9-5z" />
        <path d="M3 8v8l9 5 9-5V8" />
      </Icon>
    ),
  },
  {
    to: "custom-fields",
    label: "Custom fields",
    group: "Inventory",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 10h4M7 14h10" />
      </Icon>
    ),
  },
  {
    to: "repair-statuses",
    label: "Repair statuses",
    group: "Inventory",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
      </Icon>
    ),
  },
  {
    to: "import",
    label: "Import data",
    group: "Data",
    permissions: ["import.csv", "import.rentman"],
    icon: (
      <Icon>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M5 21h14" />
      </Icon>
    ),
  },
  {
    to: "printer",
    label: "Printers",
    group: "Inventory",
    permissions: ["settings.edit"],
    icon: (
      <Icon>
        <path d="M6 9V3h12v6" />
        <rect x="4" y="9" width="16" height="8" rx="1.5" />
        <path d="M6 17h12v5H6z" />
      </Icon>
    ),
  },
  {
    to: "labels",
    label: "Label templates",
    group: "Inventory",
    permissions: ["templates.create", "templates.edit", "templates.delete"],
    icon: (
      <Icon>
        <path d="M3 8a2 2 0 0 1 2-2h9l7 6-7 6H5a2 2 0 0 1-2-2V8z" />
        <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </Icon>
    ),
  },
  {
    to: "team",
    label: "Team members",
    group: "Organisation",
    permissions: ["team.manage"],
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 4.5a3 3 0 0 1 0 6.9" />
        <path d="M18.5 14a6.5 6.5 0 0 1 3.5 5.8" />
      </Icon>
    ),
  },
  {
    to: "roles",
    label: "Roles & permissions",
    group: "Organisation",
    permissions: ["roles.manage", "team.manage"],
    icon: (
      <Icon>
        <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
        <path d="M9 12h6M12 9v6" />
      </Icon>
    ),
  },
  {
    to: "calendar",
    label: "Calendar feed",
    group: "Data",
    permissions: ["calendar.manage"],
    icon: (
      <Icon>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M8 2v4M16 2v4M3 10h18" />
      </Icon>
    ),
  },
  {
    to: "activity",
    label: "Activity log",
    group: "Data",
    permissions: ["logs.view"],
    wide: true,
    icon: (
      <Icon>
        <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
        <path d="M9 12h6M9 16h6M9 8h3" />
      </Icon>
    ),
  },
];

// Whether any part of Settings is open to you (the sidebar link).
export function useSettingsAccess() {
  const { can } = useRole();
  const open = NAV_ITEMS.filter((item) => item.permissions.some(can));
  return GROUPS.flatMap((group) => open.filter((item) => item.group === group));
}

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap ${
    isActive ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 [&>svg]:text-signal" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;
}

export default function SettingsPage() {
  const items = useSettingsAccess();
  const location = useLocation();
  const current = items.find((i) => location.pathname.startsWith(`/settings/${i.to}`));
  const gate = (to: string, element: ReactNode) => {
    const item = NAV_ITEMS.find((i) => i.to === to)!;
    return <RequireRole permission={item.permissions}>{element}</RequireRole>;
  };
  return (
    <div className="w-full flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        <p className="text-xs text-gray-500">{current ? `${current.group} · ${current.label}` : "Your organisation's setup"}</p>
      </div>
      <div className="flex flex-col md:flex-row items-start gap-6">
        <nav className="w-full md:w-52 shrink-0 flex md:flex-col gap-0.5 md:gap-4 overflow-x-auto">
          {GROUPS.map((group) => {
            const inGroup = items.filter((i) => i.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="flex md:flex-col gap-0.5 shrink-0">
                <div className="hidden md:block px-3 pb-1.5 eyebrow text-gray-500">{group}</div>
                {inGroup.map((item) => (
                  <NavLink key={item.to} to={`/settings/${item.to}`} className={navLinkClass}>
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={`flex-1 min-w-0 w-full ${current?.wide ? "max-w-6xl" : "max-w-3xl"}`}>
          <Routes>
            <Route index element={items[0] ? <Navigate to={items[0].to} replace /> : <Navigate to="/" replace />} />
            <Route path="general" element={gate("general", <GeneralSettings />)} />
            <Route path="pricing" element={gate("pricing", <PricingSettings />)} />
            <Route path="accounting" element={gate("accounting", <AccountingSettings />)} />
            <Route path="inventory" element={gate("inventory", <CatalogSettings />)} />
            <Route path="custom-fields" element={gate("custom-fields", <CustomFieldsSettings />)} />
            <Route path="repair-statuses" element={gate("repair-statuses", <RepairStatusesSettings />)} />
            <Route path="import" element={gate("import", <ImportSettings />)} />
            <Route path="labels" element={gate("labels", <LabelsList />)} />
            <Route path="printer" element={gate("printer", <PrinterSettings />)} />
            <Route path="team" element={gate("team", <MembersSettings />)} />
            <Route path="roles" element={gate("roles", <RolesSettings />)} />
            <Route path="calendar" element={gate("calendar", <CalendarFeed />)} />
            <Route path="activity" element={gate("activity", <LogsPage />)} />
            <Route path="users" element={<Navigate to="/settings/team" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
