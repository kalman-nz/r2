import { useEffect, useRef, useState } from "react";
import { api, type AddressMatch } from "../lib/api";
import { useDropdown } from "../lib/dropdown";
import { errorText } from "../lib/errors";

// An address with lookup as you type (pb_hooks/lib/addresses.js): pick a
// match and it's filled in a line at a time, still editable (for a level or
// a PO box). It only looks up while the address is on one line, so editing
// one that's been filled in doesn't keep offering more.
//
// Speed: answers are kept for the session, so backspacing is instant; while
// a new search is out, the last answers that still fit are shown; and the
// server opens its connection to the lookup when the box is focused, which
// is most of a first lookup's wait.

const answers = new Map<string, AddressMatch[]>();
let warmedAt = 0;

const keyFor = (q: string) => q.toLowerCase().replace(/\s+/g, " ");

// The answers to the longest earlier search this one extends, narrowed to
// those that still match every word typed.
function narrowed(key: string): AddressMatch[] | null {
  for (let i = key.length - 1; i >= 3; i--) {
    const earlier = answers.get(key.slice(0, i));
    if (!earlier) continue;
    const words = key.split(" ").filter(Boolean);
    return earlier.filter((m) => {
      const label = m.label.toLowerCase();
      return words.every((w) => label.includes(w));
    });
  }
  return null;
}

function warm() {
  // The server keeps a connection open for a minute or so.
  if (Date.now() - warmedAt < 60_000) return;
  warmedAt = Date.now();
  api.warmAddressLookup().catch(() => {});
}

export default function AddressInput({
  value,
  onChange,
  disabled = false,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
}) {
  const { open, setOpen, ref } = useDropdown();
  const [matches, setMatches] = useState<AddressMatch[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState("");
  // Only look up what someone's typing, not an address that's already there.
  const typed = useRef(false);
  const query = value.includes("\n") ? "" : value.trim();

  useEffect(() => {
    if (!typed.current || query.length < 3) return;
    const key = keyFor(query);
    const show = (found: AddressMatch[]) => {
      setMatches(found);
      setActive(0);
      setOpen(found.length > 0);
    };
    const known = answers.get(key);
    if (known) {
      show(known);
      setSearching(false);
      setProblem(known.length === 0 ? "No matches: keep typing, or type the address in full" : "");
      return;
    }
    // Something to look at straight away while the lookup runs.
    const meanwhile = narrowed(key);
    if (meanwhile && meanwhile.length > 0) {
      show(meanwhile);
      setProblem("");
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const found = await api.searchAddresses(query);
        answers.set(key, found);
        if (cancelled) return;
        show(found);
        setProblem(found.length === 0 ? "No matches: keep typing, or type the address in full" : "");
      } catch (err) {
        if (!cancelled) {
          setMatches([]);
          setProblem(errorText(err));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, setOpen]);

  function pick(match: AddressMatch) {
    typed.current = false;
    onChange(match.address);
    setMatches([]);
    setProblem("");
    setOpen(false);
  }

  const showing = open && matches.length > 0 && query.length >= 3;

  return (
    <div ref={ref} className="relative">
      <textarea
        value={value}
        onChange={(e) => {
          typed.current = true;
          if (e.target.value.trim().length < 3) {
            setMatches([]);
            setProblem("");
          }
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (!disabled) warm();
          if (matches.length > 0) setOpen(true);
        }}
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
        rows={rows}
        placeholder="Start typing an address to look it up"
        className="input py-2 w-full"
        role="combobox"
        aria-expanded={showing}
        aria-autocomplete="list"
      />
      {showing && (
        <div role="listbox" className="absolute left-0 right-0 top-full mt-1 card shadow-lg py-1 z-40 max-h-72 overflow-y-auto">
          {matches.map((m, i) => (
            <button
              key={m.address}
              type="button"
              role="option"
              aria-selected={i === active}
              // Before the textarea loses focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-3 py-2 text-sm ${i === active ? "bg-gray-50" : ""}`}
            >
              {(() => {
                const [first, ...rest] = m.address.split("\n");
                return (
                  <>
                    <span className="block text-gray-900">{first}</span>
                    {rest.length > 0 && <span className="block text-xs text-gray-500">{rest.join(", ")}</span>}
                  </>
                );
              })()}
            </button>
          ))}
          <p className="px-3 pt-1 pb-0.5 text-[11px] text-gray-400">Addresses © OpenStreetMap contributors</p>
        </div>
      )}
      {problem && !searching && <p className="mt-1 text-xs text-gray-500">{problem}</p>}
    </div>
  );
}
