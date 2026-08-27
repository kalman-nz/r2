import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Equipment } from "../lib/api";
import RefreshButton from "../components/RefreshButton";
import { findDuplicateGroups, type DuplicateGroup, type DuplicateReason } from "../lib/duplicateDetection";

type Tab = "duplicates" | "price" | "info";

const REASON_LABEL: Record<DuplicateReason, string> = {
  "same-code": "Same code",
  "same-name": "Same name",
  "similar-name": "Similar name",
};

const REASON_STYLE: Record<DuplicateReason, string> = {
  "same-code": "bg-red-950 text-red-300 border-red-900",
  "same-name": "bg-amber-950 text-amber-300 border-amber-900",
  "similar-name": "bg-neutral-800 text-neutral-400 border-neutral-700",
};

// rental_sales isn't a plain boolean in Rentman — it's a free-text-ish
// select (e.g. "rental", "sale", "rental,sale"). An item that's sale-only
// legitimately has no hire price, so this is a loose heuristic to keep
// those out of the "missing price" list rather than a strict enum check.
function isSaleOnly(item: Equipment): boolean {
  const v = String(item.rental_sales ?? "").toLowerCase();
  return v.includes("sale") && !v.includes("rent");
}

function missingPrice(item: Equipment): boolean {
  return !isSaleOnly(item) && !(item.price > 0);
}

interface InfoCheck {
  key: string;
  label: string;
  defaultOn: boolean;
  test: (item: Equipment) => boolean;
}

const INFO_CHECKS: InfoCheck[] = [
  { key: "name", label: "Name", defaultOn: true, test: (i) => !(i.displayname || i.name) },
  { key: "code", label: "Code", defaultOn: true, test: (i) => !i.code },
  { key: "category", label: "Category", defaultOn: true, test: (i) => !i.folder },
  { key: "location", label: "Warehouse location", defaultOn: false, test: (i) => !i.location_in_warehouse },
  { key: "image", label: "Image", defaultOn: false, test: (i) => !i.image },
];

// Plain number, not a currency string — Rentman's own currency isn't
// exposed to this app, so guessing a symbol would likely be wrong.
function formatPrice(price: number | null | undefined): string {
  if (price == null || price <= 0) return "—";
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="border border-neutral-800 rounded-lg px-4 py-3 flex-1 min-w-[140px]">
      <div className={`text-2xl font-semibold ${tone === "warn" && value > 0 ? "text-amber-400" : ""}`}>{value}</div>
      <div className="text-neutral-500 text-xs mt-0.5">{label}</div>
    </div>
  );
}

function EquipmentRow({ item, trailing }: { item: Equipment; trailing?: React.ReactNode }) {
  return (
    <Link
      to={`/equipment/${item.id}`}
      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-900 text-sm"
    >
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate">{item.displayname ?? item.name}</span>
        <span className="text-neutral-500 text-xs truncate">
          {item.code || "no code"}
          {item.location_in_warehouse ? ` · ${item.location_in_warehouse}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">{trailing}</div>
    </Link>
  );
}

export default function InventoryAuditPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["equipment"],
    queryFn: api.listEquipment,
    refetchInterval: 5 * 60_000,
  });
  const items = useMemo(() => data?.data ?? [], [data]);

  const [tab, setTab] = useState<Tab>("duplicates");
  const [search, setSearch] = useState("");
  const [enabledChecks, setEnabledChecks] = useState<Set<string>>(
    () => new Set(INFO_CHECKS.filter((c) => c.defaultOn).map((c) => c.key)),
  );

  const duplicateGroups = useMemo(() => findDuplicateGroups(items), [items]);
  const priceIssues = useMemo(() => items.filter(missingPrice), [items]);
  const activeChecks = useMemo(() => INFO_CHECKS.filter((c) => enabledChecks.has(c.key)), [enabledChecks]);
  const infoIssues = useMemo(() => {
    return items
      .map((item) => ({ item, failed: activeChecks.filter((c) => c.test(item)) }))
      .filter((row) => row.failed.length > 0);
  }, [items, activeChecks]);

  const term = search.trim().toLowerCase();
  const matchesSearch = useCallback(
    (item: Equipment) => !term || JSON.stringify(item).toLowerCase().includes(term),
    [term],
  );

  const filteredGroups = useMemo(
    () =>
      term
        ? duplicateGroups
            .map((g) => ({ ...g, items: g.items.filter(matchesSearch) }))
            .filter((g) => g.items.length > 1)
        : duplicateGroups,
    [duplicateGroups, term, matchesSearch],
  );
  const filteredPriceIssues = useMemo(
    () => priceIssues.filter(matchesSearch),
    [priceIssues, matchesSearch],
  );
  const filteredInfoIssues = useMemo(
    () => infoIssues.filter((row) => matchesSearch(row.item)),
    [infoIssues, matchesSearch],
  );

  const duplicateItemCount = duplicateGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory audit</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            Find duplicate equipment entries and missing catalog info before it goes live.
          </p>
        </div>
        <RefreshButton queryKeys={[["equipment"]]} />
      </div>

      {isLoading && <p className="text-neutral-500 text-sm">Loading…</p>}
      {error && <p className="text-red-400 text-sm">Couldn't load equipment: {(error as Error).message}</p>}

      {!isLoading && !error && (
        <>
          <div className="flex flex-wrap gap-3">
            <StatCard label="Equipment types" value={items.length} />
            <StatCard label="Duplicate groups" value={duplicateGroups.length} tone="warn" />
            <StatCard label="Missing hire price" value={priceIssues.length} tone="warn" />
            <StatCard label="Missing info" value={infoIssues.length} tone="warn" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1">
              {(
                [
                  ["duplicates", `Duplicates (${duplicateGroups.length})`],
                  ["price", `Missing price (${priceIssues.length})`],
                  ["info", `Missing info (${infoIssues.length})`],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                    tab === key
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="bg-neutral-900 border border-neutral-800 rounded-md px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-neutral-600"
            />
          </div>

          {tab === "duplicates" && (
            <div className="flex flex-col gap-3">
              <p className="text-neutral-500 text-xs">
                Grouped by matching code, matching name, or names that share most of their words. Same-code matches
                are the strongest signal — equipment codes are meant to be unique.
              </p>
              {filteredGroups.length === 0 && (
                <p className="border border-neutral-800 rounded-lg px-4 py-6 text-neutral-500 text-sm text-center">
                  {duplicateGroups.length === 0 ? "No likely duplicates found." : "No duplicates match your filter."}
                </p>
              )}
              {filteredGroups.map((group: DuplicateGroup) => (
                <div key={group.key} className="border border-neutral-800 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-neutral-950 border-b border-neutral-800">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${REASON_STYLE[group.reason]}`}
                    >
                      {REASON_LABEL[group.reason]}
                    </span>
                    <span className="text-neutral-500 text-xs">{group.items.length} items</span>
                  </div>
                  <div className="divide-y divide-neutral-800">
                    {group.items.map((item) => (
                      <EquipmentRow
                        key={item.id}
                        item={item}
                        trailing={
                          <>
                            <span className="text-neutral-400 text-xs bg-neutral-900 border border-neutral-800 rounded-full px-2 py-0.5">
                              {item.current_quantity ?? 0} in stock
                            </span>
                            <span className="text-neutral-400 text-xs bg-neutral-900 border border-neutral-800 rounded-full px-2 py-0.5">
                              {formatPrice(item.price)}
                            </span>
                          </>
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
              {duplicateItemCount > 0 && (
                <p className="text-neutral-600 text-xs">{duplicateItemCount} equipment types flagged in total.</p>
              )}
            </div>
          )}

          {tab === "price" && (
            <div className="border border-neutral-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-neutral-950 border-b border-neutral-800 text-neutral-500 text-xs">
                Rentman's <code className="text-neutral-400">price</code> field is empty or zero. Items that look
                sale-only (based on the rental/sales field) are skipped.
              </div>
              <div className="divide-y divide-neutral-800">
                {filteredPriceIssues.map((item) => (
                  <EquipmentRow
                    key={item.id}
                    item={item}
                    trailing={
                      <span className="text-red-400 text-xs bg-red-950 border border-red-900 rounded-full px-2 py-0.5">
                        no price
                      </span>
                    }
                  />
                ))}
                {filteredPriceIssues.length === 0 && (
                  <p className="px-4 py-6 text-neutral-500 text-sm text-center">
                    {priceIssues.length === 0 ? "Every rentable item has a hire price." : "Nothing matches your filter."}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "info" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3 text-sm">
                {INFO_CHECKS.map((check) => (
                  <label key={check.key} className="flex items-center gap-1.5 text-neutral-400">
                    <input
                      type="checkbox"
                      checked={enabledChecks.has(check.key)}
                      onChange={() =>
                        setEnabledChecks((prev) => {
                          const next = new Set(prev);
                          if (next.has(check.key)) next.delete(check.key);
                          else next.add(check.key);
                          return next;
                        })
                      }
                    />
                    {check.label}
                  </label>
                ))}
              </div>
              <div className="border border-neutral-800 rounded-lg overflow-hidden divide-y divide-neutral-800">
                {filteredInfoIssues.map(({ item, failed }) => (
                  <EquipmentRow
                    key={item.id}
                    item={item}
                    trailing={
                      <div className="flex gap-1">
                        {failed.map((c) => (
                          <span
                            key={c.key}
                            className="text-amber-400 text-xs bg-amber-950 border border-amber-900 rounded-full px-2 py-0.5"
                          >
                            no {c.label.toLowerCase()}
                          </span>
                        ))}
                      </div>
                    }
                  />
                ))}
                {filteredInfoIssues.length === 0 && (
                  <p className="px-4 py-6 text-neutral-500 text-sm text-center">
                    {activeChecks.length === 0
                      ? "Select at least one check above."
                      : infoIssues.length === 0
                        ? "Nothing missing for the selected checks."
                        : "Nothing matches your filter."}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
