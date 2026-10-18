import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import { useToast } from "./ToastProvider";
import { withOrg } from "../lib/currentOrg";

const SHOWN = 50;

// A searchable picker of contacts or venues: type to filter (by name and
// whatever detail is passed, an address say), arrows and Enter to choose.
// When nothing matches, the typed name can become a new one right there,
// so setting up a job never means leaving it half-filled. Fuller details
// can be added on the contact/venue's own page later.
export default function QuickCreateSelect({
  collection,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  canCreate = true,
}: {
  collection: "contacts" | "venues";
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string; detail?: string; archived?: boolean }[];
  disabled?: boolean;
  placeholder: string;
  canCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const selected = options.find((o) => o.id === value);
  const term = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      options
        .filter((o) => !o.archived || o.id === value)
        .filter((o) => !term || o.name.toLowerCase().includes(term) || (o.detail ?? "").toLowerCase().includes(term))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) || a.name.localeCompare(b.name))
        .slice(0, SHOWN),
    [options, term, value],
  );
  const exact = options.some((o) => o.name.trim().toLowerCase() === term);
  const offerCreate = canCreate && term !== "" && !exact;
  // The rows: "none" first (when not searching), the matches, then "create".
  const rows: ({ kind: "none" } | { kind: "option"; id: string } | { kind: "create" })[] = [
    ...(term ? [] : [{ kind: "none" as const }]),
    ...matches.map((o) => ({ kind: "option" as const, id: o.id })),
    ...(offerCreate ? [{ kind: "create" as const }] : []),
  ];

  // Closes on a click anywhere else.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function close() {
    setOpen(false);
    setSearch("");
  }

  function choose(id: string) {
    onChange(id);
    close();
  }

  async function create() {
    const name = search.trim();
    if (!name) return;
    setSaving(true);
    try {
      const record = await pb.collection(collection).create(withOrg({ name }));
      await queryClient.invalidateQueries({ queryKey: [collection] });
      choose(record.id);
    } catch (err) {
      showToast("error", `Couldn't create: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function pick(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "none") choose("");
    else if (row.kind === "option") choose(row.id);
    else create();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      if (open) e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  const rowClass = (index: number) => `w-full text-left px-3 py-1.5 flex flex-col ${index === active ? "bg-signal-soft" : "hover:bg-gray-50"}`;

  return (
    <div ref={box} className="relative">
      <input
        value={open ? search : (selected?.name ?? "")}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={disabled || saving}
        placeholder={open && selected ? selected.name : placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="input w-full pr-8"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
      {open && !disabled && (
        <div
          ref={list}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm"
        >
          {rows.map((row, index) =>
            row.kind === "none" ? (
              <button key="none" type="button" data-row={index} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(index)} className={rowClass(index)}>
                <span className="text-gray-500">{placeholder}</span>
              </button>
            ) : row.kind === "option" ? (
              (() => {
                const o = options.find((x) => x.id === row.id)!;
                return (
                  <button
                    key={o.id}
                    type="button"
                    data-row={index}
                    role="option"
                    aria-selected={o.id === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(index)}
                    className={rowClass(index)}
                  >
                    <span className={o.id === value ? "font-medium text-gray-900" : "text-gray-900"}>{o.name}</span>
                    {o.detail && <span className="text-xs text-gray-500 truncate">{o.detail}</span>}
                  </button>
                );
              })()
            ) : (
              <button key="create" type="button" data-row={index} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(index)} className={rowClass(index)}>
                <span className="text-signal-ink font-medium">
                  {saving ? "Adding…" : `+ Add "${search.trim()}" as a new ${collection === "contacts" ? "client" : "location"}`}
                </span>
              </button>
            ),
          )}
          {term && matches.length === 0 && !offerCreate && <p className="px-3 py-2 text-gray-500">No matches.</p>}
        </div>
      )}
    </div>
  );
}
