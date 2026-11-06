import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { errorText } from "../lib/errors";
import { withOrg } from "../lib/currentOrg";
import { oneLineAddress } from "../lib/format";
import { useVenues, useVenueSpaces } from "../lib/catalog";
import { useCan } from "../lib/roles";
import { useToast } from "./ToastProvider";

const SHOWN = 50;

export type Place = { venue: string; spaces: string[] };

type Row =
  | { kind: "none" }
  | { kind: "venue"; id: string }
  | { kind: "space"; id: string; venue: string }
  | { kind: "newVenue" }
  | { kind: "newSpace" };

// Where a project is: one search box over locations and their spaces.
// A location on its own is the whole place; a space picks its location
// too, and more of the same location's spaces can be ticked after it.
export default function LocationPicker({ value, onChange }: { value: Place; onChange: (next: Place) => void }) {
  const can = useCan();
  const { data: venues = [] } = useVenues();
  const { data: allSpaces = [] } = useVenueSpaces();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const selected = venueById.get(value.venue);
  const chosenSpaces = allSpaces.filter((s) => value.spaces.includes(s.id));
  const label = selected ? [selected.name, chosenSpaces.map((s) => s.name).join(", ")].filter(Boolean).join(" · ") : "";

  const term = search.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    const has = (text: string | undefined) => !term || (text ?? "").toLowerCase().includes(term);
    const out: Row[] = term ? [] : [{ kind: "none" }];
    const shown = venues
      .filter((v) => !v.archived || v.id === value.venue)
      .map((v) => {
        const spaces = allSpaces.filter((s) => s.venue === v.id);
        const venueHit = has(v.name) || has(oneLineAddress(v.address));
        // A location that matches shows all its spaces; otherwise only the
        // spaces that match, under their location.
        const spaceHits = venueHit ? spaces : spaces.filter((s) => has(s.name));
        return { v, spaces: spaceHits, show: venueHit || spaceHits.length > 0, starts: v.name.toLowerCase().startsWith(term) };
      })
      .filter((x) => x.show)
      // The current location first when not searching, then names starting with the search.
      .sort(
        (a, b) =>
          (!term ? Number(b.v.id === value.venue) - Number(a.v.id === value.venue) : 0) ||
          Number(b.starts) - Number(a.starts) ||
          a.v.name.localeCompare(b.v.name),
      )
      .slice(0, SHOWN);
    for (const { v, spaces } of shown) {
      out.push({ kind: "venue", id: v.id });
      for (const s of spaces) out.push({ kind: "space", id: s.id, venue: v.id });
    }
    if (term) {
      const name = term;
      if (can("venues.create") && !venues.some((v) => v.name.trim().toLowerCase() === name)) out.push({ kind: "newVenue" });
      if (selected && can("venues.edit") && !allSpaces.some((s) => s.venue === selected.id && s.name.trim().toLowerCase() === name)) out.push({ kind: "newSpace" });
    }
    return out;
  }, [venues, allSpaces, term, value.venue, selected, can]);

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

  // A space from another location starts over there; one from this
  // location is ticked on or off and the list stays open for more.
  function toggleSpace(id: string, venue: string) {
    if (venue !== value.venue) {
      onChange({ venue, spaces: [id] });
    } else {
      const next = value.spaces.includes(id) ? value.spaces.filter((x) => x !== id) : [...value.spaces, id];
      // Kept in the location's order.
      onChange({ venue, spaces: allSpaces.filter((s) => next.includes(s.id)).map((s) => s.id) });
    }
    setSearch("");
  }

  async function createVenue() {
    const name = search.trim();
    if (!name) return;
    setSaving(true);
    try {
      const record = await pb.collection("venues").create(withOrg({ name }));
      await queryClient.invalidateQueries({ queryKey: ["venues"] });
      onChange({ venue: record.id, spaces: [] });
      close();
    } catch (err) {
      showToast("error", `Couldn't add the location: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function createSpace() {
    const name = search.trim();
    if (!name || !selected) return;
    setSaving(true);
    try {
      const mine = allSpaces.filter((s) => s.venue === selected.id);
      const sortOrder = Math.max(0, ...mine.map((s) => s.sortOrder ?? 0)) + 10;
      const record = await pb.collection("venue_spaces").create(withOrg({ venue: selected.id, name, sortOrder }));
      await queryClient.invalidateQueries({ queryKey: ["venue_spaces"] });
      onChange({ venue: selected.id, spaces: [...value.spaces, record.id] });
      setSearch("");
    } catch (err) {
      showToast("error", `Couldn't add the space: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function pick(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "none") {
      onChange({ venue: "", spaces: [] });
      close();
    } else if (row.kind === "venue") {
      onChange({ venue: row.id, spaces: [] });
      close();
    } else if (row.kind === "space") toggleSpace(row.id, row.venue);
    else if (row.kind === "newVenue") createVenue();
    else createSpace();
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

  const rowClass = (index: number, extra = "") => `w-full text-left py-1.5 flex items-center gap-2 ${extra} ${index === active ? "bg-signal-soft" : "hover:bg-gray-50"}`;
  const hold = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={box} className="relative">
      <input
        value={open ? search : label}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={saving}
        placeholder={open && label ? label : "No location"}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="input w-full pr-8"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
      {open && (
        <div ref={list} role="listbox" className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg text-sm">
          {rows.map((row, index) => {
            if (row.kind === "none")
              return (
                <button key="none" type="button" data-row={index} onMouseDown={hold} onClick={() => pick(index)} className={rowClass(index, "px-3")}>
                  <span className="text-gray-500">No location</span>
                </button>
              );
            if (row.kind === "venue") {
              const v = venueById.get(row.id)!;
              const whole = v.id === value.venue && value.spaces.length === 0;
              const address = oneLineAddress(v.address);
              return (
                <button key={v.id} type="button" data-row={index} role="option" aria-selected={whole} onMouseDown={hold} onClick={() => pick(index)} className={rowClass(index, "px-3")}>
                  <span className="w-4 shrink-0 text-signal-ink">{whole ? "✓" : ""}</span>
                  <span className="flex flex-col min-w-0">
                    <span className={`text-gray-900 ${v.id === value.venue ? "font-medium" : ""}`}>{v.name}</span>
                    {address && <span className="text-xs text-gray-500 truncate">{address}</span>}
                  </span>
                </button>
              );
            }
            if (row.kind === "space") {
              const s = allSpaces.find((x) => x.id === row.id)!;
              const on = row.venue === value.venue && value.spaces.includes(s.id);
              return (
                <button key={s.id} type="button" data-row={index} role="option" aria-selected={on} onMouseDown={hold} onClick={() => pick(index)} className={rowClass(index, "pl-9 pr-3")}>
                  <span className="w-4 shrink-0 text-signal-ink">{on ? "✓" : ""}</span>
                  <span className="text-gray-700">{s.name}</span>
                </button>
              );
            }
            return (
              <button key={row.kind} type="button" data-row={index} onMouseDown={hold} onClick={() => pick(index)} className={rowClass(index, "px-3")}>
                <span className="text-signal-ink font-medium">
                  {saving ? "Adding…" : row.kind === "newVenue" ? `+ Add "${search.trim()}" as a new location` : `+ Add "${search.trim()}" as a space at ${selected?.name}`}
                </span>
              </button>
            );
          })}
          {term && rows.length === 0 && <p className="px-3 py-2 text-gray-500">No matches.</p>}
        </div>
      )}
    </div>
  );
}
