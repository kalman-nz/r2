// A role's name as a pill. The Admin role stands out; every other role is
// the organisation's own.
export default function RoleBadge({ name, locked = false }: { name: string; locked?: boolean }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${locked ? "bg-carbon text-white" : "bg-gray-100 text-gray-700"}`}
    >
      {name || "No role"}
    </span>
  );
}
