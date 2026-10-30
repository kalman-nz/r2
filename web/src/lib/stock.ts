import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { ItemStock, Serial } from "./api";
import { orgFilter } from "./currentOrg";

// Where stock is kept (pb_hooks/lib/stock.js): a bulk item's quantity at
// each stock location, and serialised units' own locations. Keys sit under
// ["item_stock"] and ["serials"], so changing either refreshes these.

export interface Place {
  location: string;
  bin: string;
  qty: number;
}

export function useItemStock(itemId: string, enabled = true) {
  return useQuery({
    queryKey: ["item_stock", itemId],
    queryFn: () => pb.collection("item_stock").getFullList<ItemStock>({ filter: pb.filter("item = {:item}", { item: itemId }), sort: "created" }),
    enabled: enabled && !!itemId,
  });
}

// Every item's places, for the inventory list: item id → places.
export function useStockPlaces() {
  const stock = useQuery({
    queryKey: ["item_stock", "all"],
    queryFn: () => pb.collection("item_stock").getFullList<ItemStock>({ filter: orgFilter("qty > 0"), fields: "item,location,bin,qty" }),
  });
  const units = useQuery({
    queryKey: ["serials", "places"],
    queryFn: () =>
      pb.collection("serials").getFullList<Pick<Serial, "item" | "location" | "bin">>({ filter: orgFilter('status = "active"'), fields: "item,location,bin" }),
  });
  const places = useMemo(() => {
    const out = new Map<string, Place[]>();
    const add = (item: string, place: Place) => {
      const list = out.get(item) ?? [];
      const same = list.find((p) => p.location === place.location && p.bin === place.bin);
      if (same) same.qty += place.qty;
      else list.push({ ...place });
      out.set(item, list);
    };
    for (const r of stock.data ?? []) add(r.item, { location: r.location, bin: r.bin, qty: r.qty });
    for (const u of units.data ?? []) add(u.item, { location: u.location, bin: u.bin, qty: 1 });
    return out;
  }, [stock.data, units.data]);
  return places;
}

// Units' places for one serialised item.
export function unitPlaces(units: Pick<Serial, "location" | "bin" | "status">[]): Place[] {
  const out: Place[] = [];
  for (const u of units) {
    if (u.status !== "active") continue;
    const same = out.find((p) => p.location === u.location && p.bin === u.bin);
    if (same) same.qty += 1;
    else out.push({ location: u.location, bin: u.bin, qty: 1 });
  }
  return out;
}

// "Main store, Bay 3" when it's all in one place, otherwise each place
// with how many: "Main store, Bay 3 ×3 · Theatre ×5". The same words as
// packing lists (lib/stock.js placesOf).
export function placesText(places: Place[], locationName: (id: string) => string): string {
  const parts = places.filter((p) => p.qty > 0).map((p) => ({ text: [locationName(p.location), p.bin].filter(Boolean).join(", "), qty: p.qty }));
  // By name, like the lists of locations (and the server's packing lists).
  const shown = parts.filter((p) => p.text).sort((a, b) => a.text.localeCompare(b.text));
  if (shown.length === 0) return "";
  if (shown.length === 1) return shown[0].text;
  return shown.map((p) => `${p.text} ×${p.qty}`).join(" · ");
}
