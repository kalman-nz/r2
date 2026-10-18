import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { Item, Serial } from "../../lib/api";
import { useLocations } from "../../lib/catalog";
import { formatDate, parseDate } from "../../lib/format";
import { errorText } from "../../lib/errors";
import type { LabelUnit } from "../../lib/labelSpec";
import UnitBulkBar from "./UnitBulkBar";
import { SerialStatusBadge } from "../StatusBadge";
import { useToast } from "../ToastProvider";
import { withOrg } from "../../lib/currentOrg";

export default function SerialsSection({ item, categoryPath, canAdd }: { item: Item; categoryPath: string; canAdd: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: locations = [] } = useLocations();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const queryKey = ["serials", item.id];

  const { data: serials = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item.id }), sort: "barcode" }),
  });
  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);

  function unitFor(serial: Serial): LabelUnit {
    return { serial, item, categoryPath, locationName: locationName.get(serial.location) ?? "", currentJob: "" };
  }

  async function add() {
    const code = barcode.trim();
    setSaving(true);
    try {
      await pb.collection("serials").create(
        withOrg({
          item: item.id,
          barcode: code,
          serialNumber: serialNumber.trim(),
          label: label.trim(),
          status: "active",
          location: locations.length === 1 ? locations[0].id : "",
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["availability"] }),
      ]);
      // Ready for the next unit.
      setBarcode("");
      setSerialNumber("");
      setLabel("");
      showToast("success", "Unit added");
    } catch (err) {
      showToast("error", `Couldn't add the unit: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const selectedSerials = serials.filter((s) => selected.has(s.id));
  const now = Date.now();
  const active = serials.filter((s) => s.status === "active").length;

  return (
    <section className="card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-500">
          Units ({active} active{serials.length !== active ? ` of ${serials.length}` : ""})
        </h2>
        {canAdd && !adding && (
          <button
            onClick={() => {
              setAdding(true);
              setBarcode("");
            }}
            className="btn-secondary py-1"
          >
            Add unit
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-end gap-2 px-4 pb-3 flex-wrap"
        >
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Barcode / asset tag
            <input
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Blank = generate"
              className="input py-1.5 font-mono w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Manufacturer serial
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="input py-1.5 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Name (optional)
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="input py-1.5 w-32" placeholder="e.g. Desk 2" />
          </label>
          <button type="submit" disabled={saving} className="btn-primary py-1.5">
            {saving ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="btn-secondary py-1.5">
            Done
          </button>
        </form>
      )}

      {selectedSerials.length > 0 && (
        <div className="px-4 pb-2">
          <UnitBulkBar
            item={item}
            units={selectedSerials}
            unitFor={unitFor}
            onClear={() => setSelected(new Set())}
            setSelected={setSelected}
            onChanged={() =>
              Promise.all([
                queryClient.invalidateQueries({ queryKey: ["serials"] }),
                queryClient.invalidateQueries({ queryKey: ["availability"] }),
                queryClient.invalidateQueries({ queryKey: ["repairs"] }),
                queryClient.invalidateQueries({ queryKey: ["item"] }),
              ])
            }
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-y border-gray-200 text-left text-gray-500">
              <th className="px-4 py-2 w-8">
                {serials.length > 0 && (
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === serials.length}
                    onChange={() => setSelected((prev) => (prev.size === serials.length ? new Set() : new Set(serials.map((s) => s.id))))}
                  />
                )}
              </th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium hidden sm:table-cell">Location</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Test & tag due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {serials.map((s) => {
              const overdue = (parseDate(s.nextInspection)?.getTime() ?? Infinity) < now;
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/assets/${s.id}`} className="flex flex-col min-w-0 hover:underline w-fit">
                      <span className="font-medium text-gray-900 font-mono">{s.barcode || "(no barcode)"}</span>
                      {(s.label || s.serialNumber) && (
                        <span className="text-gray-400 text-xs">{[s.label, s.serialNumber].filter(Boolean).join(" · ")}</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden sm:table-cell">{locationName.get(s.location) ?? "—"}</td>
                  <td className="px-3 py-2">
                    <SerialStatusBadge status={s.status} />
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${overdue ? "text-fault-ink font-medium" : "text-gray-600"}`}>
                    {s.nextInspection ? formatDate(s.nextInspection) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!isLoading && serials.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">No units yet. Each unit gets its own barcode to scan.</p>
        )}
      </div>
    </section>
  );
}
