import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { printRecord } from "../lib/print";
import type { LabelDataContext } from "../lib/labelSpec";
import { useToast } from "./ToastProvider";

export default function PrintButton({
  context,
  rentmanSerialNumberId,
  label = "Print label",
}: {
  context: LabelDataContext;
  rentmanSerialNumberId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { showToast } = useToast();

  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels, enabled: open });

  async function printWith(templateId: string) {
    const template = templates?.find((t) => t.id === templateId);
    if (!template) return;
    setPrinting(true);
    try {
      const result = await printRecord(context, template, rentmanSerialNumberId);
      if (result.ok) {
        showToast("success", "Printed");
      } else {
        showToast("error", `Print failed: ${result.message}`);
      }
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} disabled={printing} className="btn-secondary">
        {printing ? "Printing…" : label}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 card shadow-lg z-10 overflow-hidden">
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
              onClick={() => printWith(t.id)}
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
