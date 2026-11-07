import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item } from "../../lib/api";
import { displayPath, useCategoryPaths } from "../../lib/catalog";
import { errorText } from "../../lib/errors";
import { orgFilter } from "../../lib/currentOrg";
import { useToast } from "../ToastProvider";

const SHOWN = 8;

// "3 beta 58", "3x beta 58" or "beta 58 x3" → 3 of "beta 58".
function parse(text: string): { quantity: number; term: string } {
  const t = text.trim();
  const lead = t.match(/^(\d+)\s*[x×*]?\s+(.+)$/i) ?? t.match(/^(\d+)[x×*](.+)$/i);
  if (lead) return { quantity: Math.max(1, Number(lead[1])), term: lead[2].trim() };
  const tail = t.match(/^(.+?)\s+[x×*](\d+)$/i);
  if (tail) return { quantity: Math.max(1, Number(tail[2])), term: tail[1].trim() };
  return { quantity: 1, term: t };
}

// Typing equipment straight into the list: a box at the end of each heading
// that finds inventory as you type, and Enter adds the highlighted one there.
// When nothing matches, what was typed can go in as a custom line or a new
// heading instead.
export default function QuickAdd({
  id,
  jobId,
  start,
  end,
  placeholder,
  onAdd,
  onCustom,
  onHeading,
}: {
  id: string;
  jobId: string;
  start: string;
  end: string;
  placeholder: string;
  onAdd: (itemId: string, quantity: number) => Promise<void>;
  onCustom: (description: string, quantity: number) => Promise<void>;
  onHeading: (name: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const paths = useCategoryPaths();

  const { data: items = [] } = useQuery({
    queryKey: ["items", "active"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter("archived = false"), sort: "name" }),
    enabled: open,
  });
  const { data: availability } = useQuery({
    queryKey: ["availability", jobId, start, end],
    queryFn: () => api.availability(start, end, jobId),
    enabled: open && Boolean(start && end),
  });

  const { quantity, term } = parse(text);
  const results = useMemo(() => {
    const q = term.toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    const scored: { item: Item; score: number }[] = [];
    for (const item of items) {
      const name = item.name.toLowerCase();
      const code = (item.code ?? "").toLowerCase();
      const barcode = (item.barcode ?? "").toLowerCase();
      // Each word typed matches the start of a word ("sm" finds SM58, not
      // tranSMitter), or anywhere in the code or barcode.
      const tokens = `${name} ${(paths.get(item.category) ?? "").toLowerCase()}`.split(/[^a-z0-9]+/);
      if (!words.every((w) => tokens.some((t) => t.startsWith(w)) || code.includes(w) || barcode.includes(w))) continue;
      const score = code === q || barcode === q ? 0 : name.startsWith(q) ? 1 : code.startsWith(q) ? 2 : name.includes(q) ? 3 : 4;
      scored.push({ item, score });
    }
    scored.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
    return scored.slice(0, SHOWN).map((s) => s.item);
  }, [items, term, paths]);

  // Nothing in inventory matches (once it's loaded): offer a custom line or
  // a heading.
  const custom = term !== "" && results.length === 0 && items.length > 0;
  const heading = text.trim();
  const choices = custom
    ? [
        {
          key: "line",
          label: (
            <>
              Add <span className="font-medium">{quantity > 1 ? `${quantity} × ` : ""}“{term}”</span> as a custom line
            </>
          ),
          run: () => save(() => onCustom(term, quantity), term),
        },
        {
          key: "heading",
          label: (
            <>
              Add <span className="font-medium">“{heading}”</span> as a heading
            </>
          ),
          run: () => save(() => onHeading(heading), heading),
        },
      ]
    : [];
  const count = custom ? choices.length : results.length;
  const pick = results[Math.min(at, results.length - 1)];
  const choice = choices[Math.min(at, choices.length - 1)];

  const add = (item: Item) => save(() => onAdd(item.id, quantity), item.name);

  async function save(action: () => Promise<void>, what: string) {
    setBusy(true);
    try {
      await action();
      setText("");
      setAt(0);
    } catch (err) {
      showToast("error", `Couldn't add ${what}: ${errorText(err)}`);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const showList = open && term !== "";

  return (
    <div className="relative w-full max-w-md">
      <input
        ref={inputRef}
        data-quickadd={id}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setAt(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Clicking away drops whatever wasn't added.
          setOpen(false);
          setText("");
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && count) {
            e.preventDefault();
            setAt((i) => (i + 1) % count);
          } else if (e.key === "ArrowUp" && count) {
            e.preventDefault();
            setAt((i) => (i - 1 + count) % count);
          } else if (e.key === "Enter" && choice) {
            e.preventDefault();
            choice.run();
          } else if (e.key === "Enter" && pick) {
            e.preventDefault();
            add(pick);
          } else if (e.key === "Escape") {
            setText("");
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="input py-1 w-full text-[13px] border-transparent bg-transparent hover:border-gray-300 focus:bg-white placeholder:text-signal-ink/80 focus:placeholder:text-gray-400"
      />
      {showList && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[min(32rem,90vw)] bg-white border border-gray-200 rounded-md shadow-lg py-1">
          {custom ? (
            <>
              <p className="px-3 pt-1 pb-1.5 text-xs text-gray-500">Nothing in inventory matches</p>
              {choices.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setAt(i)}
                  onClick={c.run}
                  className={`w-full px-3 py-1.5 text-left text-gray-900 ${c === choice ? "bg-signal-soft" : ""}`}
                >
                  {c.label}
                </button>
              ))}
            </>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-gray-500">Loading…</p>
          ) : (
            results.map((item, i) => {
              const a = availability?.[item.id];
              const short = a ? a.free < quantity : false;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => add(item)}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 text-left ${item === pick ? "bg-signal-soft" : ""}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-gray-900 truncate">
                      {quantity > 1 && <span className="text-gray-500 font-normal">{quantity} × </span>}
                      {item.name}
                      {item.kind === "kit" && <span className="text-gray-500 font-normal"> · kit</span>}
                    </span>
                    <span className="block text-xs text-gray-500 truncate">
                      {[item.code, displayPath(paths.get(item.category))].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`text-xs tabular-nums shrink-0 ${short ? "text-fault-ink font-medium" : "text-gray-500"}`}>
                    {a ? `${a.free} free` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
