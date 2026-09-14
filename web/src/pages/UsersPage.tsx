import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function UsersPage() {
  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Users</h2>
          <p className="text-xs text-gray-500 mt-0.5">Who can sign in to Rentman+ and print labels.</p>
        </div>
        <Link to="/users/new" className="btn-primary">
          New user
        </Link>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}

      <div className="card divide-y divide-gray-100 overflow-hidden">
        {users?.map((u) => (
          <Link
            key={u.id}
            to={`/users/${u.id}`}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
          >
            <div className="flex flex-col">
              <span className="font-medium text-gray-900">{u.name || u.email}</span>
              <span className="text-gray-500 text-xs">{u.email}</span>
            </div>
            {u.isAdmin && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Admin</span>
            )}
          </Link>
        ))}
        {!isLoading && users?.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm">No users yet.</p>}
      </div>
    </div>
  );
}
