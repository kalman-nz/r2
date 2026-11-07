import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// A small "go there" link: grey text and a chevron in a quiet button that
// shades on hover. For links that take you somewhere (Open schedule, All
// projects, View all), not for actions like Edit. Give it to (a page in
// R2), href (another site, opened in a new tab, with an arrow out) or
// onClick.
const CLASS =
  "inline-flex items-center gap-0.5 h-7 pl-2 pr-1.5 -my-1 rounded-md text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 whitespace-nowrap w-fit transition-colors";

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}

function OutArrow() {
  return (
    <svg viewBox="0 0 20 20" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 13l6-6M8 7h5v5" />
    </svg>
  );
}

export default function ArrowLink({
  to,
  href,
  onClick,
  children,
  className = "",
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const cls = `${CLASS} ${className}`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
        <OutArrow />
      </a>
    );
  }
  if (to) {
    return (
      <Link to={to} onClick={onClick} className={cls}>
        {children}
        <Chevron />
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
      <Chevron />
    </button>
  );
}
