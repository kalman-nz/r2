import { Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCategories } from "../lib/catalog";
import { indexFolders, trail } from "../lib/folders";

export interface Crumb {
  label: string;
  // Left off for the page you're on.
  to?: string;
}

// The trail above a record page's header: Inventory › Folder › Item › Unit.
export default function Breadcrumbs({ crumbs, className = "" }: { crumbs: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1.5 text-sm text-gray-500 flex-wrap min-w-0 ${className}`}>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-gray-300" aria-hidden>›</span>}
          {c.to ? (
            <Link to={c.to} className="hover:text-gray-900 truncate max-w-[16rem]">
              {c.label}
            </Link>
          ) : (
            <span className="text-gray-900 truncate max-w-[20rem]" aria-current="page">
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

// Inventory, then each folder down to this one.
export function useFolderCrumbs(folderId: string): Crumb[] {
  const { data: categories = [] } = useCategories();
  const folders = useMemo(() => indexFolders(categories), [categories]);
  return [
    { label: "Inventory", to: "/inventory" },
    ...trail(folders, folderId).map((f) => ({ label: f.name, to: `/inventory?folder=${f.id}` })),
  ];
}
