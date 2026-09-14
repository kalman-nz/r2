import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { ReactNode, SVGProps } from "react";
import LabelsList from "./LabelsList";
import UsersPage from "./UsersPage";
import PrinterSettings from "../components/PrinterSettings";
import GeneralSettings from "../components/GeneralSettings";

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

const NAV_ITEMS = [
  {
    to: "general",
    label: "General",
    icon: (
      <Icon>
        <path d="M3 21V9l9-6 9 6v12" />
        <path d="M9 21v-6h6v6" />
      </Icon>
    ),
  },
  {
    to: "printer",
    label: "Printing",
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
    icon: (
      <Icon>
        <path d="M3 8a2 2 0 0 1 2-2h9l7 6-7 6H5a2 2 0 0 1-2-2V8z" />
        <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </Icon>
    ),
  },
  {
    to: "users",
    label: "Users",
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 4.5a3 3 0 0 1 0 6.9" />
        <path d="M18.5 14a6.5 6.5 0 0 1 3.5 5.8" />
      </Icon>
    ),
  },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? "bg-blue-50 text-[#167cfb]" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;
}

export default function SettingsPage() {
  return (
    <div className="w-full flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
      <div className="flex items-start gap-6">
        <nav className="w-48 shrink-0 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={`/settings/${item.to}`} className={navLinkClass}>
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 min-w-0 max-w-2xl">
          <Routes>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="labels" element={<LabelsList />} />
            <Route path="printer" element={<PrinterSettings />} />
            <Route path="users" element={<UsersPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
