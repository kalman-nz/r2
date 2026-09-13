import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import LabelsList from "./LabelsList";
import UsersPage from "./UsersPage";
import PrinterSettings from "../components/PrinterSettings";
import GeneralSettings from "../components/GeneralSettings";

function tabClass({ isActive }: { isActive: boolean }) {
  return isActive ? "tab-underline-active" : "tab-underline-inactive";
}

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
      <nav className="flex gap-5 border-b border-gray-200">
        <NavLink to="/settings/general" className={tabClass}>
          General
        </NavLink>
        <NavLink to="/settings/labels" className={tabClass}>
          Label templates
        </NavLink>
        <NavLink to="/settings/printer" className={tabClass}>
          Printer
        </NavLink>
        <NavLink to="/settings/users" className={tabClass}>
          Users
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<GeneralSettings />} />
        <Route path="labels" element={<LabelsList />} />
        <Route path="printer" element={<PrinterSettings />} />
        <Route path="users" element={<UsersPage />} />
      </Routes>
    </div>
  );
}
