import { useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, type JobLineView, type JobSummary, type LinePatch, type NewLine, type PriceMode, type TrackingStep } from "../../lib/api";
import { formatPeriod, nzd, MODE_SUFFIX } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { InlineNumber, InlineText } from "../InlineInput";
import ItemPicker from "../ItemPicker";
import Modal from "../Modal";
import Field from "../Field";
import NumberInput from "../NumberInput";
import { TrackingStatus } from "../StatusBadge";
import { useOrg } from "../../lib/org";
import { linesProgress, progressOf, useTrackingSteps } from "../../lib/tracking";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";
import NewSubprojectModal from "./NewSubprojectModal";
import { DragHandle } from "../DragReorder";
import SelectionBar from "../SelectionBar";

// Done jobs don't hold stock, so availability isn't worked out for them.
function AvailabilityCell({ line, jobDone }: { line: JobLineView; jobDone: boolean }) {
  if (line.lineType === "custom" || jobDone) return <span className="text-gray-300">—</span>;
  if (line.item?.kind === "kit") {
    return line.componentsShort ? (
      <span className="text-fault-ink font-medium" title="One or more of this kit's contents is short — see the lines below">
        Contents short
      </span>
    ) : (
      <span className="text-gray-400">See contents</span>
    );
  }
  const a = line.availability;
  if (!a) return <span className="text-gray-300">—</span>;
  if (a.short > 0) {
    const title =
      a.shortFirm < a.short
        ? `${a.free} free for these dates. ${a.shortFirm === 0 ? "Fine" : `Short ${a.shortFirm}`} if pencilled holds on other projects are released.`
        : `${a.free} free for these dates.`;
    return (
      <span className="inline-flex flex-col leading-tight" title={title}>
        <span className="inline-flex items-center gap-1.5 text-fault-ink font-medium">
          <span className="status-dot bg-fault" />
          Short {a.short}
        </span>
        {a.shortFirm < a.short && (
          <span className="text-[11px] text-amber-600 pl-3">{a.shortFirm === 0 ? "only pencilled clashes" : `${a.shortFirm} if pencils drop`}</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600" title={`${a.free} free for these dates, ${a.needed} on this project`}>
      <span className="status-dot bg-lock" />
      {a.free - a.needed} spare
    </span>
  );
}

// Without prices.view the line goes on unpriced (someone who can see prices
// sets it later).
function CustomLineModal({
  groups,
  initialGroup = "",
  showPrices,
  onAdd,
  onClose,
}: {
  groups: string[];
  initialGroup?: string;
  showPrices: boolean;
  onAdd: (line: NewLine) => Promise<void>;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [priceMode, setPriceMode] = useState<PriceMode>("fixed");
  const [group, setGroup] = useState(initialGroup);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onAdd(showPrices ? { description, quantity, unitPrice, priceMode, group } : { description, quantity, group });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a custom line" onClose={onClose}>
      <Field label="Description">
        <input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} className="input py-2" placeholder="e.g. Delivery & collection" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity">
          <NumberInput value={quantity} min={0} onChange={setQuantity} className="input py-2" />
        </Field>
        {showPrices && (
          <>
            <Field label="Price (ex GST)">
              <input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(Number(e.target.value))}
                className="input py-2"
              />
            </Field>
            <Field label="Charged">
              <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)} className="input py-2">
                <option value="fixed">Once (each)</option>
                <option value="per_hour">Per hour</option>
                <option value="per_day">Per day</option>
                <option value="per_week">Per week</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Quote heading">
          <input value={group} onChange={(e) => setGroup(e.target.value)} list="job-groups" className="input py-2" placeholder="e.g. Services" />
          <datalist id="job-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button onClick={save} disabled={saving || !description.trim() || quantity <= 0} className="btn-primary">
          {saving ? "Adding…" : "Add line"}
        </button>
      </div>
    </Modal>
  );
}

// A part of the project for the equipment list: the main project ("") or
// a subproject, with the window its kit is booked over.
interface Section {
  id: string;
  name: string;
  prepAt: string;
  returnAt: string;
  days?: number;
  subtotal?: number;
}


// Dragging lines and headings into order. Each row says what it is, so
// hovering it works out where the dragged thing would land: a line before
// another line (in any heading or part of the project), or a heading before
// another heading in its part. An orange line shows where, as in
// components/DragReorder.tsx; nothing moves until it's dropped.
type RowDesc =
  | { type: "heading"; section: string; group: string }
  | { type: "line"; section: string; group: string; line: JobLineView }
  | { type: "child"; section: string; group: string; parent: string }
  | { type: "empty"; section: string; group: string };

type Dragging = { kind: "line"; line: JobLineView } | { kind: "heading"; section: string; name: string };
type Drop = { kind: "line"; section: string; group: string; before: string | null } | { kind: "heading"; section: string; before: string | null };

const headingKey = (section: string, group: string) => `h:${section}:${group}`;
const emptyKey = (section: string, group: string) => `e:${section}:${group}`;
const LINE_ABOVE = "[&>td]:shadow-[inset_0_2px_0_var(--color-signal)]";
const LINE_BELOW = "[&>td]:shadow-[inset_0_-2px_0_var(--color-signal)]";

export interface Dnd {
  row: (desc: RowDesc) => {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  cls: (key: string, parent?: string) => string;
  handle: (key: string) => { onMouseDown: () => void; onMouseUp: () => void };
}

export default function JobLines({
  summary,
  canEdit,
  onSummary,
}: {
  summary: JobSummary;
  canEdit: boolean;
  onSummary: (summary: JobSummary) => void;
}) {
  // Where new lines go: a section ("" for the main project) and, from a
  // heading's own button, that heading; null when not adding.
  const [picking, setPicking] = useState<{ section: string; group?: string } | null>(null);
  const [addingCustom, setAddingCustom] = useState<{ section: string; group?: string } | null>(null);
  // The section a new heading is being typed into.
  const [addingHeading, setAddingHeading] = useState<string | null>(null);
  const [headingName, setHeadingName] = useState("");
  const [addingSubproject, setAddingSubproject] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { job, lines, subprojects = [] } = summary;
  const jobDone = job.status === "returned" || job.status === "cancelled";
  const showPrices = summary.includesPrices;
  // Where each bit of kit is (equipment tracking), once something on the
  // project's been scanned: a project nobody scans isn't tracked.
  const { feature } = useOrg();
  const { steps: trackingSteps } = useTrackingSteps();
  const steps = feature("scanning") && trackingSteps.length > 0 && summary.packing.scanCount > 0 ? trackingSteps : null;

  const sections: Section[] = [
    {
      id: "",
      name: "Main project",
      prepAt: job.prepAt,
      returnAt: job.returnAt,
      days: summary.pricing?.days,
      subtotal: lines.filter((l) => !l.subproject).reduce((sum, l) => sum + (l.amount?.net ?? 0), 0),
    },
    ...subprojects,
  ];
  const sectionById = (id: string) => sections.find((s) => s.id === id) ?? sections[0];

  async function run(action: () => Promise<JobSummary>, failure: string) {
    try {
      onSummary(await action());
    } catch (err) {
      showToast("error", `${failure}: ${errorText(err)}`);
    }
  }

  const patch = (line: JobLineView, p: LinePatch) => run(() => api.updateLine(line.id, p), "Couldn't save");

  async function remove(line: JobLineView) {
    const children = lines.filter((l) => l.parentLine === line.id).length;
    if (children > 0) {
      const ok = await confirm({
        title: "Remove line",
        message: `Remove ${line.name} and the ${children} line${children === 1 ? "" : "s"} added with it?`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.deleteLine(line.id), "Couldn't remove");
  }

  async function addItem(itemId: string, quantity: number) {
    onSummary(
      await api.addLine(job.id, { itemId, quantity, subproject: picking?.section ?? "", ...(picking?.group !== undefined ? { group: picking.group } : {}) }),
    );
  }

  async function addCustom(line: NewLine) {
    try {
      onSummary(await api.addLine(job.id, { ...line, subproject: addingCustom?.section ?? "" }));
    } catch (err) {
      showToast("error", `Couldn't add: ${errorText(err)}`);
      throw err;
    }
  }

  // Headings: renaming takes their lines with them; removing one leaves its
  // lines under no heading (pb_hooks/lib/jobs.js headingAction).
  const heading = (body: Parameters<typeof api.headingAction>[1], failure: string) => run(() => api.headingAction(job.id, body), failure);
  const renameGroup = (section: string, from: string, to: string) =>
    to && to !== from ? heading({ action: "rename", section, name: from, to }, "Couldn't rename") : undefined;
  async function removeGroup(section: string, name: string, count: number) {
    if (count > 0) {
      const ok = await confirm({
        title: "Remove heading",
        message: `Remove the "${name}" heading? Its ${count} line${count === 1 ? "" : "s"} stay on the project, under no heading.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
    }
    await heading({ action: "remove", section, name }, "Couldn't remove");
  }
  async function addHeading(section: string) {
    const name = headingName.trim();
    if (!name) return;
    await heading({ action: "add", section, name }, "Couldn't add the heading");
    setHeadingName("");
    setAddingHeading(null);
  }

  // A section's headings in order: lines with no heading, then the listed
  // headings (even empty ones), then any others its lines use.
  function sectionGroups(section: string, own: JobLineView[]) {
    const byName = new Map(groupsOf(own).map((g) => [g.name, g.lines]));
    const names = [
      ...(byName.has("") ? [""] : []),
      ...(job.headings ?? []).filter((h) => h.section === section).map((h) => h.name),
      ...[...byName.keys()].filter((n) => n !== ""),
    ];
    return [...new Set(names)].map((name) => ({ name, lines: byName.get(name) ?? [] }));
  }

  // ---- Ticked lines (top-level only; a kit's contents go with it), in order.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const picked = lines.filter((l) => !l.parentLine && selected.has(l.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const topLines = lines.filter((l) => !l.parentLine);
  const allPicked = topLines.length > 0 && picked.length === topLines.length;
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- Drag and drop
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const sectionOf = (l: JobLineView) => l.subproject || "";
  // Top-level lines of a heading, in order, leaving out the one being dragged.
  const siblingsOf = (section: string, group: string, except?: string) =>
    lines.filter((l) => !l.parentLine && sectionOf(l) === section && l.group === group && l.id !== except);
  const namedHeadings = (section: string) =>
    sectionGroups(section, lines.filter((l) => sectionOf(l) === section))
      .map((g) => g.name)
      .filter(Boolean);
  const nextHeading = (section: string, group: string) => {
    const names = namedHeadings(section);
    return group === "" ? (names[0] ?? null) : (names[names.indexOf(group) + 1] ?? null);
  };

  // Dragging a ticked line takes every ticked line with it.
  const moving = dragging?.kind === "line" ? (selected.has(dragging.line.id) && picked.length > 1 ? picked : [dragging.line]) : [];
  const movingIds = new Set(moving.map((l) => l.id));

  // Where the dragged thing would land if dropped on this row, or null.
  function dropFor(desc: RowDesc, upper: boolean): Drop | null {
    if (!dragging) return null;
    if (dragging.kind === "line") {
      const self = dragging.line.id;
      const after = (id: string) => {
        const sibs = siblingsOf(desc.section, desc.group);
        const at = sibs.findIndex((l) => l.id === id);
        const next = sibs.slice(at + 1).find((l) => l.id !== self);
        return next ? next.id : null;
      };
      let before: string | null;
      if (desc.type === "heading") before = siblingsOf(desc.section, desc.group, self)[0]?.id ?? null;
      else if (desc.type === "line") before = upper ? (desc.line.id === self ? after(self) : desc.line.id) : after(desc.line.id);
      else if (desc.type === "child") before = after(desc.parent);
      else before = null;
      // Where it already is: nothing to do.
      if (moving.length === 1 && desc.section === sectionOf(dragging.line) && desc.group === dragging.line.group) {
        const sibs = siblingsOf(desc.section, desc.group);
        const now = sibs.findIndex((l) => l.id === self);
        const nextNow = sibs[now + 1]?.id ?? null;
        if (before === nextNow || before === self) return null;
      }
      return { kind: "line", section: desc.section, group: desc.group, before };
    }
    // A heading moves among its own part's headings.
    if (desc.section !== dragging.section) return null;
    let before: string | null;
    if (desc.type === "heading" && desc.group) before = upper ? desc.group : nextHeading(desc.section, desc.group);
    else before = nextHeading(desc.section, desc.group);
    if (before === dragging.name || before === nextHeading(dragging.section, dragging.name)) return null;
    return { kind: "heading", section: desc.section, before };
  }

  // Puts lines, in their order, before a line in a heading (or at its end).
  // Sort orders go between the new neighbours, or the heading's renumbered
  // when there's no room.
  async function dropLines(move: JobLineView[], section: string, group: string, before: string | null) {
    const ids = new Set(move.map((l) => l.id));
    const all = siblingsOf(section, group);
    if (before && ids.has(before)) before = all.slice(all.findIndex((l) => l.id === before) + 1).find((l) => !ids.has(l.id))?.id ?? null;
    const siblings = all.filter((l) => !ids.has(l.id));
    const at = before ? siblings.findIndex((l) => l.id === before) : siblings.length;
    const prev = siblings[at - 1];
    const next = siblings[at];
    const k = move.length;
    let orders: number[] | null;
    if (!prev && !next) orders = move.map((_, i) => (i + 1) * 10);
    else if (!prev) orders = move.map((_, i) => next.sortOrder - 10 * (k - i));
    else if (!next) orders = move.map((_, i) => prev.sortOrder + 10 * (i + 1));
    else {
      const gap = next.sortOrder - prev.sortOrder;
      orders = gap > k ? move.map((_, i) => prev.sortOrder + Math.floor((gap * (i + 1)) / (k + 1))) : null;
    }
    const moved = (l: JobLineView): LinePatch => ({
      ...(section !== sectionOf(l) ? { subproject: section } : {}),
      ...(group !== l.group ? { group } : {}),
    });
    await run(async () => {
      let last = summary;
      if (orders) {
        for (const [i, l] of move.entries()) last = await api.updateLine(l.id, { ...moved(l), sortOrder: orders[i] });
        return last;
      }
      const order = [...siblings];
      order.splice(at, 0, ...move);
      for (const [i, l] of order.entries()) {
        const want = (i + 1) * 10;
        if (ids.has(l.id)) last = await api.updateLine(l.id, { ...moved(l), sortOrder: want });
        else if (l.sortOrder !== want) last = await api.updateLine(l.id, { sortOrder: want });
      }
      return last;
    }, k > 1 ? "Couldn't move them" : "Couldn't move it");
  }

  // ---- What the selection bar does
  async function removePicked() {
    const kits = picked.filter((l) => lines.some((c) => c.parentLine === l.id)).length;
    const ok = await confirm({
      title: "Remove lines",
      message: `Remove ${picked.length} line${picked.length === 1 ? "" : "s"}${kits ? `, and what was added with ${kits === 1 ? "the kit" : "the kits"}` : ""}?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await run(async () => {
      let last = summary;
      for (const l of picked) last = await api.deleteLine(l.id);
      return last;
    }, "Couldn't remove them");
    setSelected(new Set());
    setBusy(false);
  }
  async function discountPicked() {
    const pct = Number(discount);
    if (discount.trim() === "" || !Number.isFinite(pct) || pct < 0 || pct > 100) return;
    setBusy(true);
    await run(async () => {
      let last = summary;
      for (const l of picked) if (l.lineType !== "component") last = await api.updateLine(l.id, { discountPct: pct });
      return last;
    }, "Couldn't set the discount");
    setDiscount("");
    setBusy(false);
  }
  async function movePicked(target: string) {
    const [section, group] = target.split("\u0000");
    setBusy(true);
    await dropLines(picked, section, group, null);
    setBusy(false);
  }

  async function dropHeading(section: string, name: string, before: string | null) {
    const names = namedHeadings(section);
    const from = names.indexOf(name);
    let to = before ? names.indexOf(before) : names.length;
    if (to > from) to -= 1;
    const steps = to - from;
    if (!steps) return;
    await run(async () => {
      let last = summary;
      for (let i = 0; i < Math.abs(steps); i++) last = await api.headingAction(job.id, { action: "move", section, name, direction: steps > 0 ? 1 : -1 });
      return last;
    }, "Couldn't reorder");
  }

  const endDrag = () => {
    setDragging(null);
    setDrop(null);
    setGrabbed(null);
  };

  // The row that shows the orange line: above the line or heading it goes
  // before, or below the last row of where it goes at the end.
  const lastRowOf = (section: string, group: string) => {
    const own = lines.filter((l) => sectionOf(l) === section && (l.parentLine ? lines.find((p) => p.id === l.parentLine)?.group : l.group) === group);
    return own.length > 0 ? own[own.length - 1].id : emptyKey(section, group);
  };
  let above: string | null = null;
  let below: string | null = null;
  if (drop?.kind === "line") {
    if (drop.before) above = drop.before;
    else below = lastRowOf(drop.section, drop.group);
  } else if (drop?.kind === "heading") {
    if (drop.before) above = headingKey(drop.section, drop.before);
    else {
      const names = namedHeadings(drop.section);
      below = lastRowOf(drop.section, names[names.length - 1] ?? "");
    }
  }

  const dnd: Dnd = {
    row: (desc) => {
      const key =
        desc.type === "line" ? desc.line.id : desc.type === "heading" ? headingKey(desc.section, desc.group) : "";
      return {
        draggable: !!key && grabbed === key,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", key);
          if (desc.type === "line") setDragging({ kind: "line", line: desc.line });
          else if (desc.type === "heading") setDragging({ kind: "heading", section: desc.section, name: desc.group });
        },
        onDragOver: (e) => {
          if (!dragging) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const next = dropFor(desc, e.clientY < rect.top + rect.height / 2);
          if (next) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
          if (JSON.stringify(next) !== JSON.stringify(drop)) setDrop(next);
        },
        onDrop: (e) => {
          e.preventDefault();
          const d = dragging;
          const target = drop;
          endDrag();
          if (!d || !target) return;
          if (d.kind === "line" && target.kind === "line") dropLines(moving, target.section, target.group, target.before);
          if (d.kind === "heading" && target.kind === "heading") dropHeading(d.section, d.name, target.before);
        },
        onDragEnd: endDrag,
      };
    },
    cls: (key, parent) => {
      const faded =
        (dragging?.kind === "line" && (movingIds.has(key) || (!!parent && movingIds.has(parent)))) ||
        (dragging?.kind === "heading" && headingKey(dragging.section, dragging.name) === key);
      return `${faded ? "opacity-40" : ""} ${above === key ? LINE_ABOVE : ""} ${below === key ? LINE_BELOW : ""}`;
    },
    handle: (key) => ({ onMouseDown: () => setGrabbed(key), onMouseUp: () => setGrabbed(null) }),
  };

  const groupNames = [...new Set([...lines.map((l) => l.group), ...(job.headings ?? []).map((h) => h.name)].filter(Boolean))];
  const columns = (showPrices ? 7 : 3) + (steps ? 1 : 0);
  const split = subprojects.length > 0;
  const addButtons = (section: string) =>
    canEdit && (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            setHeadingName("");
            setAddingHeading(section);
          }}
          className="btn-secondary"
        >
          Add heading
        </button>
        <button onClick={() => setAddingCustom({ section })} className="btn-secondary">
          Custom line
        </button>
        <button onClick={() => setPicking({ section })} className="btn-primary">
          Add equipment
        </button>
      </div>
    );
  const pickingSection = picking === null ? null : sectionById(picking.section);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
        <h2 className="eyebrow text-gray-500">Equipment & services</h2>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <button onClick={() => setAddingSubproject(true)} className="btn-secondary">
              Add subproject
            </button>
          )}
          {!split && addButtons("")}
        </div>
      </div>

      {canEdit && picked.length > 0 && (
        <div className="px-4 pb-2">
          <SelectionBar count={picked.length} onClear={() => setSelected(new Set())}>
            <select value="" onChange={(e) => movePicked(e.target.value)} disabled={busy} className="input w-auto py-1.5" aria-label="Move to a heading">
              <option value="" disabled>
                Move to…
              </option>
              {sections.map((sec) => {
                if (!split && sec.id !== "") return null;
                const options = ["", ...namedHeadings(sec.id)].map((h) => (
                  <option key={h || "(none)"} value={`${sec.id}\u0000${h}`}>
                    {h || "No heading"}
                  </option>
                ));
                return split ? (
                  <optgroup key={sec.id || "main"} label={sec.name}>
                    {options}
                  </optgroup>
                ) : (
                  options
                );
              })}
            </select>
            {showPrices && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  discountPicked();
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  inputMode="decimal"
                  placeholder="Disc %"
                  aria-label="Discount for the ticked lines (%)"
                  className="input py-1.5 w-20"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || discount.trim() === ""} className="btn-secondary py-1.5">
                  Set discount
                </button>
              </form>
            )}
            <button onClick={removePicked} disabled={busy} className="btn-secondary py-1.5 hover:text-fault-ink">
              Remove
            </button>
          </SelectionBar>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-y border-gray-200 text-left text-gray-500 bg-gray-50/60">
              <th className={`py-1.5 font-medium ${canEdit ? "pl-1.5 pr-4" : "px-4"}`}>
                {canEdit ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      aria-label="Select all lines"
                      checked={allPicked}
                      onChange={() => setSelected(allPicked ? new Set() : new Set(topLines.map((l) => l.id)))}
                    />
                    Item
                  </span>
                ) : (
                  "Item"
                )}
              </th>
              <th className="px-2 py-1.5 font-medium text-right w-16">Qty</th>
              <th className="px-2 py-1.5 font-medium w-36">Availability</th>
              {steps && <th className="px-2 py-1.5 font-medium w-44">Status</th>}
              {showPrices && (
                <>
                  <th className="px-2 py-1.5 font-medium text-right w-24">Rate</th>
                  <th className="px-2 py-1.5 font-medium text-right w-16">Disc %</th>
                  <th className="px-2 py-1.5 font-medium text-right w-24">Amount</th>
                  <th className="px-1 py-1.5 w-14" />
                </>
              )}
            </tr>
          </thead>
          {sections.map((section) => {
            const own = lines.filter((l) => (l.subproject || "") === section.id);
            if (!split && section.id !== "") return null;
            return (
              <tbody key={section.id || "main"}>
                {split && (
                  <tr className="bg-gray-50 border-y border-gray-200">
                    <td colSpan={columns} className="px-4 py-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-gray-900">{section.name}</span>
                          <span className="text-xs text-gray-500">
                            Booked {formatPeriod(section.prepAt, section.returnAt)}
                            {section.days !== undefined && ` · charged ${section.days} day${section.days === 1 ? "" : "s"}`}
                            {showPrices && section.subtotal !== undefined && ` · ${nzd(section.subtotal)}`}
                          </span>
                        </div>
                        {addButtons(section.id)}
                      </div>
                    </td>
                  </tr>
                )}
                {(() => {
                  const groups = sectionGroups(section.id, own);
                  return groups.map((group) => (
                    <GroupRows
                      key={group.name || "(none)"}
                      group={group}
                      columns={columns}
                      canEdit={canEdit}
                      showPrices={showPrices}
                      jobDone={jobDone}
                      steps={steps}
                      section={section.id}
                      dnd={dnd}
                      selected={selected}
                      onToggle={toggle}
                      onRenameGroup={(from, to) => renameGroup(section.id, from, to)}
                      onRemoveGroup={() => removeGroup(section.id, group.name, group.lines.filter((l) => !l.parentLine).length)}
                      onAddTo={() => setPicking({ section: section.id, group: group.name })}
                      onPatch={patch}
                      onRemove={remove}
                    />
                  ));
                })()}
                {addingHeading === section.id && (
                  <tr>
                    <td colSpan={columns} className="px-4 py-2">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          addHeading(section.id);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={headingName}
                          onChange={(e) => setHeadingName(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && setAddingHeading(null)}
                          maxLength={200}
                          placeholder="e.g. Audio, Lighting, Stage"
                          className="input py-1.5 w-64"
                        />
                        <button type="submit" disabled={!headingName.trim()} className="btn-primary py-1.5">
                          Add heading
                        </button>
                        <button type="button" onClick={() => setAddingHeading(null)} className="btn-secondary py-1.5">
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
                {split && own.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-4 py-3 text-gray-400 text-sm">
                      Nothing on {section.id ? "this subproject" : "the main project"} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
        {lines.length === 0 && !split && <p className="px-4 py-8 text-gray-500 text-sm text-center">Nothing on this project yet.</p>}
      </div>

      {showPrices && summary.pricing && lines.length > 0 && (
        <div className="flex items-center justify-end gap-5 px-4 py-2.5 border-t border-gray-200 text-sm tabular-nums">
          <span className="text-gray-500">
            {summary.pricing.days} day{summary.pricing.days === 1 ? "" : "s"}
          </span>
          {summary.pricing.totals.jobDiscount !== 0 && (
            <span className="text-gray-500">Project discount −{nzd(summary.pricing.totals.jobDiscount)}</span>
          )}
          <span className="font-semibold text-gray-900">Total ex GST {nzd(summary.pricing.totals.exGst)}</span>
        </div>
      )}

      {pickingSection && (
        <ItemPicker jobId={job.id} start={pickingSection.prepAt} end={pickingSection.returnAt} onAdd={addItem} onClose={() => setPicking(null)} />
      )}
      {addingCustom !== null && (
        <CustomLineModal
          groups={groupNames}
          initialGroup={addingCustom.group}
          showPrices={showPrices}
          onAdd={addCustom}
          onClose={() => setAddingCustom(null)}
        />
      )}
      {addingSubproject && <NewSubprojectModal summary={summary} onSaved={onSummary} onClose={() => setAddingSubproject(false)} />}
    </section>
  );
}

// Lines arrive ordered parent-then-children; bucket them by heading in
// first-seen order.
function groupsOf(lines: JobLineView[]) {
  const groups: { name: string; lines: JobLineView[] }[] = [];
  const parentGroup = new Map<string, string>();
  for (const line of lines) {
    const name = line.parentLine ? (parentGroup.get(line.parentLine) ?? line.group) : line.group;
    if (!line.parentLine) parentGroup.set(line.id, name);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, lines: [] }));
    group.lines.push(line);
  }
  return groups;
}

function GroupRows({
  group,
  columns,
  canEdit,
  showPrices,
  jobDone,
  steps,
  section,
  dnd,
  selected,
  onToggle,
  onRenameGroup,
  onRemoveGroup,
  onAddTo,
  onPatch,
  onRemove,
}: {
  group: { name: string; lines: JobLineView[] };
  columns: number;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
  steps: TrackingStep[] | null;
  section: string;
  dnd: Dnd;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onRenameGroup: (from: string, to: string) => void;
  onRemoveGroup: () => void;
  onAddTo: () => void;
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
}) {
  const subtotal = group.lines.reduce((sum, l) => sum + (l.amount?.net ?? 0), 0);
  return (
    <>
      <tr
        {...dnd.row({ type: "heading", section, group: group.name })}
        className={`border-b border-gray-100 bg-white ${dnd.cls(headingKey(section, group.name))}`}
      >
        <td colSpan={columns} className={`pr-4 pt-3 pb-1 ${canEdit && group.name ? "pl-1.5" : "pl-4"}`}>
          <div className="flex items-center justify-between gap-3">
            {canEdit && group.name ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <DragHandle {...dnd.handle(headingKey(section, group.name))} />
                <InlineText
                value={group.name}
                onCommit={(to) => onRenameGroup(group.name, to)}
                className="font-semibold text-gray-800 w-64 border-transparent hover:border-gray-300 bg-transparent"
                />
              </span>
            ) : (
              <span className={group.name ? "font-semibold text-gray-800" : "text-gray-400 text-xs uppercase tracking-wide"}>{group.name || "No heading"}</span>
            )}
            <span className="flex items-center gap-2">
              {steps && <TrackingStatus progress={linesProgress(steps, group.lines)} />}
              {canEdit && group.name && (
                <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs">
                  <button onClick={onAddTo} className="text-signal-ink hover:text-signal-ink-hover font-medium px-1" title={`Add equipment under ${group.name}`}>
                    + Add
                  </button>
                  <button onClick={onRemoveGroup} className="hover:text-red-500 px-1 text-base leading-none" title="Remove heading">
                    ×
                  </button>
                </span>
              )}
              {showPrices && group.lines.length > 0 && <span className="text-xs text-gray-500 tabular-nums">{nzd(subtotal)}</span>}
            </span>
          </div>
        </td>
      </tr>
      {group.lines.length === 0 && (
        <tr {...dnd.row({ type: "empty", section, group: group.name })} className={`border-b border-gray-50 ${dnd.cls(emptyKey(section, group.name))}`}>
          <td colSpan={columns} className="pl-4 py-1.5 text-xs text-gray-400">
            Nothing under this heading yet.
          </td>
        </tr>
      )}
      {group.lines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          canEdit={canEdit}
          showPrices={showPrices}
          jobDone={jobDone}
          steps={steps}
          kitLines={line.item?.kind === "kit" ? group.lines.filter((l) => l.parentLine === line.id) : undefined}
          section={section}
          group={group.name}
          dnd={dnd}
          ticked={selected.has(line.id)}
          onToggle={() => onToggle(line.id)}
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}

function LineRow({
  line,
  canEdit,
  showPrices,
  jobDone,
  steps,
  kitLines,
  section,
  group,
  dnd,
  ticked,
  onToggle,
  onPatch,
  onRemove,
}: {
  line: JobLineView;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
  steps: TrackingStep[] | null;
  // A kit's contents, whose tracking is the kit's.
  kitLines?: JobLineView[];
  section: string;
  group: string;
  dnd: Dnd;
  ticked: boolean;
  onToggle: () => void;
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
}) {
  const isChild = Boolean(line.parentLine);
  const isCustom = line.lineType === "custom";
  const amount = line.amount;

  return (
    <tr
      {...dnd.row(isChild ? { type: "child", section, group, parent: line.parentLine! } : { type: "line", section, group, line })}
      className={`border-b border-gray-50 ${ticked ? "bg-signal-soft/40" : "bg-white"} hover:bg-gray-50/60 ${isChild ? "text-gray-600" : ""} ${dnd.cls(line.id, line.parentLine || undefined)}`}
    >
      <td className={`py-1.5 pr-2 ${isChild ? (canEdit ? "pl-16" : "pl-9") : canEdit ? "pl-1.5" : "pl-4"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {canEdit && !isChild && (
            <>
              <input type="checkbox" checked={ticked} onChange={onToggle} aria-label={`Select ${line.name}`} className="shrink-0" />
              <DragHandle {...dnd.handle(line.id)} />
            </>
          )}
          {isChild && <span className="text-gray-300">↳</span>}
          {isCustom && canEdit ? (
            <InlineText value={line.description} onCommit={(description) => onPatch(line, { description })} className="flex-1 min-w-40" />
          ) : line.item ? (
            <Link to={`/inventory/${line.item.id}`} className="truncate hover:underline">
              {line.name}
            </Link>
          ) : (
            <span className="truncate">{line.name}</span>
          )}
          {line.item?.kind === "kit" && (
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 shrink-0">Kit</span>
          )}
          {line.lineType === "accessory" && <span className="text-[11px] text-gray-400 shrink-0">accessory</span>}
          {line.item?.code && <span className="text-[11px] text-gray-400 font-mono shrink-0">{line.item.code}</span>}

        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        {canEdit && !isChild ? (
          <InlineNumber
            value={line.quantity}
            min={isCustom ? 0 : 1}
            step={isCustom ? undefined : 1}
            onCommit={(quantity) => onPatch(line, { quantity })}
            className="w-14"
          />
        ) : (
          <span className="tabular-nums" title={isChild ? `${line.perParent} per parent` : undefined}>
            {line.quantity}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <AvailabilityCell line={line} jobDone={jobDone} />
      </td>
      {steps && (
        <td className="px-2 py-1.5">
          <TrackingStatus
            progress={kitLines ? linesProgress(steps, kitLines) : line.tracking ? progressOf(steps, line.tracking.at, Math.round(line.quantity)) : null}
          />
        </td>
      )}
      {showPrices && (
        <>
          <td className="px-2 py-1.5 text-right">
            {canEdit && line.lineType !== "component" ? (
              <InlineNumber value={line.unitPrice ?? 0} step={0.01} onCommit={(unitPrice) => onPatch(line, { unitPrice })} className="w-20" />
            ) : (
              <span className="tabular-nums text-gray-400">{line.unitPrice ? nzd(line.unitPrice) : "incl."}</span>
            )}
            {line.unitPrice ? <span className="ml-0.5 text-[11px] text-gray-400">{MODE_SUFFIX[line.priceMode]}</span> : null}
          </td>
          <td className="px-2 py-1.5 text-right">
            {canEdit && line.lineType !== "component" ? (
              <InlineNumber
                value={line.discountPct ?? 0}
                min={0}
                max={100}
                onCommit={(discountPct) => onPatch(line, { discountPct })}
                className="w-14"
              />
            ) : null}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
            {amount && amount.discount !== 0 && <span className="text-gray-400 line-through mr-1.5 text-xs">{nzd(amount.gross)}</span>}
            {amount && (amount.net !== 0 || !isChild) ? nzd(amount.net) : ""}
          </td>
          <td className="px-1 py-1.5 text-right whitespace-nowrap">
            {canEdit && (
              <span className="inline-flex items-center text-gray-400">
                <button onClick={() => onRemove(line)} className="hover:text-red-500 px-1 text-base leading-none" title="Remove">
                  ×
                </button>
              </span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}
