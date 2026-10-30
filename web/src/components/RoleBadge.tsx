// A role's name as plain text (no pill). The Admin role is a touch darker;
// every other role is the organisation's own.
export default function RoleBadge({ name, locked = false }: { name: string; locked?: boolean }) {
  return <span className={`text-xs whitespace-nowrap ${locked ? "font-medium text-gray-900" : "text-gray-600"}`}>{name || "No role"}</span>;
}
