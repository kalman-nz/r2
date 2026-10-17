import { useSearchParams } from "react-router-dom";

export interface TabDef<K extends string> {
  key: K;
  label: string;
  count?: number;
}

// Which tab a record page is on, kept in the URL (?tab=) so a link can open
// straight to it. The first tab is the default and leaves the URL clean.
export function useTab<K extends string>(tabs: TabDef<K>[]): [K, (tab: K) => void] {
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const current = tabs.find((t) => t.key === asked)?.key ?? tabs[0].key;
  const open = (tab: K) => setParams(tab === tabs[0].key ? {} : { tab }, { replace: true });
  return [current, open];
}

// The underlined tab row under a record page's header (projects, items).
export function TabBar<K extends string>({ tabs, current, onOpen, label }: { tabs: TabDef<K>[]; current: K; onOpen: (tab: K) => void; label: string }) {
  return (
    <nav className="flex items-center gap-6 border-b border-gray-200 overflow-x-auto" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onOpen(t.key)}
          className={`${current === t.key ? "tab-underline-active" : "tab-underline-inactive"} whitespace-nowrap`}
          aria-current={current === t.key ? "page" : undefined}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 font-mono text-xs text-gray-400">{t.count}</span>}
        </button>
      ))}
    </nav>
  );
}
