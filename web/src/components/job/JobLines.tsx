import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { pb } from "../../lib/pocketbase";
import { api, type JobLineView, type JobSummary, type LinePatch, type NewLine, type PriceMode, type TrackingStep } from "../../lib/api";
import { formatPeriod, nzd, MODE_SUFFIX } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { useDropdown } from "../../lib/dropdown";
import { InlineNumber, InlineText } from "../InlineInput";
import Modal from "../Modal";
import Field from "../Field";
import NumberInput from "../NumberInput";
import { TrackingStatus } from "../StatusBadge";
import { useOrg } from "../../lib/org";
import { linesProgress, progressOf, useTrackingSteps } from "../../lib/tracking";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";
import NewSubprojectModal from "./NewSubprojectModal";
import QuickAdd from "./QuickAdd";
import { DragHandle } from "../DragReorder";

// Done jobs don't hold stock, so availability isn't worked out for them.
function AvailabilityCell({ line, jobDone }: { line: JobLineView; jobDone: boolean }) {
  if (line.lineType === "custom" || jobDone) return <span className="text-gray-300">—</span>;
  if (line.item?.kind === "kit") {
    return line.componentsShort ? (
      <span className="inline-flex items-center gap-1.5 text-fault-ink font-medium" title="One or more of this kit's contents is short">
        <span className="status-dot bg-fault" />
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

// What's drawn, worked out once per render: each part, its headings, and
// the rows showing under each (after search and folding).
interface GroupModel {
  name: string;
  key: string;
  // Lines under this heading, a kit's contents included, in order.
  lines: JobLineView[];
  top: JobLineView[];
  // Rows drawn, in order: top-level lines and any open kits' contents.
  rows: JobLineView[];
  // Has its own heading row ("" only does when the part has named ones).
  header: boolean;
  collapsed: boolean;
  short: number;
  subtotal: number;
}
interface SectionModel {
  section: Section;
  key: string;
  collapsed: boolean;
  groups: GroupModel[];
  count: number;
  short: number;
  empty: boolean;
}

// Dragging lines and headings into order. Each row says what it is, so
// hovering it works out where the dragged thing would land: a line before
// another line (in any heading or part of the project), or a heading before
// another heading in its part. An orange line shows where, as in
// components/DragReorder.tsx; a folded heading lights up instead. Nothing
// moves until it's dropped. Headings in the outline take lines too.
type RowDesc =
  | { type: "section"; section: string }
  | { type: "heading"; section: string; group: string }
  | { type: "line"; section: string; group: string; line: JobLineView }
  | { type: "child"; section: string; group: string; parent: string }
  | { type: "empty"; section: string; group: string };

type Dragging = { kind: "line"; line: JobLineView } | { kind: "heading"; section: string; name: string };
// A line dropped on the top half of a heading row comes out of its heading
// ("above" is the row the orange line shows over).
type Drop =
  | { kind: "line"; section: string; group: string; before: string | null; above?: string }
  | { kind: "heading"; section: string; before: string | null };
type Marks = { above: string | null; below: string | null; into: string | null };

const sectionKey = (section: string) => `s:${section}`;
const headingKey = (section: string, group: string) => `h:${section}:${group}`;
const emptyKey = (section: string, group: string) => `e:${section}:${group}`;
// What a line's charged, to compare it with others and with its item's usual price.
const priceOf = (l: JobLineView) => `${l.unitPrice ?? 0}|${l.priceMode}|${l.discountPct ?? 0}`;
const priceText = (l: JobLineView) => `${nzd(l.unitPrice ?? 0)}${MODE_SUFFIX[l.priceMode]}${l.discountPct ? ` less ${l.discountPct}%` : ""}`;
const USUAL_MODE: Record<string, PriceMode> = { hour: "per_hour", day: "per_day", week: "per_week", each: "fixed" };

// How a line's charged, as picked beside its rate.
const MODES: [PriceMode, string][] = [
  ["per_hour", "/hr"],
  ["per_day", "/day"],
  ["per_week", "/week"],
  ["fixed", "each"],
];
const quickKey = (section: string, group: string) => `q:${section}:${group}`;
const LINE_ABOVE = "[&>td]:shadow-[inset_0_2px_0_var(--color-signal)]";
const LINE_BELOW = "[&>td]:shadow-[inset_0_-2px_0_var(--color-signal)]";
// The same, indented to show it goes in under a heading.
const LINE_IN =
  "[&>td:nth-child(2)]:bg-[linear-gradient(var(--color-signal),var(--color-signal))] [&>td:nth-child(2)]:bg-no-repeat [&>td:nth-child(2)]:bg-[length:calc(100%-1.75rem)_2px]";
const LINE_ABOVE_IN = `${LINE_IN} [&>td:nth-child(2)]:bg-[position:right_top] [&>td:nth-child(n+3)]:shadow-[inset_0_2px_0_var(--color-signal)]`;
const LINE_BELOW_IN = `${LINE_IN} [&>td:nth-child(2)]:bg-[position:right_bottom] [&>td:nth-child(n+3)]:shadow-[inset_0_-2px_0_var(--color-signal)]`;
const INTO = "[&>td]:bg-signal-soft!";
// Hidden until the row's hovered, where there's a mouse.
// Edit-in-place boxes that only look like boxes when pointed at, so the
// list reads as a list.
const QUIET = "py-0! border-transparent bg-transparent hover:border-gray-300 hover:bg-white focus:bg-white text-[13px]";
const ON_HOVER = "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100";

interface Dnd {
  row: (desc: RowDesc) => {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  // Lines dropped onto a heading in the outline go to its end.
  target: (section: string, group: string) => {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
  over: string | null;
  cls: (key: string, parent?: string) => string;
  handle: (key: string) => { onMouseDown: () => void; onMouseUp: () => void };
}

// Which headings and parts are folded, kept per project in this browser.
function useFolded(jobId: string) {
  const storeKey = `r2.equipment.folded.${jobId}`;
  const load = () => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(storeKey) ?? "[]"));
    } catch {
      return new Set<string>();
    }
  };
  const [state, setState] = useState(() => ({ key: storeKey, set: load() }));
  if (state.key !== storeKey) setState({ key: storeKey, set: load() });
  const update = (fn: (prev: Set<string>) => Set<string>) =>
    setState((s) => {
      const set = fn(s.set);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...set]));
      } catch {
        // Folding still works for this visit.
      }
      return { key: s.key, set };
    });
  return [state.set, update] as const;
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
  // Where a custom line from the menus goes: a section ("" for the main
  // project) and, from a heading's menu, that heading; null when not adding.
  const [addingCustom, setAddingCustom] = useState<{ section: string; group?: string } | null>(null);
  // The section a new heading is being typed into.
  const [addingHeading, setAddingHeading] = useState<string | null>(null);
  const [headingName, setHeadingName] = useState("");
  const [addingSubproject, setAddingSubproject] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
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
  const [folded, setFolded] = useFolded(job.id);
  // Kits whose contents show the other way to usual (shut, or open when short).
  const [kitFlipped, setKitFlipped] = useState<Set<string>>(new Set());

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
  const split = subprojects.length > 0;
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

  const addItemTo = (section: string, group: string) => async (itemId: string, quantity: number) => {
    // Already under this heading: it'd top that line up, which is easy to miss.
    const there = lines.find(
      (l) => !l.parentLine && l.lineType === "item" && l.item?.id === itemId && (l.subproject || "") === section && l.group === group,
    );
    if (there) {
      const ok = await confirm({
        title: "Already added",
        message: `${there.name} is already under ${group || (section ? sectionById(section).name : "no heading")}. Add ${quantity} more, making ${there.quantity + quantity}?`,
        confirmLabel: "Add",
      });
      if (!ok) return;
    }
    onSummary(await api.addLine(job.id, { itemId, quantity, subproject: section, group }));
  };
  const addCustomTo = (section: string, group: string) => async (description: string, quantity: number) => {
    onSummary(await api.addLine(job.id, { description, quantity, subproject: section, group }));
  };

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
  // A subproject goes with its schedule and everything on it.
  async function removeSubproject(section: Section) {
    const own = lines.filter((l) => l.subproject === section.id && !l.parentLine);
    const ok = await confirm({
      title: "Remove subproject",
      message: own.length
        ? `Remove "${section.name}", its schedule and its ${plural(own.length, "item")}?`
        : `Remove "${section.name}" and its schedule?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      for (const l of own) await api.deleteLine(l.id);
      await pb.collection("subprojects").delete(section.id);
      return api.getJobSummary(job.id);
    }, "Couldn't remove it");
  }
  async function addHeading(section: string) {
    const name = headingName.trim();
    if (!name) return;
    await heading({ action: "add", section, name }, "Couldn't add the heading");
    setHeadingName("");
    setAddingHeading(null);
  }
  const startHeading = (section: string) => {
    setHeadingName("");
    setAddingHeading(section);
    unfold(sectionKey(section));
  };

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

  // ---- Folding
  function unfold(...keys: string[]) {
    setFolded((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- What's drawn
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const matches = (l: JobLineView) => [l.name, l.description, l.item?.code ?? ""].some((s) => s.toLowerCase().includes(q));
  const isShort = (l: JobLineView) => l.componentsShort || (l.availability?.short ?? 0) > 0;
  const shortInside = new Set(lines.filter((l) => l.parentLine && (l.availability?.short ?? 0) > 0).map((l) => l.parentLine));
  const kitOpen = (l: JobLineView) => (l.componentsShort || shortInside.has(l.id)) !== kitFlipped.has(l.id);

  // Why a line's price stands out: not its item's usual price, or not the
  // same as another line of that item on the project.
  const priceNotes = new Map<string, string>();
  if (showPrices) {
    for (const l of lines) {
      if (l.parentLine || l.lineType !== "item" || !l.item) continue;
      const notes: string[] = [];
      const usualMode = USUAL_MODE[l.item.priceUnit] ?? "per_day";
      if ((l.unitPrice ?? 0) !== l.item.price || l.priceMode !== usualMode) notes.push(`Usually ${nzd(l.item.price)}${MODE_SUFFIX[usualMode]}`);
      if (lines.some((o) => o.id !== l.id && !o.parentLine && o.lineType === "item" && o.item?.id === l.item?.id && priceOf(o) !== priceOf(l)))
        notes.push(`Priced differently from the other ${l.name} on this project`);
      if (notes.length) priceNotes.set(l.id, notes.join(". "));
    }
  }

  const model: SectionModel[] = (split ? sections : sections.slice(0, 1)).map((section) => {
    const own = lines.filter((l) => (l.subproject || "") === section.id);
    const raw = sectionGroups(section.id, own);
    const sKey = sectionKey(section.id);
    const sCollapsed = split && !searching && folded.has(sKey);
    const groups = raw.map((g): GroupModel => {
      const key = headingKey(section.id, g.name);
      // Lines without a heading sit at the top, unindented, with no row of their own.
      const header = g.name !== "";
      const collapsed = header && !searching && folded.has(key);
      const top = g.lines.filter((l) => !l.parentLine);
      const rows: JobLineView[] = [];
      if (!collapsed && !sCollapsed) {
        for (const t of top) {
          const kids = g.lines.filter((l) => l.parentLine === t.id);
          const kidHits = searching && kids.some(matches);
          if (searching && !matches(t) && !kidHits) continue;
          rows.push(t);
          // What came with it (kit contents, accessories) folds away.
          if (kitOpen(t) || kidHits) rows.push(...kids);
        }
      }
      return {
        name: g.name,
        key,
        lines: g.lines,
        top,
        rows,
        header,
        collapsed,
        short: top.filter(isShort).length,
        subtotal: g.lines.reduce((sum, l) => sum + (l.amount?.net ?? 0), 0),
      };
    });
    const shownGroups = searching ? groups.filter((g) => g.rows.length > 0) : groups;
    return {
      section,
      key: sKey,
      collapsed: sCollapsed,
      groups: shownGroups,
      count: own.filter((l) => !l.parentLine).length,
      short: own.filter((l) => !l.parentLine && isShort(l)).length,
      empty: own.length === 0,
    };
  });
  const shownModel = searching ? model.filter((s) => s.groups.length > 0) : model;
  const visibleTop = shownModel.flatMap((s) => s.groups.flatMap((g) => g.rows.filter((l) => !l.parentLine)));
  const foldable = model.flatMap((s) => [...(split ? [s.key] : []), ...s.groups.filter((g) => g.header).map((g) => g.key)]);
  const allFolded = foldable.length > 0 && foldable.every((k) => folded.has(k));
  const hasOutline = split || model.some((s) => s.groups.some((g) => g.name !== ""));

  // ---- Ticked lines (top-level only; a kit's contents go with it), in order.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const picked = lines.filter((l) => !l.parentLine && selected.has(l.id));
  // Shift-click ticks everything between it and the last one ticked.
  function tick(id: string, e: MouseEvent) {
    const at = visibleTop.findIndex((l) => l.id === id);
    const from = anchor ? visibleTop.findIndex((l) => l.id === anchor) : -1;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      if (e.shiftKey && from >= 0 && at >= 0) {
        for (const l of visibleTop.slice(Math.min(from, at), Math.max(from, at) + 1)) {
          if (on) next.add(l.id);
          else next.delete(l.id);
        }
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setAnchor(id);
  }
  function tickAll(ids: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => prev.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }
  const allPicked = visibleTop.length > 0 && visibleTop.every((l) => selected.has(l.id));
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- Drag and drop
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [over, setOver] = useState<string | null>(null);
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
  function dropFor(row: RowDesc, upper: boolean): Drop | null {
    if (!dragging) return null;
    // A part's own band: the top of its first heading (lines), or before
    // its first heading (headings).
    const desc: Exclude<RowDesc, { type: "section" }> =
      row.type === "section"
        ? {
            type: "heading",
            section: row.section,
            group: dragging.kind === "line" ? (sectionGroups(row.section, lines.filter((l) => sectionOf(l) === row.section))[0]?.name ?? "") : "",
          }
        : row;
    if (dragging.kind === "line") {
      const self = dragging.line.id;
      if (row.type === "heading" && upper && !moving.every((l) => sectionOf(l) === row.section && l.group === "")) {
        return { kind: "line", section: row.section, group: "", before: null, above: headingKey(row.section, row.group) };
      }
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
    // The same item already under that heading: merge into it, or don't move.
    const ids0 = new Set(move.map((l) => l.id));
    const dupes = move
      .filter((l) => l.lineType === "item" && l.item && !(sectionOf(l) === section && l.group === group))
      .map((l) => ({ line: l, into: siblingsOf(section, group).find((t) => !ids0.has(t.id) && t.lineType === "item" && t.item?.id === l.item?.id) }))
      .filter((d): d is { line: JobLineView; into: JobLineView } => !!d.into);
    if (dupes.length > 0) {
      const where = group || (section ? sectionById(section).name : "no heading");
      const one = dupes[0];
      const differ = showPrices ? dupes.filter((d) => priceOf(d.line) !== priceOf(d.into)) : [];
      const priceNote =
        differ.length === 0
          ? ""
          : dupes.length === 1
            ? ` They're priced differently: it keeps ${priceText(one.into)}, not ${priceText(one.line)}.`
            : ` Some are priced differently: each keeps the price of the one already under ${where}.`;
      const ok = await confirm({
        title: "Merge duplicates",
        message:
          (dupes.length === 1
            ? `${one.line.name} is already under ${where}. Merge them into one line of ${one.into.quantity + one.line.quantity}?`
            : `${dupes.length} of these are already under ${where}. Merge their quantities?`) + priceNote,
        confirmLabel: "Merge",
      });
      if (!ok) return;
      await run(async () => {
        let last = summary;
        for (const d of dupes) {
          last = await api.updateLine(d.into.id, { quantity: d.into.quantity + d.line.quantity });
          last = await api.deleteLine(d.line.id);
        }
        return last;
      }, "Couldn't merge them");
      const merged = new Set(dupes.map((d) => d.line.id));
      move = move.filter((l) => !merged.has(l.id));
      if (move.length === 0) return;
      if (before && merged.has(before)) before = null;
    }
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
  async function moveTo(move: JobLineView[], section: string, group: string) {
    setBusy(true);
    await dropLines(move, section, group, null);
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
    setOver(null);
  };

  // Which row shows where it'll land: an orange line above the line or
  // heading it goes before, or below the last row showing where it goes at
  // the end; a folded heading or part lights up instead.
  const groupModel = (section: string, group: string) => model.find((s) => s.section.id === section)?.groups.find((g) => g.name === group);
  const sectionModel = (section: string) => model.find((s) => s.section.id === section);
  function marksFor(d: Drop | null, hovering: boolean): Marks {
    const m: Marks = { above: null, below: null, into: null };
    const endOf = (section: string, group: string, asLine: boolean) => {
      const s = sectionModel(section);
      const g = groupModel(section, group);
      // Empty: just under the heading (or at the top of the empty part),
      // above the box for typing equipment in.
      if (s?.collapsed) m.into = s.key;
      else if (!g) m.above = emptyKey(section, group);
      else if (g.collapsed) {
        if (asLine) m.into = g.key;
        else m.below = g.key;
      } else if (g.rows.length > 0) m.below = g.rows[g.rows.length - 1].id;
      else if (g.lines.length === 0) {
        if (g.header) m.below = g.key;
        else m.above = emptyKey(section, group);
      }
      else m.below = g.key;
    };
    if (d?.kind === "line" && d.above) m.above = d.above;
    else if (d?.kind === "line" && !hovering) {
      const s = sectionModel(d.section);
      const g = groupModel(d.section, d.group);
      if (!d.before) endOf(d.section, d.group, true);
      else if (s?.collapsed) m.into = s.key;
      else if (g && g.rows.some((l) => l.id === d.before)) m.above = d.before;
      else if (g) m.into = g.key;
    } else if (d?.kind === "heading") {
      const s = sectionModel(d.section);
      if (s?.collapsed) m.into = s.key;
      else if (d.before) m.above = headingKey(d.section, d.before);
      else {
        const names = namedHeadings(d.section);
        endOf(d.section, names[names.length - 1] ?? "", false);
      }
    }
    return m;
  }
  const { above, below, into } = marksFor(drop, !!over);
  // Indented when it's going in under a heading.
  const indented = drop?.kind === "line" && drop.group !== "";

  const dnd: Dnd = {
    row: (desc) => {
      const key = desc.type === "line" ? desc.line.id : desc.type === "heading" ? headingKey(desc.section, desc.group) : "";
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
          if (over) setOver(null);
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
    target: (section, group) => ({
      onDragOver: (e) => {
        if (dragging?.kind !== "line") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const key = headingKey(section, group);
        if (over !== key) {
          setOver(key);
          setDrop({ kind: "line", section, group, before: null });
        }
      },
      onDragLeave: () => setOver(null),
      onDrop: (e) => {
        e.preventDefault();
        const move = moving;
        endDrag();
        if (move.length > 0) dropLines(move, section, group, null);
      },
    }),
    over,
    cls: (key, parent) => {
      const faded =
        (dragging?.kind === "line" && (movingIds.has(key) || (!!parent && movingIds.has(parent)))) ||
        (dragging?.kind === "heading" && headingKey(dragging.section, dragging.name) === key);
      return `${faded ? "opacity-40" : ""} ${above === key ? (indented ? LINE_ABOVE_IN : LINE_ABOVE) : ""} ${below === key ? (indented ? LINE_BELOW_IN : LINE_BELOW) : ""} ${into === key ? INTO : ""}`;
    },
    handle: (key) => ({ onMouseDown: () => setGrabbed(key), onMouseUp: () => setGrabbed(null) }),
  };

  // ---- Getting around
  // Where a line can be moved to: every part's headings.
  const destinations = (split ? sections : sections.slice(0, 1)).map((sec) => ({
    section: sec,
    groups: ["", ...namedHeadings(sec.id)],
  }));

  function jumpTo(key: string, section: string) {
    unfold(sectionKey(section), key);
    setQuery("");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector(`[data-row="${CSS.escape(key)}"]`);
        el?.scrollIntoView({ block: "start", behavior: "smooth" });
      }),
    );
  }

  // The heading at the top of the screen, lit up in the outline.
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const main = rootRef.current?.closest("main");
    if (!main || !hasOutline) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = main.getBoundingClientRect().top + 100;
        let at: string | null = null;
        for (const el of rootRef.current?.querySelectorAll<HTMLElement>("[data-row^='h:'], [data-row^='s:']") ?? []) {
          if (el.getBoundingClientRect().top <= top) at = el.dataset.row ?? null;
          else break;
        }
        setCurrent(at);
      });
    };
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", onScroll);
    };
  }, [hasOutline, lines.length, folded]);

  // "/" finds.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Enter saves and goes down to the same box on the next line, Shift+Enter up.
  function onTableKey(e: KeyboardEvent) {
    if (e.key !== "Enter") return;
    const input = e.target as HTMLElement;
    const col = input.closest<HTMLElement>("td[data-col]")?.dataset.col;
    if (!col || input.tagName !== "INPUT") return;
    const all = [...(rootRef.current?.querySelectorAll<HTMLInputElement>(`td[data-col="${col}"] input`) ?? [])];
    const next = all[all.indexOf(input as HTMLInputElement) + (e.shiftKey ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.select();
  }

  const groupNames = [...new Set([...lines.map((l) => l.group), ...(job.headings ?? []).map((h) => h.name)].filter(Boolean))];
  const columns = (canEdit ? 2 : 0) + 3 + (steps ? 1 : 0) + (showPrices ? 3 : 0);
  const cols: Cols = { count: columns, lead: canEdit, steps: !!steps, prices: showPrices, actions: canEdit };
  // Goes to the type-to-add box at the end of a heading (the part's last
  // heading when none's given), opening whatever's folded on the way.
  function focusAdd(section: string, group?: string) {
    const s = model.find((m) => m.section.id === section);
    const g = group ?? s?.groups[s.groups.length - 1]?.name ?? "";
    setQuery("");
    unfold(sectionKey(section), headingKey(section, g));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-quickadd="${CSS.escape(quickKey(section, g))}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }),
    );
  }
  const quickAdd = (section: string, group: string) => {
    const sec = sectionById(section);
    return (
      <QuickAdd
        id={quickKey(section, group)}
        jobId={job.id}
        start={sec.prepAt}
        end={sec.returnAt}
        placeholder={group ? `+ Add to ${group}` : "+ Add"}
        onAdd={addItemTo(section, group)}
        onCustom={addCustomTo(section, group)}
        onHeading={async (name) => {
          // In where it was typed: first from the top box, else after this heading.
          const before = nextHeading(section, group) ?? undefined;
          await heading({ action: "add", section, name, before }, "Couldn't add the heading");
          focusAdd(section, name);
        }}
      />
    );
  };
  const addFor = (section: string, group?: string) => ({
    onEquipment: () => focusAdd(section, group),
    onCustom: () => setAddingCustom({ section, group }),
    onHeading: () => startHeading(section),
  });

  return (
    <div ref={rootRef} className={`grid grid-cols-1 gap-4 items-start ${hasOutline ? "xl:grid-cols-[13rem_minmax(0,1fr)]" : ""}`}>
      {hasOutline && (
        <Outline
          model={shownModel}
          split={split}
          current={current}
          dnd={dnd}
          dragging={dragging?.kind === "line"}
          onJump={jumpTo}
        />
      )}

      <section className="card min-w-0">
        <table className="w-full table-fixed text-[13px] border-collapse" onKeyDownCapture={onTableKey}>
          <colgroup>
            {canEdit && <col className="w-12" />}
            <col />
            <col className="w-16" />
            <col className="w-32" />
            {steps && <col className="w-44" />}
            {showPrices && (
              <>
                <col className="w-32 hidden md:table-column" />
                <col className="w-[4.5rem] hidden md:table-column" />
                <col className="w-24" />
              </>
            )}
            {canEdit && <col className="w-14" />}
          </colgroup>
          {/* Pulled up over <main>'s top padding so rows can't show above it. */}
          <thead className="sticky -top-3 md:-top-5 z-20 bg-white shadow-[0_1px_0_var(--color-gray-200)]">
            <tr>
              <td colSpan={columns} className="px-3 py-2 border-b border-gray-200 bg-white">
                {canEdit && picked.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap min-h-9">
                    <span className="font-medium text-gray-900 mr-1">{picked.length} selected</span>
                    <MoveMenu
                      destinations={destinations}
                      split={split}
                      disabled={busy}
                      button={<span className="btn-secondary py-1.5 flex items-center gap-1">Move to<Caret /></span>}
                      onPick={(section, group) => moveTo(picked, section, group)}
                    />
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
                    <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-900 ml-auto">
                      Clear selection
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap min-h-9">
                    <div className="relative">
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Escape") return;
                          setQuery("");
                          e.currentTarget.blur();
                        }}
                        placeholder="Find on this project"
                        aria-label="Find equipment on this project"
                        className="input py-1.5 w-56"
                      />
                    </div>
                    {searching && (
                      <span className="text-gray-500">
                        {visibleTop.length} match{visibleTop.length === 1 ? "" : "es"}
                      </span>
                    )}
                    {foldable.length > 0 && !searching && (
                      <button
                        onClick={() => setFolded(() => (allFolded ? new Set() : new Set(foldable)))}
                        className="text-gray-500 hover:text-gray-900 px-1"
                      >
                        {allFolded ? "Expand all" : "Collapse all"}
                      </button>
                    )}
                    {canEdit && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <button onClick={() => setAddingSubproject(true)} className="btn-secondary">
                          Add subproject
                        </button>
                        {!split && <AddControls {...addFor("")} />}
                      </div>
                    )}
                  </div>
                )}
              </td>
            </tr>
            <tr className="text-left text-gray-500 bg-gray-50 [&>th]:border-b [&>th]:border-gray-200">
              {canEdit && (
                <th className="pl-2 pr-0 py-1.5 w-12">
                  <input
                    type="checkbox"
                    aria-label="Select all lines"
                    checked={allPicked}
                    onChange={() => setSelected(allPicked ? new Set() : new Set(visibleTop.map((l) => l.id)))}
                  />
                </th>
              )}
              <th className={`py-1.5 font-medium ${canEdit ? "pr-2" : "px-4"}`}>Item</th>
              <th className="px-2 py-1.5 font-medium text-right w-16">Qty</th>
              <th className="px-2 py-1.5 font-medium w-36">Availability</th>
              {steps && <th className="px-2 py-1.5 font-medium w-44">Status</th>}
              {showPrices && (
                <>
                  <th className="pl-2 pr-[2.875rem] py-1.5 font-medium text-right w-32 hidden md:table-cell">Rate</th>
                  <th className="px-2 py-1.5 font-medium text-right w-16 hidden md:table-cell">Disc %</th>
                  <th className="px-2 py-1.5 font-medium text-right w-24">Amount</th>
                </>
              )}
              {canEdit && <th className="w-16" />}
            </tr>
          </thead>
          {shownModel.map((s) => (
            <tbody key={s.key}>
              {split && (
                <SectionRow
                  model={s}
                  cols={cols}
                  canEdit={canEdit}
                  showPrices={showPrices}
                  dnd={dnd}
                  onToggle={() => toggleFold(s.key)}
                  add={addFor(s.section.id)}
                  onRemove={s.section.id ? () => removeSubproject(s.section) : undefined}
                />
              )}
              {!s.collapsed &&
                s.groups.map((g) => (
                  <GroupRows
                    key={g.key}
                    group={g}
                    priceNotes={priceNotes}
                    cols={cols}
                    canEdit={canEdit}
                    showPrices={showPrices}
                    jobDone={jobDone}
                    steps={steps}
                    section={s.section.id}
                    searching={searching}
                    dnd={dnd}
                    selected={selected}
                    kitOpen={kitOpen}
                    onKit={(id) =>
                      setKitFlipped((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onTick={tick}
                    onTickAll={() => tickAll(g.top.map((l) => l.id))}
                    onToggle={() => toggleFold(g.key)}
                    onRename={(to) => renameGroup(s.section.id, g.name, to)}
                    onRemoveGroup={() => removeGroup(s.section.id, g.name, g.top.length)}
                    add={addFor(s.section.id, g.name)}
                    quick={canEdit && !searching ? quickAdd(s.section.id, g.name) : null}
                    onPatch={patch}
                    onRemove={remove}
                  />
                ))}
              {!s.collapsed && addingHeading === s.section.id && (
                <tr>
                  <td colSpan={columns} className="px-4 py-2">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        addHeading(s.section.id);
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
              {(split || canEdit) && !s.collapsed && s.groups.length === 0 && !searching && (
                <tr
                  {...dnd.row({ type: "empty", section: s.section.id, group: "" })}
                  data-row={emptyKey(s.section.id, "")}
                  className={dnd.cls(emptyKey(s.section.id, ""))}
                >
                  {canEdit ? (
                    <QuickCells cols={cols} indent={false}>
                      {quickAdd(s.section.id, "")}
                    </QuickCells>
                  ) : (
                    <td colSpan={columns} className="px-4 py-3 text-gray-400 text-sm">
                      Nothing on {s.section.id ? "this subproject" : "the main project"} yet.
                    </td>
                  )}
                </tr>
              )}
            </tbody>
          ))}
        </table>
        {lines.length === 0 && !split && !canEdit && <p className="px-4 py-8 text-gray-500 text-sm text-center">Nothing on this project yet.</p>}
        {searching && shownModel.length === 0 && <p className="px-4 py-8 text-gray-500 text-sm text-center">Nothing matches “{query.trim()}”.</p>}

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
      </section>

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
    </div>
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

// ---- Small parts

function Caret({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`w-4 h-4 text-gray-400 shrink-0 ${className}`} aria-hidden>
      <path d="M5.5 7.5L10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FoldButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      className="w-5 h-5 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
    >
      <Caret className={`text-current transition-transform ${open ? "" : "-rotate-90"}`} />
    </button>
  );
}

// Shuts the menu, then does it.
const then = (close: () => void, fn: () => void) => () => {
  close();
  fn();
};

const menuItem = "w-full text-left block px-3 py-1.5 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent";

// A "⋯" button and its dropdown.
function MoreMenu({ label, children, className = "" }: { label: string; children: (close: () => void) => ReactNode; className?: string }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className={`relative inline-block ${open ? "opacity-100!" : ""} ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-7 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
      >
        <svg viewBox="0 0 20 20" className="w-4 h-4" fill="currentColor" aria-hidden>
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-64 max-w-[calc(100vw-1.5rem)] max-h-[60vh] overflow-y-auto card shadow-lg py-1 z-30 text-sm text-left font-normal">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// The "/day" beside a rate, which opens a menu to charge it another way.
function ModeMenu({ value, label, onChange }: { value: PriceMode; label: string; onChange: (mode: PriceMode) => void }) {
  const { open, setOpen, ref } = useDropdown();
  const short = MODES.find(([m]) => m === value)?.[1] ?? "";
  return (
    <div ref={ref} className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`ml-0.5 w-9 text-center text-[11px] rounded hover:text-gray-900 hover:bg-gray-100 ${open ? "text-gray-900 bg-gray-100" : "text-gray-400"}`}
      >
        {short}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-28 card shadow-lg py-1 z-30 text-sm text-left font-normal">
          {MODES.map(([mode, text]) => (
            <button
              key={mode}
              role="menuitemradio"
              aria-checked={mode === value}
              onClick={() => {
                setOpen(false);
                if (mode !== value) onChange(mode);
              }}
              className={`${menuItem} flex items-center justify-between ${mode === value ? "font-medium text-gray-900" : "text-gray-700"}`}
            >
              {text}
              {mode === value && (
                <svg viewBox="0 0 20 20" className="w-4 h-4 text-signal-ink" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Destinations = { section: Section; groups: string[] }[];

// Every part and heading, to send lines to.
function MoveList({
  destinations,
  split,
  here,
  onPick,
}: {
  destinations: Destinations;
  split: boolean;
  here?: { section: string; group: string };
  onPick: (section: string, group: string) => void;
}) {
  return (
    <>
      {destinations.map((d) => (
        <div key={d.section.id || "main"} className="py-0.5">
          {split && <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold text-gray-500 truncate">{d.section.name}</div>}
          {d.groups.map((g) => {
            const isHere = here?.section === d.section.id && here.group === g;
            return (
              <button key={g || "(none)"} disabled={isHere} onClick={() => onPick(d.section.id, g)} className={`${menuItem} ${split ? "pl-5" : ""} truncate`}>
                {g || <span className="text-gray-500">No heading</span>}
                {isHere && <span className="text-xs text-gray-400 ml-1.5">here</span>}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

function MoveMenu({
  destinations,
  split,
  disabled,
  button,
  onPick,
}: {
  destinations: Destinations;
  split: boolean;
  disabled?: boolean;
  button: ReactNode;
  onPick: (section: string, group: string) => void;
}) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} aria-haspopup="menu" aria-expanded={open} className="disabled:opacity-50">
        {button}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 w-64 max-w-[calc(100vw-1.5rem)] max-h-[60vh] overflow-y-auto card shadow-lg py-1 z-30 text-sm">
          <MoveList
            destinations={destinations}
            split={split}
            onPick={(s, g) => {
              setOpen(false);
              onPick(s, g);
            }}
          />
        </div>
      )}
    </div>
  );
}

interface AddActions {
  onEquipment: () => void;
  onCustom: () => void;
  onHeading: () => void;
}

// "Add", with custom lines and headings in the menu beside it.
function AddControls({ onEquipment, onCustom, onHeading }: AddActions) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={onEquipment} className="btn-primary">
        Add
      </button>
      <MoreMenu label="More to add">
        {(close) => (
          <>
            <button onClick={then(close, () => onCustom())} className={menuItem}>
              Custom line
            </button>
            <button onClick={then(close, () => onHeading())} className={menuItem}>
              Heading
            </button>
          </>
        )}
      </MoreMenu>
    </div>
  );
}

function ShortCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-fault-ink font-medium whitespace-nowrap">
      <span className="status-dot bg-fault" />
      {n} short
    </span>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- The outline down the side

function Outline({
  model,
  split,
  current,
  dnd,
  dragging,
  onJump,
}: {
  model: SectionModel[];
  split: boolean;
  current: string | null;
  dnd: Dnd;
  dragging: boolean;
  onJump: (key: string, section: string) => void;
}) {
  const item = (key: string, section: string, group: string | null, label: ReactNode, count: number, short: number, top: boolean) => {
    const target = group !== null ? dnd.target(section, group) : dnd.target(section, model.find((s) => s.section.id === section)?.groups[0]?.name ?? "");
    const lit = dragging && dnd.over === headingKey(section, group ?? model.find((s) => s.section.id === section)?.groups[0]?.name ?? "");
    return (
      <button
        key={key}
        onClick={() => onJump(key, section)}
        {...target}
        className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left ${top ? "font-semibold text-gray-900 mt-1.5 first:mt-0" : "pl-4 text-gray-700"} ${
          lit ? "bg-signal-soft ring-1 ring-signal" : current === key ? "bg-gray-100" : "hover:bg-gray-50"
        }`}
      >
        <span className="truncate flex-1">{label}</span>
        {short > 0 && <span className="status-dot bg-fault shrink-0" title={`${short} short`} />}
        <span className="text-xs text-gray-400 tabular-nums shrink-0">{count}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Equipment outline" className="hidden xl:flex flex-col card p-1.5 sticky top-0 max-h-[calc(100vh-3rem)] overflow-y-auto text-[13px]">
      {model.map((s) => (
        <div key={s.key} className="flex flex-col">
          {split && item(s.key, s.section.id, null, s.section.name, s.count, s.short, true)}
          {s.groups
            .filter((g) => g.header)
            .map((g) =>
              item(g.key, s.section.id, g.name, g.name || <span className="text-gray-500">No heading</span>, g.top.length, g.short, !split),
            )}
        </div>
      ))}
    </nav>
  );
}

// ---- Rows

interface Cols {
  count: number;
  lead: boolean;
  steps: boolean;
  prices: boolean;
  actions: boolean;
}

// A subproject's band.
function SectionRow({
  model,
  cols,
  canEdit,
  showPrices,
  dnd,
  onToggle,
  add,
  onRemove,
}: {
  model: SectionModel;
  cols: Cols;
  canEdit: boolean;
  showPrices: boolean;
  dnd: Dnd;
  onToggle: () => void;
  add: AddActions;
  // Subprojects only; the main project stays.
  onRemove?: () => void;
}) {
  const { section } = model;
  const cell = "bg-gray-100 border-y border-gray-300 py-2.5";
  return (
    <tr {...dnd.row({ type: "section", section: section.id })} data-row={model.key} className={`scroll-mt-24 ${dnd.cls(model.key)}`}>
      {cols.lead && <td className={`${cell} pl-2`} />}
      <td colSpan={2} className={`${cell} ${cols.lead ? "" : "pl-3"} pr-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <FoldButton open={!model.collapsed} onClick={onToggle} label={section.name} />
          <div className="flex flex-col min-w-0">
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-[15px] text-gray-900 truncate">{section.name}</span>
              <span className="text-xs text-gray-500 shrink-0">{plural(model.count, "item")}</span>
            </span>
            <span className="text-xs text-gray-500 truncate">
              {formatPeriod(section.prepAt, section.returnAt)}
              {section.days !== undefined && ` · charged ${plural(section.days, "day")}`}
            </span>
          </div>
        </div>
      </td>
      <td className={`${cell} px-2`}>
        <ShortCount n={model.short} />
      </td>
      {cols.steps && <td className={cell} />}
      {cols.prices && <td colSpan={2} className={`${cell} hidden md:table-cell`} />}
      {cols.prices && (
        <td className={`${cell} px-2 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap`}>
          {showPrices && section.subtotal !== undefined ? nzd(section.subtotal) : ""}
        </td>
      )}
      {cols.actions && (
        <td className={`${cell} pr-2 text-right whitespace-nowrap`}>
          {canEdit && (
            <span className="inline-flex items-center">
              <MoreMenu label={`${section.name} options`}>
                {(close) => (
                  <>
                    <button onClick={then(close, () => add.onCustom())} className={menuItem}>
                      Add custom line
                    </button>
                    <button onClick={then(close, () => add.onHeading())} className={menuItem}>
                      Add heading
                    </button>
                    {onRemove && (
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button onClick={then(close, onRemove)} className={`${menuItem} text-fault-ink`}>
                          Remove subproject
                        </button>
                      </div>
                    )}
                  </>
                )}
              </MoreMenu>
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

function GroupRows({
  group,
  priceNotes,
  cols,
  canEdit,
  showPrices,
  jobDone,
  steps,
  section,
  searching,
  dnd,
  selected,
  kitOpen,
  onKit,
  onTick,
  onTickAll,
  onToggle,
  onRename,
  onRemoveGroup,
  add,
  quick,
  onPatch,
  onRemove,
}: {
  group: GroupModel;
  priceNotes: Map<string, string>;
  cols: Cols;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
  steps: TrackingStep[] | null;
  section: string;
  searching: boolean;
  dnd: Dnd;
  selected: Set<string>;
  kitOpen: (line: JobLineView) => boolean;
  onKit: (id: string) => void;
  onTick: (id: string, e: MouseEvent) => void;
  onTickAll: () => void;
  onToggle: () => void;
  onRename: (to: string) => void;
  onRemoveGroup: () => void;
  add: AddActions;
  // The type-to-add box, when the list can be changed.
  quick: ReactNode;
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
}) {
  const ticked = group.top.filter((l) => selected.has(l.id)).length;
  const label = group.name || "No heading";
  const named = group.name !== "";
  const cell = "border-b border-gray-200 pt-3 pb-1.5 align-bottom";
  return (
    <>
      {group.header && (
        <tr
          {...dnd.row({ type: "heading", section, group: group.name })}
          data-row={group.key}
          className={`group/row scroll-mt-24 bg-white ${dnd.cls(group.key)}`}
        >
          {cols.lead && (
            <td className={`${cell} pl-2`}>
              <span className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  aria-label={`Select everything under ${label}`}
                  checked={group.top.length > 0 && ticked === group.top.length}
                  ref={(el) => {
                    if (el) el.indeterminate = ticked > 0 && ticked < group.top.length;
                  }}
                  disabled={group.top.length === 0}
                  onChange={onTickAll}
                />
                {named && <DragHandle {...dnd.handle(group.key)} className={ON_HOVER} />}
              </span>
            </td>
          )}
          <td colSpan={2} className={`${cell} ${cols.lead ? "pr-2" : "pl-3 pr-2"}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <FoldButton open={!group.collapsed} onClick={onToggle} label={label} />
              {canEdit && named ? (
                <InlineText
                  value={group.name}
                  onCommit={onRename}
                  className="font-semibold text-[14px] text-gray-900 min-w-16 max-w-full field-sizing-content border-transparent hover:border-gray-300 bg-transparent"
                />
              ) : (
                <span className={named ? "font-semibold text-[14px] text-gray-900 truncate px-1.5" : "font-medium text-gray-500 px-1.5"}>{label}</span>
              )}
              <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{plural(group.top.length, "item")}</span>
            </div>
          </td>
          <td className={`${cell} px-2`}>
            <ShortCount n={group.short} />
          </td>
          {cols.steps && <td className={`${cell} px-2`}>{steps && <TrackingStatus progress={linesProgress(steps, group.lines)} />}</td>}
          {cols.prices && (
            <>
              <td className={`${cell} hidden md:table-cell`} colSpan={2} />
              <td className={`${cell} px-2 text-right tabular-nums font-medium text-gray-700 whitespace-nowrap`}>
                {showPrices && group.lines.length > 0 ? nzd(group.subtotal) : ""}
              </td>
            </>
          )}
          {cols.actions && (
            <td className={`${cell} pr-2 text-right whitespace-nowrap`}>
              <span className="inline-flex items-center">
                <MoreMenu label={`${label} options`} className={ON_HOVER}>
                  {(close) => (
                    <>
                      <button onClick={then(close, () => add.onCustom())} className={menuItem}>
                        Add custom line here
                      </button>
                      {named && (
                        <div className="border-t border-gray-100 mt-1 pt-1">
                          <button onClick={then(close, () => onRemoveGroup())} className={`${menuItem} text-fault-ink`}>
                            Remove heading
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </MoreMenu>
              </span>
            </td>
          )}
        </tr>
      )}
      {!group.collapsed && group.lines.length === 0 && !searching && (
        <tr {...dnd.row({ type: "empty", section, group: group.name })} data-row={emptyKey(section, group.name)} className={dnd.cls(emptyKey(section, group.name))}>
          {quick ? (
            <QuickCells cols={cols} indent={group.header}>
              {quick}
            </QuickCells>
          ) : (
            <td colSpan={cols.count} className={`py-2 text-xs text-gray-400 ${cols.lead ? "pl-[4.75rem]" : "pl-10"}`}>
              Nothing here yet.
            </td>
          )}
        </tr>
      )}
      {group.rows.map((line) => {
        const kids = line.parentLine ? [] : group.lines.filter((l) => l.parentLine === line.id);
        const contents = kids;
        return (
          <LineRow
            key={line.id}
            line={line}
            cols={cols}
            canEdit={canEdit}
            jobDone={jobDone}
            steps={steps}
            indent={group.header}
            kitLines={line.item?.kind === "kit" ? kids : undefined}
            contents={contents.length}
            open={contents.length > 0 && (kitOpen(line) || (searching && group.rows.includes(contents[0])))}
            onKit={() => onKit(line.id)}
            section={section}
            group={group.name}
            priceNote={priceNotes.get(line.id)}
            dnd={dnd}
            ticked={selected.has(line.id)}
            onTick={(e) => onTick(line.id, e)}
            onPatch={onPatch}
            onRemove={onRemove}
          />
        );
      })}
      {quick && !group.collapsed && group.lines.length > 0 && (
        <tr>
          <QuickCells cols={cols} indent={group.header}>
            {quick}
          </QuickCells>
        </tr>
      )}
    </>
  );
}

// The type-to-add box's row, lined up with the item names above it.
function QuickCells({ cols, indent, children }: { cols: Cols; indent: boolean; children: ReactNode }) {
  return (
    <>
      {cols.lead && <td />}
      <td colSpan={cols.count - (cols.lead ? 1 : 0)} className={`py-1 ${(cols.lead ? ["pl-1", "pl-7"] : ["pl-4", "pl-10"])[indent ? 1 : 0]}`}>
        {children}
      </td>
    </>
  );
}

function LineRow({
  line,
  cols,
  canEdit,
  jobDone,
  steps,
  indent,
  kitLines,
  contents,
  open,
  onKit,
  section,
  group,
  priceNote,
  dnd,
  ticked,
  onTick,
  onPatch,
  onRemove,
}: {
  line: JobLineView;
  cols: Cols;
  canEdit: boolean;
  jobDone: boolean;
  steps: TrackingStep[] | null;
  // Under a heading row, so set in from it.
  indent: boolean;
  // A kit's contents, whose tracking is the kit's.
  kitLines?: JobLineView[];
  // How many lines are inside it, and whether they're showing.
  contents: number;
  open: boolean;
  onKit: () => void;
  section: string;
  group: string;
  // Why its price stands out, if it does.
  priceNote?: string;
  dnd: Dnd;
  ticked: boolean;
  onTick: (e: MouseEvent) => void;
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
}) {
  const isChild = Boolean(line.parentLine);
  const isCustom = line.lineType === "custom";
  const amount = line.amount;
  const level = (indent ? 1 : 0) + (isChild ? 1 : 0);
  const pad = (cols.lead ? ["pl-1", "pl-7", "pl-13"] : ["pl-4", "pl-10", "pl-16"])[level];

  return (
    <tr
      {...dnd.row(isChild ? { type: "child", section, group, parent: line.parentLine! } : { type: "line", section, group, line })}
      className={`group/row border-b border-gray-100 ${ticked ? "bg-signal-soft/50" : "bg-white hover:bg-gray-50/70"} ${isChild ? "text-gray-600" : "text-gray-900"} ${dnd.cls(line.id, line.parentLine || undefined)}`}
    >
      {cols.lead && (
        <td className="pl-2 py-1">
          {canEdit && !isChild && (
            <span className="flex items-center gap-0.5">
              <input
                type="checkbox"
                checked={ticked}
                onChange={() => {}}
                onClick={onTick}
                aria-label={`Select ${line.name}`}
                className="shrink-0"
              />
              <DragHandle {...dnd.handle(line.id)} className={ON_HOVER} />
            </span>
          )}
        </td>
      )}
      <td data-col={isCustom ? "desc" : undefined} className={`py-1 pr-2 ${pad}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {isChild && <span className="text-gray-300 shrink-0">↳</span>}
          {isCustom && canEdit ? (
            <InlineText value={line.description} onCommit={(description) => onPatch(line, { description })} className={`flex-1 min-w-0 -ml-1.5 ${QUIET}`} />
          ) : line.item ? (
            <Link to={`/inventory/${line.item.id}`} className={`truncate min-w-8 hover:underline ${isChild ? "" : "font-medium"}`}>
              {line.name}
            </Link>
          ) : (
            <span className="truncate">{line.name}</span>
          )}
          {line.item?.code && <span className="text-[11px] text-gray-400 font-mono min-w-0 truncate shrink-[100]">{line.item.code}</span>}
          {contents > 0 && (
            <button
              onClick={onKit}
              aria-expanded={open}
              className="inline-flex items-center gap-0.5 text-[11px] text-gray-500 hover:text-gray-900 shrink-0 rounded px-1 hover:bg-gray-100"
            >
              <Caret className={`w-3.5 h-3.5 text-current transition-transform ${open ? "" : "-rotate-90"}`} />
              {line.item?.kind === "kit" ? `Kit · ${plural(contents, "item")}` : `+ ${contents} ${contents === 1 ? "accessory" : "accessories"}`}
            </button>
          )}
        </div>
      </td>
      <td data-col="qty" className="px-2 py-1 text-right">
        {canEdit && !isChild ? (
          <InlineNumber
            value={line.quantity}
            min={isCustom ? 0 : 1}
            step={isCustom ? undefined : 1}
            onCommit={(quantity) => onPatch(line, { quantity })}
            className={`w-14 ${QUIET}`}
          />
        ) : (
          <span className="tabular-nums" title={isChild ? `${line.perParent} per parent` : undefined}>
            {line.quantity}
          </span>
        )}
      </td>
      <td className="px-2 py-1 whitespace-nowrap">
        <AvailabilityCell line={line} jobDone={jobDone} />
      </td>
      {cols.steps && (
        <td className="px-2 py-1">
          {steps && (
            <TrackingStatus
              progress={kitLines ? linesProgress(steps, kitLines) : line.tracking ? progressOf(steps, line.tracking.at, Math.round(line.quantity)) : null}
            />
          )}
        </td>
      )}
      {cols.prices && (
        <>
          <td data-col="rate" className="px-2 py-1 text-right whitespace-nowrap hidden md:table-cell">
            {priceNote && (
              <span title={priceNote} aria-label={priceNote} className="inline-flex align-middle p-1 cursor-help">
                <span className="status-dot bg-warn" />
              </span>
            )}
            {canEdit && line.lineType !== "component" ? (
              <InlineNumber value={line.unitPrice ?? 0} step={0.01} onCommit={(unitPrice) => onPatch(line, { unitPrice })} className={`field-sizing-content min-w-8 max-w-20 ${QUIET} ${line.unitPrice ? "" : "text-gray-400"}`} />
            ) : (
              <span className="tabular-nums text-gray-400">{line.unitPrice ? nzd(line.unitPrice) : "incl."}</span>
            )}
            {canEdit && line.lineType !== "component" ? (
              <ModeMenu value={line.priceMode} label={`How ${line.name} is charged`} onChange={(priceMode) => onPatch(line, { priceMode })} />
            ) : (
              <span className="ml-0.5 inline-block w-9 text-center text-[11px] text-gray-400">{line.unitPrice ? MODE_SUFFIX[line.priceMode] : ""}</span>
            )}
          </td>
          <td data-col="disc" className="px-2 py-1 text-right hidden md:table-cell">
            {canEdit && line.lineType !== "component" ? (
              <InlineNumber
                value={line.discountPct ?? 0}
                min={0}
                max={100}
                onCommit={(discountPct) => onPatch(line, { discountPct })}
                className={`w-16 ${QUIET} ${line.discountPct ? "" : "text-gray-400"}`}
              />
            ) : null}
          </td>
          <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${amount?.net ? "" : "text-gray-400"}`}>
            {amount && amount.discount !== 0 && <span className="text-gray-400 line-through mr-1.5 text-xs">{nzd(amount.gross)}</span>}
            {amount && (amount.net !== 0 || !isChild) ? nzd(amount.net) : ""}
          </td>
        </>
      )}
      {cols.actions && (
        <td className="pr-2 py-1 text-right whitespace-nowrap">
          {canEdit && !isChild && (
            <MoreMenu label={`${line.name} options`} className={ON_HOVER}>
              {(close) => (
                <button onClick={then(close, () => onRemove(line))} className={`${menuItem} text-fault-ink`}>
                  Remove
                </button>
              )}
            </MoreMenu>
          )}
        </td>
      )}
    </tr>
  );
}
