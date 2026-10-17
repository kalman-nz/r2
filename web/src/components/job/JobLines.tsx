import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type JobLineView, type JobSummary, type LinePatch, type NewLine } from "../../lib/api";
import { nzd } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { InlineNumber, InlineText } from "../InlineInput";
import ItemPicker from "../ItemPicker";
import Modal from "../Modal";
import Field from "../Field";
import NumberInput from "../NumberInput";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";

// Done jobs don't hold stock, so availability isn't worked out for them.
function AvailabilityCell({ line, jobDone }: { line: JobLineView; jobDone: boolean }) {
  if (line.lineType === "custom" || jobDone) return <span className="text-gray-300">—</span>;
  if (line.item?.kind === "kit") {
    return line.componentsShort ? (
      <span className="text-[#fc3465] font-medium" title="One or more of this kit's contents is short — see the lines below">
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
        ? `${a.free} free for these dates. ${a.shortFirm === 0 ? "Fine" : `Short ${a.shortFirm}`} if pencilled holds on other jobs are released.`
        : `${a.free} free for these dates.`;
    return (
      <span className="inline-flex flex-col leading-tight" title={title}>
        <span className="inline-flex items-center gap-1.5 text-[#fc3465] font-medium">
          <span className="status-dot bg-[#fc3465]" />
          Short {a.short}
        </span>
        {a.shortFirm < a.short && (
          <span className="text-[11px] text-amber-600 pl-3">{a.shortFirm === 0 ? "only pencilled clashes" : `${a.shortFirm} if pencils drop`}</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600" title={`${a.free} free for these dates, ${a.needed} on this job`}>
      <span className="status-dot bg-[#16d590]" />
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
  const [priceMode, setPriceMode] = useState<"fixed" | "per_day">("fixed");
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
              <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as "fixed" | "per_day")} className="input py-2">
                <option value="fixed">Once (flat)</option>
                <option value="per_day">Per hire day, like equipment</option>
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

export default function JobLines({
  summary,
  canEdit,
  onSummary,
}: {
  summary: JobSummary;
  canEdit: boolean;
  onSummary: (summary: JobSummary) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [addingCustom, setAddingCustom] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { job, lines } = summary;
  const jobDone = job.status === "returned" || job.status === "cancelled";
  const showPrices = summary.includesPrices;

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
    onSummary(await api.addLine(job.id, { itemId, quantity }));
  }

  async function addCustom(line: NewLine) {
    try {
      onSummary(await api.addLine(job.id, line));
    } catch (err) {
      showToast("error", `Couldn't add: ${errorText(err)}`);
      throw err;
    }
  }

  // Renaming a heading moves every top-level line under it; their
  // auto-added lines follow on the server.
  async function renameGroup(from: string, to: string) {
    let latest: JobSummary | null = null;
    try {
      for (const line of lines.filter((l) => !l.parentLine && l.group === from)) {
        latest = await api.updateLine(line.id, { group: to });
      }
      if (latest) onSummary(latest);
    } catch (err) {
      showToast("error", `Couldn't rename: ${errorText(err)}`);
    }
  }

  async function move(line: JobLineView, direction: -1 | 1) {
    const siblings = lines.filter((l) => !l.parentLine && l.group === line.group);
    const index = siblings.findIndex((l) => l.id === line.id);
    const other = siblings[index + direction];
    if (!other) return;
    await run(async () => {
      if (line.sortOrder === other.sortOrder) return api.updateLine(line.id, { sortOrder: line.sortOrder + direction });
      await api.updateLine(line.id, { sortOrder: other.sortOrder });
      return api.updateLine(other.id, { sortOrder: line.sortOrder });
    }, "Couldn't reorder");
  }

  // Lines arrive ordered parent-then-children; bucket them by heading in
  // first-seen order.
  const groups: { name: string; lines: JobLineView[] }[] = [];
  const parentGroup = new Map<string, string>();
  for (const line of lines) {
    const name = line.parentLine ? (parentGroup.get(line.parentLine) ?? line.group) : line.group;
    if (!line.parentLine) parentGroup.set(line.id, name);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, lines: [] }));
    group.lines.push(line);
  }
  const groupNames = groups.map((g) => g.name).filter(Boolean);
  const columns = showPrices ? 7 : 3;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-500">Equipment & services ({lines.filter((l) => !l.parentLine).length})</h2>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setAddingCustom(true)} className="btn-secondary">
              Custom line
            </button>
            <button onClick={() => setPicking(true)} className="btn-primary">
              Add equipment
            </button>
          </div>
        )}
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
          <tbody>
            {groups.map((group) => (
              <GroupRows
                key={group.name || "(none)"}
                group={group}
                columns={columns}
                canEdit={canEdit}
                showPrices={showPrices}
                jobDone={jobDone}
                onRenameGroup={renameGroup}
                onPatch={patch}
                onRemove={remove}
                onMove={move}
              />
            ))}
          </tbody>
        </table>
        {lines.length === 0 && (
          <p className="px-4 py-8 text-gray-500 text-sm text-center">
            Nothing on this job yet.{canEdit ? " Add equipment to see availability and pricing." : ""}
          </p>
        )}
      </div>

      {picking && <ItemPicker jobId={job.id} start={job.prepAt} end={job.returnAt} onAdd={addItem} onClose={() => setPicking(false)} />}
      {addingCustom && <CustomLineModal groups={groupNames} showPrices={showPrices} onAdd={addCustom} onClose={() => setAddingCustom(false)} />}
    </section>
  );
}

function GroupRows({
  group,
  columns,
  canEdit,
  showPrices,
  jobDone,
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
  onPatch,
  onRemove,
  onMove,
}: {
  line: JobLineView;
  canEdit: boolean;
  showPrices: boolean;
  jobDone: boolean;
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
          {isCustom && line.priceMode === "per_day" && <span className="text-[11px] text-gray-400 shrink-0">per day</span>}
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
