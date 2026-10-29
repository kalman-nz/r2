import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type Item, type Repair, type Serial } from "../../lib/api";
import { orgFilter } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { fromDateInput } from "../../lib/format";
import { today, useRepairStatuses } from "../../lib/maintenance";
import Modal from "../Modal";
import NumberInput from "../NumberInput";
import ProjectPicker, { type ProjectRef } from "../ProjectPicker";
import { useFeature } from "../../lib/roles";
import { useToast } from "../ToastProvider";
import AssigneeInput from "./AssigneeInput";
import { useLocations } from "../../lib/catalog";

const SHOWN = 8;

// Opening a repair: pick the item (or arrive with it, and its units, from
// the units tab or a scan), then which units or how many, and what's
// wrong. Saving takes them out of service straight away. The project it
// came back damaged from, and photos of the damage, can go on it now too.
// With a start date in the future (and maintenance on), it's booked in as
// a one-off maintenance job for that day instead, and the kit stays in
// service until then.
export default function NewRepairModal({
  item: givenItem,
  itemId,
  serials: givenSerials = [],
  quantity: givenQuantity = 1,
  job: givenJob = null,
  onClose,
  onCreated,
}: {
  item?: Item;
  // Just the id, from a scan: the item's loaded here.
  itemId?: string;
  serials?: string[];
  quantity?: number;
  job?: ProjectRef | null;
  onClose: () => void;
  onCreated: (repair: Repair) => void;
}) {
  const { showToast } = useToast();
  const [item, setItem] = useState<Item | null>(givenItem ?? null);
  const { data: scannedItem } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => pb.collection("items").getOne<Item>(itemId!),
    enabled: !givenItem && !!itemId,
  });
  useEffect(() => {
    if (scannedItem && !item) setItem(scannedItem);
  }, [scannedItem, item]);
  const fixedItem = !!givenItem || !!itemId;
  const [job, setJob] = useState<ProjectRef | null>(givenJob);
  // The project it was damaged on, while the organisation uses projects.
  const feature = useFeature();
  const projectsOn = feature("projects");
  const [startOn, setStartOn] = useState("");
  const later = feature("maintenance") && startOn > today();
  const [files, setFiles] = useState<File[]>([]);
  const filesInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(givenSerials));
  const [quantity, setQuantity] = useState(givenQuantity);
  const [fault, setFault] = useState("");
  const [repairer, setRepairer] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");
  // Where it starts: one of the organisation's out-of-service statuses.
  const { statuses, defaultId } = useRepairStatuses();
  const startable = statuses.filter((st) => st.stage === "open");
  const [status, setStatus] = useState("");
  const startIn = status || defaultId;

  const { data: items = [] } = useQuery({
    queryKey: ["items"],
    queryFn: () => pb.collection("items").getFullList<Item>({ filter: orgFilter(), sort: "name" }),
    enabled: !fixedItem,
  });
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return items
      .filter((i) => i.kind === "item" && !i.archived && [i.name, i.code, i.barcode].some((v) => v.toLowerCase().includes(term)))
      .slice(0, SHOWN);
  }, [items, search]);

  const serialised = item?.tracking === "serial";
  const { data: units = [] } = useQuery({
    queryKey: ["serials", item?.id],
    queryFn: () => pb.collection("serials").getFullList<Serial>({ filter: pb.filter("item = {:item}", { item: item!.id }), sort: "barcode" }),
    enabled: !!item && serialised,
  });
  const { data: locations = [] } = useLocations();
  const locationName = useCallback((id: string) => locations.find((l) => l.id === id)?.name ?? "", [locations]);
  // Lost and retired units aren't in service to begin with.
  const repairable = units.filter((u) => u.status === "active" || picked.has(u.id));
  // Barcode, name or serial number; ticked ones stay at the top.
  const shownUnits = useMemo(() => {
    const term = unitSearch.trim().toLowerCase();
    const matches = term
      ? repairable.filter((u) => [u.barcode, u.label, u.serialNumber, locationName(u.location)].some((v) => v.toLowerCase().includes(term)))
      : repairable;
    return [...matches].sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)));
  }, [repairable, unitSearch, picked, locationName]);
  const toggle = (id: string, on?: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  // Enter (a scanner sends one) ticks the unit with that exact barcode, or
  // the only match, and clears the box for the next.
  function pickTyped() {
    const term = unitSearch.trim().toLowerCase();
    if (!term) return;
    const exact = repairable.find((u) => u.barcode.toLowerCase() === term);
    const only = shownUnits.length === 1 ? shownUnits[0] : null;
    const unit = exact ?? only;
    if (!unit) return;
    toggle(unit.id, true);
    setUnitSearch("");
  }
  const inService = item && !serialised ? item.stockQty - item.outOfServiceQty : 0;

  const ready = !!item && fault.trim() !== "" && (serialised ? picked.size > 0 : quantity >= 1 && quantity <= inService);

  async function save() {
    if (!item) return;
    setSaving(true);
    if (later) {
      try {
        const jobs = await api.scheduleJobs({
          name: fault.trim().split("\n")[0].slice(0, 120),
          kind: "service",
          dueOn: startOn,
          notes: [fault.trim(), repairer.trim() && `Assigned to ${repairer.trim()}`].filter(Boolean).join("\n\n"),
          item: item.id,
          serials: serialised ? [...picked] : [],
        });
        showToast("success", `Repair booked in for ${startOn.split("-").reverse().join("/")}${jobs.length > 1 ? ` (${jobs.length} jobs)` : ""}`);
        onClose();
      } catch (err) {
        showToast("error", `Couldn't schedule the repair: ${errorText(err)}`);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      let repair = await api.openRepair({
        item: item.id,
        ...(serialised ? { serials: [...picked] } : { quantity }),
        fault: fault.trim(),
        repairer: repairer.trim(),
        dueAt: fromDateInput(dueAt),
        job: job?.id ?? "",
        ...(startIn ? { status: startIn } : {}),
      });
      // The repair's open either way; a file that won't go just says so.
      for (const file of files) {
        try {
          repair = await api.uploadRepairFile(repair.id, file);
        } catch (err) {
          showToast("error", `Couldn't add ${file.name}: ${errorText(err)}`);
        }
      }
      onCreated(repair);
    } catch (err) {
      showToast("error", `Couldn't open the repair: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Create repair" onClose={saving ? () => {} : onClose}>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Item</span>
        {item ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-gray-900">
              {item.code && <span className="font-mono text-gray-400 mr-1.5">{item.code}</span>}
              {item.name}
            </span>
            {!fixedItem && (
              <button
                onClick={() => {
                  setItem(null);
                  setPicked(new Set());
                }}
                className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover"
              >
                Change
              </button>
            )}
          </div>
        ) : fixedItem ? (
          <span className="text-gray-500">Loading…</span>
        ) : (
          <>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code or barcode…"
              className="input py-1.5"
            />
            {matches.length > 0 && (
              <div className="flex flex-col border border-gray-200 rounded-md divide-y divide-gray-100">
                {matches.map((i) => (
                  <button key={i.id} onClick={() => setItem(i)} className="text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2">
                    {i.code && <span className="font-mono text-xs text-gray-400">{i.code}</span>}
                    <span className="truncate">{i.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {item && serialised && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">
              Units{picked.size > 0 && <span className="text-gray-900 font-medium"> · {picked.size} picked</span>}
            </span>
            {picked.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-gray-500 hover:text-gray-900">
                Clear
              </button>
            )}
          </div>
          {repairable.length === 0 ? (
            <p className="text-gray-500">No units in service.</p>
          ) : (
            <>
              {repairable.length > 1 && (
                <input
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      pickTyped();
                    }
                  }}
                  placeholder={`Search or scan ${repairable.length} units: barcode, name, serial…`}
                  className="input py-1.5"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            <div className="flex flex-col max-h-56 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {shownUnits.length === 0 && <p className="px-3 py-2 text-gray-500">No units match.</p>}
              {shownUnits.map((u) => (
                <label key={u.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
                  <span className="flex flex-col min-w-0">
                    <span className="text-gray-900 truncate">{u.label || u.barcode || "(no barcode)"}</span>
                    <span className="text-xs text-gray-500 truncate">
                      {[u.label && u.barcode, u.serialNumber && `S/N ${u.serialNumber}`, locationName(u.location)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {unitSearch.trim() && shownUnits.some((u) => !picked.has(u.id)) && (
              <button type="button" onClick={() => shownUnits.forEach((u) => toggle(u.id, true))} className="self-start text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
                Pick all {shownUnits.length} shown
              </button>
            )}
            </>
          )}
        </div>
      )}

      {item && !serialised && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">How many ({inService} in service)</span>
          <NumberInput value={quantity} min={1} max={inService} onChange={(n) => setQuantity(Math.round(n))} className="input py-1.5 w-24" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">What's wrong</span>
        <textarea
          value={fault}
          onChange={(e) => setFault(e.target.value)}
          rows={3}
          className="input py-1.5"
          placeholder="e.g. Crackles when the cable moves"
        />
      </label>
      {!later && startable.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Status</span>
          <select value={startIn} onChange={(e) => setStatus(e.target.value)} className="input py-1.5 w-auto">
            {startable.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!later && projectsOn && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Came back damaged from (optional)</span>
          <ProjectPicker value={job} onChange={setJob} />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {feature("maintenance") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-500">Start on (optional)</span>
            <input type="date" value={startOn} min={today()} onChange={(e) => setStartOn(e.target.value)} className="input py-1.5" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-500">Assigned to (optional)</span>
          <AssigneeInput value={repairer} onChange={setRepairer} />
        </label>
        {!later && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-500">Expected back (optional)</span>
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input py-1.5" />
          </label>
        )}
      </div>

      {!later && (
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">Files (optional)</span>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => filesInput.current?.click()} className="btn-secondary py-1">
            {files.length > 0 ? "Add more" : "Add photos or files"}
          </button>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700 max-w-48">
              <span className="truncate">{f.name}</span>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="w-4 h-4 rounded-full hover:bg-gray-300 leading-none" aria-label={`Remove ${f.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          ref={filesInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            setFiles((prev) => [...prev, ...chosen]);
            e.target.value = "";
          }}
        />
      </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!ready || saving} className="btn-primary">
          {saving ? (later ? "Scheduling…" : "Creating…") : later ? "Schedule repair" : "Create repair"}
        </button>
        <button onClick={onClose} disabled={saving} className="btn-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
