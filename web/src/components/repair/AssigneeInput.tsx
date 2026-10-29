import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useDropdown } from "../../lib/dropdown";
import { useOrg } from "../../lib/org";

// Who a repair's assigned to: someone in the organisation, picked from a
// search, or any name typed in (an outside supplier). It's kept as the name.
export default function AssigneeInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { org } = useOrg();
  const { open, setOpen, ref } = useDropdown();
  const [active, setActive] = useState(0);
  const { data: members = [] } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api.listMembers(org!.id),
    enabled: !!org,
  });
  const term = value.trim().toLowerCase();
  const names = members.map((m) => m.name || m.email).filter(Boolean);
  const matches = names.filter((n) => !term || n.toLowerCase().includes(term)).slice(0, 8);
  const showing = open && matches.length > 0 && !names.some((n) => n === value.trim());

  function pick(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          }
        }}
        disabled={disabled}
        placeholder="Someone on the team, or a supplier"
        className="input py-1.5 w-full"
        autoComplete="off"
      />
      {showing && (
        <div className="absolute left-0 right-0 top-full mt-1 card shadow-lg z-40 py-1 max-h-60 overflow-y-auto">
          {matches.map((name, i) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(name)}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === active ? "bg-gray-50 text-gray-900" : "text-gray-700"} hover:bg-gray-50`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
