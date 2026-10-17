import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import AdminOrgs from "./AdminOrgs";
import AdminOrgDetail from "./AdminOrgDetail";
import AdminUsers from "./AdminUsers";

// The platform admin panel: R2's own operators looking after every
// organisation and account (pocketbase/pb_hooks/routes_admin.pb.js). It
// shows who's in what, not organisations' business data.
export default function AdminPage() {
  const tab = ({ isActive }: { isActive: boolean }) => (isActive ? "tab-underline-active" : "tab-underline-inactive");
  return (
    <div className="w-full max-w-5xl flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Platform admin</h1>
        <p className="text-sm text-gray-500 mt-0.5">Every organisation and account on this R2.</p>
      </div>
      <nav className="flex gap-5 border-b border-gray-200">
        <NavLink to="/admin/orgs" className={tab}>
          Organisations
        </NavLink>
        <NavLink to="/admin/users" className={tab}>
          Users
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate to="orgs" replace />} />
        <Route path="orgs" element={<AdminOrgs />} />
        <Route path="orgs/:id" element={<AdminOrgDetail />} />
        <Route path="users" element={<AdminUsers />} />
      </Routes>
    </div>
  );
}
