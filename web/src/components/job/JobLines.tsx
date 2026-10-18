import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type JobLineView, type JobSummary, type LinePatch, type NewLine, type PriceMode } from "../../lib/api";
import { formatPeriod, nzd, MODE_SUFFIX } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { InlineNumber, InlineText } from "../InlineInput";
import ItemPicker from "../ItemPicker";
import Modal from "../Modal";
import Field from "../Field";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";
import NewSubprojectModal from "./NewSubprojectModal";

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
  showPrices,
  onAdd,
  onClose,
}: {
  groups: string[];
  showPrices: boolean;
  onAdd: (line: NewLine) => Promise<void>;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [priceMode, setPriceMode] = useState<PriceMode>("fixed");
  const [group, setGroup] = useState("");
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
      <p className="text-xs text-gray-500 -mt-2">
        For anything that isn't inventory: delivery, labour, a sale item, a credit (use a negative price).
      </p>
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

export default function JobLines({
  summary,
  canEdit,
  onSummary,
}: {
  summary: JobSummary;
  canEdit: boolean;
  onSummary: (summary: JobSummary) => void;
}) {
  // The section being added to: an id ("" for the main project), or null.
  const [picking, setPicking] = useState<string | null>(null);
  const [addingCustom, setAddingCustom] = useState<string | null>(null);
  const [addingSubproject, setAddingSubproject] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { job, lines, subprojects = [] } = summary;
  const jobDone = job.status === "returned" || job.status === "cancelled";
  const showPrices = summary.includesPrices;

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
    onSummary(await api.addLine(job.id, { itemId, quantity, subproject: picking ?? "" }));
  }

  async function addCustom(line: NewLine) {
    try {
      onSummary(await api.addLine(job.id, { ...line, subproject: addingCustom ?? "" }));
    } catch (err) {
      showToast("error", `Couldn't add: ${errorText(err)}`);
      throw err;
    }
  }

  // Renaming a heading moves every top-level line under it (in the same
  // section); their auto-added lines follow on the server.
  async function renameGroup(section: string, from: string, to: string) {
    let latest: JobSummary | null = null;
    try {
      for (const line of lines.filter((l) => !l.parentLine && l.subproject === section && l.group === from)) {
        latest = await api.updateLine(line.id, { group: to });
      }
      if (latest) onSummary(latest);
    } catch (err) {
      showToast("error", `Couldn't rename: ${errorText(err)}`);
    }
  }

  async function move(line: JobLineView, direction: -1 | 1) {
    const siblings = lines.filter((l) => !l.parentLine && l.subproject === line.subproject && l.group === line.group);
    const index = siblings.findIndex((l) => l.id === line.id);
    const other = siblings[index + direction];
    if (!other) return;
    await run(async () => {
      if (line.sortOrder === other.sortOrder) return api.updateLine(line.id, { sortOrder: line.sortOrder + direction });
      await api.updateLine(line.id, { sortOrder: other.sortOrder });
      return api.updateLine(other.id, { sortOrder: line.sortOrder });
    }, "Couldn't reorder");
  }

  const groupNames = [...new Set(lines.map((l) => l.group).filter(Boolean))];
  const columns = showPrices ? 7 : 3;
  const split = subprojects.length > 0;
  const addButtons = (section: string) =>
    canEdit && (
      <div className="flex items-center gap-1.5">
        <button onClick={() => setAddingCustom(section)} className="btn-secondary">
          Custom line
        </button>
        <button onClick={() => setPicking(section)} className="btn-primary">
          Add equipment
        </button>
      </div>
    );
  const pickingSection = picking === null ? null : sectionById(picking);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-500">Equipment & services ({lines.filter((l) => !l.parentLine).length})</h2>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <button onClick={() => setAddingSubproject(true)} className="btn-secondary" title="Part of the project with its own booking and billing times">
              Add subproject
            </button>
          )}
          {!split && addButtons("")}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-y border-gray-200 text-left text-gray-500 bg-gray-50/60">
              <th className="px-4 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium text-right w-16">Qty</th>
              <th className="px-2 py-1.5 font-medium w-36">Availability</th>
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
                {groupsOf(own).map((group) => (
                  <GroupRows
                    key={group.name || "(none)"}
                    group={group}
                    columns={columns}
                    canEdit={canEdit}
                    showPrices={showPrices}
                    jobDone={jobDone}
                    sections={split ? sections : []}
                    onRenameGroup={(from, to) => renameGroup(section.id, from, to)}
                    onPatch={patch}
                    onRemove={remove}
                    onMove={move}
                  />
                ))}
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
        {lines.length === 0 && !split && (
          <p className="px-4 py-8 text-gray-500 text-sm text-center">
            Nothing on this project yet.{canEdit ? " Add equipment to see availability and pricing." : ""}
          </p>
        )}
      </div>

      {pickingSection && (
        <ItemPicker jobId={job.id} start={pickingSection.prepAt} end={pickingSection.returnAt} onAdd={addItem} onClose={() => setPicking(null)} />
      )}
      {addingCustom !== null && (
        <CustomLineModal groups={groupNames} showPrices={showPrices} onAdd={addCustom} onClose={() => setAddingCustom(null)} />
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
  sections,
  onRenameGroup,
  onPatch,
  onRemove,
  onMove,
}: {
  group: { name: string; lines: JobLineView[] };
  columns: number;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
  sections: Section[];
  onRenameGroup: (from: string, to: string) => void;
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
  onMove: (line: JobLineView, direction: -1 | 1) => void;
}) {
  const subtotal = group.lines.reduce((sum, l) => sum + (l.amount?.net ?? 0), 0);
  return (
    <>
      <tr className="border-b border-gray-100">
        <td colSpan={columns} className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between gap-3">
            {canEdit ? (
              <InlineText
                value={group.name}
                onCommit={(to) => onRenameGroup(group.name, to)}
                placeholder="No heading"
                className="font-semibold text-gray-800 w-64 border-transparent hover:border-gray-300 bg-transparent"
              />
            ) : (
              <span className="font-semibold text-gray-800">{group.name || "Other"}</span>
            )}
            {showPrices && <span className="text-xs text-gray-500 tabular-nums">{nzd(subtotal)}</span>}
          </div>
        </td>
      </tr>
      {group.lines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          canEdit={canEdit}
          showPrices={showPrices}
          jobDone={jobDone}
          sections={sections}
          onPatch={onPatch}
          onRemove={onRemove}
          onMove={onMove}
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
  sections,
  onPatch,
  onRemove,
  onMove,
}: {
  line: JobLineView;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
  // Where the line can be moved to; empty without subprojects.
  sections: Section[];
  onPatch: (line: JobLineView, patch: LinePatch) => void;
  onRemove: (line: JobLineView) => void;
  onMove: (line: JobLineView, direction: -1 | 1) => void;
}) {
  const isChild = Boolean(line.parentLine);
  const isCustom = line.lineType === "custom";
  const amount = line.amount;

  return (
    <tr className={`border-b border-gray-50 hover:bg-gray-50/60 ${isChild ? "text-gray-600" : ""}`}>
      <td className={`py-1.5 pr-2 ${isChild ? "pl-9" : "pl-4"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
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
                {!isChild && sections.length > 0 && (
                  // An icon with the real select laid invisibly over it.
                  <span className="relative px-0.5 hover:text-gray-700" title="Move to the main project or a subproject">
                    ⇄
                    <select
                      value={line.subproject}
                      onChange={(e) => onPatch(line, { subproject: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      aria-label="Move to"
                    >
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </span>
                )}
                {!isChild && (
                  <>
                    <button onClick={() => onMove(line, -1)} className="hover:text-gray-700 px-0.5" title="Move up">
                      ↑
                    </button>
                    <button onClick={() => onMove(line, 1)} className="hover:text-gray-700 px-0.5" title="Move down">
                      ↓
                    </button>
                  </>
                )}
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
