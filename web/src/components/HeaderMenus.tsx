import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { pb, useAuthRecord } from "../lib/pocketbase";
import { useDropdown } from "../lib/dropdown";
import { useOrg } from "../lib/org";
import RoleBadge from "./RoleBadge";

function MenuLink({ to, onClick, children }: { to: string; onClick: () => void; children: ReactNode }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
      {children}
    </Link>
  );
}

// Where to land after switching organisation: the same section, but not a
// record page — that record belongs to the organisation you just left.
const SECTIONS = ["projects", "inventory", "scan", "contacts", "locations", "custom-label", "finance", "settings"];
function sectionRoot(pathname: string): string {
  const first = pathname.split("/")[1] ?? "";
  if (first === "assets") return "/inventory";
  if (first === "labels") return "/settings/labels";
  if (first === "settings") return pathname;
  if (first === "finance") return "/finance/xero-export";
  return SECTIONS.includes(first) ? `/${first}` : "/";
}

export function OrgSwitcher() {
  const { org, memberships, invitations, switchOrg } = useOrg();
  const { open, setOpen, ref } = useDropdown();
  const navigate = useNavigate();
  const location = useLocation();

  function choose(id: string) {
    setOpen(false);
    if (id === org?.id) return;
    navigate(sectionRoot(location.pathname));
    switchOrg(id);
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 min-w-0 max-w-full h-8 px-2 rounded-md text-sm font-medium text-gray-800 hover:bg-gray-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{org?.name ?? "No organisation"}</span>
        {invitations.length > 0 && <span className="w-2 h-2 rounded-full bg-signal shrink-0" title="You have invitations" />}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-400 shrink-0">
          <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] card shadow-lg py-1 z-40">
          <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-gray-500">Your organisations</div>
          {memberships.map((m) => (
            <button
              key={m.org.id}
              role="menuitem"
              disabled={m.org.suspended}
              onClick={() => choose(m.org.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`truncate ${m.org.id === org?.id ? "font-semibold text-gray-900" : "text-gray-700"}`}>{m.org.name}</span>
              {m.org.suspended ? <span className="text-xs text-amber-700 shrink-0">Suspended</span> : <RoleBadge name={m.role.name} locked={m.role.locked} />}
            </button>
          ))}
          <div className="border-t border-gray-100 my-1" />
          <MenuLink to="/orgs" onClick={() => setOpen(false)}>
            <span>All organisations</span>
            {invitations.length > 0 && (
              <span className="text-xs font-semibold text-white bg-signal-ink rounded-full px-2 py-0.5">
                {invitations.length} invitation{invitations.length === 1 ? "" : "s"}
              </span>
            )}
          </MenuLink>
        </div>
      )}
    </div>
  );
}

export function UserMenu() {
  const record = useAuthRecord();
  const { isPlatformAdmin } = useOrg();
  const { open, setOpen, ref } = useDropdown();
  const close = () => setOpen(false);
  const label = record?.name || record?.email || "";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md hover:bg-gray-100 pl-0.5 pr-1.5 h-8"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-full bg-carbon text-white text-xs font-semibold flex items-center justify-center shrink-0">
          {(label || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm text-gray-600 max-w-32 truncate hidden lg:inline">{label}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-60 card shadow-lg py-1 z-40">
          <div className="px-3 py-2 border-b border-gray-100 mb-1">
            <div className="text-sm font-medium text-gray-900 truncate">{record?.name}</div>
            <div className="text-xs text-gray-500 truncate">{record?.email}</div>
          </div>
          <MenuLink to="/account" onClick={close}>
            Your account
          </MenuLink>
          <MenuLink to="/orgs" onClick={close}>
            Organisations
          </MenuLink>
          {isPlatformAdmin && (
            <MenuLink to="/admin" onClick={close}>
              Platform admin
            </MenuLink>
          )}
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => pb.authStore.clear()} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
