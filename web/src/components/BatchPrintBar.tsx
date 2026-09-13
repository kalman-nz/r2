import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { printAsset, type PrintableAsset } from "../lib/print";
import { useToast } from "./ToastProvider";
import NumberInput from "./NumberInput";

export default function BatchPrintBar({
  assets,
  onDone,
}: {
  assets: PrintableAsset[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const { showToast } = useToast();

  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels, enabled: open });

  async function printAllWith(templateId: string) {
    const template = templates?.find((t) => t.id === templateId);
    if (!template) return;
    setOpen(false);
    const failed: string[] = [];
    const total = assets.length * copies;
    setProgress({ done: 0, total, failed });

    // Sequential, not parallel — the printer processes one job at a time and
    // flooding it with concurrent requests risks jobs arriving out of order
    // or overwhelming the network backend.
    let done = 0;
    for (const asset of assets) {
      for (let copy = 0; copy < copies; copy++) {
        try {
          const result = await printAsset(asset, template);
          if (!result.ok) failed.push(asset.displayname ?? String(asset.id));
        } catch {
          failed.push(asset.displayname ?? String(asset.id));
        }
        done++;
        setProgress({ done, total, failed: [...failed] });
      }
    }

    if (failed.length === 0) {
      showToast("success", `Printed ${total} label${total === 1 ? "" : "s"}`);
      setTimeout(() => {
        setProgress(null);
        onDone();
      }, 1500);
    } else {
      showToast("error", `${failed.length}/${total} labels failed to print: ${failed.join(", ")}`);
    }
  }

  if (progress) {
    return (
      <div className="flex items-center gap-3 card px-4 py-2 text-sm text-gray-700">
        <span>
          Printing {progress.done}/{progress.total}…
        </span>
        {progress.failed.length > 0 && (
          <span className="text-red-600">Failed: {progress.failed.join(", ")}</span>
        )}
        {progress.done === progress.total && progress.failed.length > 0 && (
          <button onClick={() => setProgress(null)} className="text-gray-500 hover:text-gray-900 ml-auto">
            Dismiss
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-3 card px-4 py-2 text-sm">
      <span className="font-medium text-gray-900">{assets.length} selected</span>

      <label className="flex items-center gap-2 text-gray-500">
        Copies each
        <NumberInput min={1} value={copies} onChange={setCopies} className="w-14 input py-1" />
      </label>

      <button onClick={() => setOpen((v) => !v)} className="btn-primary">
        Print {assets.length * copies} label{assets.length * copies === 1 ? "" : "s"}
      </button>
      <button onClick={onDone} className="text-gray-500 hover:text-gray-900 ml-auto">
        Clear selection
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-56 card shadow-lg z-10 overflow-hidden">
          {templates === undefined && <p className="px-3 py-3 text-sm text-gray-500">Loading templates…</p>}
          {templates?.length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-500">
              No label templates yet.{" "}
              <Link to="/labels/new" className="text-blue-600 underline">
                Create one
              </Link>
              .
            </p>
          )}
          {templates?.map((t) => (
            <button
              key={t.id}
              onClick={() => printAllWith(t.id)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {t.name}
              <span className="text-gray-500"> · {t.widthMm}×{t.heightMm}mm</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
