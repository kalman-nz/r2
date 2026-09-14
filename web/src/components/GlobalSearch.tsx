import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SearchResultItem, type SearchResults } from "../lib/api";
import { useToast } from "./ToastProvider";

const EMPTY: SearchResults = { equipment: [], assets: [], labels: [] };

interface FlatResult extends SearchResultItem {
  section: "equipment" | "assets" | "labels";
}

function flatten(results: SearchResults): FlatResult[] {
  return [
    ...results.equipment.map((r) => ({ ...r, section: "equipment" as const })),
    ...results.assets.map((r) => ({ ...r, section: "assets" as const })),
    ...results.labels.map((r) => ({ ...r, section: "labels" as const })),
  ];
}

function path(item: FlatResult): string {
  if (item.section === "equipment") return `/equipment/${item.id}`;
  if (item.section === "assets") return `/assets/${item.id}`;
  return `/labels/${item.id}`;
}

const SECTION_LABEL = { equipment: "Equipment", assets: "Assets", labels: "Label templates" };

// A handheld barcode/QR scanner acts like a keyboard: it types the scanned
// value into whatever's focused, then sends Enter, never touching arrow
// keys. So Enter only ever selects a highlighted dropdown result (meaning a
// person explicitly arrowed through it); with nothing highlighted it falls
// straight through to the old exact-match scan lookup, so scanning still
// works exactly as before regardless of what the live dropdown shows.
export default function GlobalSearch() {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    const term = value.trim();
    if (!term) {
      setResults(EMPTY);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(term, controller.signal)
        .then((r) => {
          setResults(r);
          setOpen(true);
          setHighlighted(-1);
        })
        .catch(() => {
          // Aborted (superseded by a newer keystroke) or a transient
          // network error — either way, just leave the last good results.
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  function select(item: FlatResult) {
    setValue("");
    setResults(EMPTY);
    setOpen(false);
    navigate(path(item));
  }

  async function scanFallback(q: string) {
    setValue("");
    setOpen(false);
    try {
      const { id } = await api.searchAssets(q);
      navigate(`/assets/${id}`);
    } catch {
      showToast("error", `No asset found for "${q}"`);
    } finally {
      inputRef.current?.focus();
    }
  }

  const flat = flatten(results);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open && flat.length > 0) {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % flat.length);
      return;
    }
    if (e.key === "ArrowUp" && open && flat.length > 0) {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? flat.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (highlighted >= 0 && flat[highlighted]) {
      select(flat[highlighted]);
      return;
    }
    const q = value.trim();
    if (q) scanFallback(q);
  }

  let sectionCursor = -1;

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => flat.length > 0 && setOpen(true)}
        placeholder="Search everything or scan…"
        className="input w-64 sm:w-80"
      />
      {open && (
        <div className="absolute top-full left-0 mt-1 w-full sm:w-96 card shadow-lg z-30 py-1 max-h-96 overflow-y-auto">
          {flat.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No matches for "{value.trim()}"</p>}
          {(["equipment", "assets", "labels"] as const).map((section) => {
            const items = results[section];
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {SECTION_LABEL[section]}
                </div>
                {items.map((item) => {
                  sectionCursor += 1;
                  const idx = sectionCursor;
                  return (
                    <button
                      key={item.id}
                      onMouseEnter={() => setHighlighted(idx)}
                      onClick={() => select({ ...item, section })}
                      className={`w-full text-left px-3 py-1.5 text-sm flex flex-col min-w-0 ${
                        highlighted === idx ? "bg-blue-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-gray-900 truncate">{item.name}</span>
                      {item.subtitle && <span className="text-gray-400 text-xs truncate">{item.subtitle}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
