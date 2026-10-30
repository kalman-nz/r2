import { useRef, useState, type DragEvent } from "react";
import type { RecordModel } from "pocketbase";
import type { FileInfo } from "../lib/api";
import { errorText } from "../lib/errors";
import { fileKind, fileName, fileUrl, formatBytes, isImage, useFileToken } from "../lib/files";
import { formatDate } from "../lib/format";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";

type WithFiles = RecordModel & { files: string[]; fileInfo: FileInfo | null };

// A record's files, in any format: photos of the damage, a repairer's
// report, quotes, invoices, POs, certificates. Drop them on the card or pick
// them (phones offer the camera too); each uploads on its own, so one too
// big doesn't stop the rest. Opening one needs a file token, kept fresh by
// useFileToken.
export default function FilesCard<T extends WithFiles>({
  record,
  canEdit,
  upload,
  remove,
  onChanged,
  hint = "",
}: {
  record: T;
  canEdit: boolean;
  upload: (file: File) => Promise<T>;
  remove: (stored: string) => Promise<T>;
  onChanged: (record: T) => void;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { showToast } = useToast();
  const confirm = useConfirm();
  const token = useFileToken(record.files.length > 0);
  // Thumbnails keep the token they loaded with, so they don't all reload
  // each time it's renewed; links always take the latest.
  const thumbToken = useRef<{ files: string; token: string }>({ files: "", token: "" });
  const filesKey = record.files.join("/");
  if (token && (thumbToken.current.files !== filesKey || !thumbToken.current.token)) thumbToken.current = { files: filesKey, token };

  async function add(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    let latest: T | null = null;
    let failed = 0;
    for (const [i, file] of files.entries()) {
      setProgress({ done: i, total: files.length, name: file.name });
      try {
        latest = await upload(file);
      } catch (err) {
        failed++;
        showToast("error", `Couldn't add ${file.name}: ${errorText(err)}`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    if (latest) onChanged(latest);
    if (failed < files.length) showToast("success", files.length - failed === 1 ? "File added" : `${files.length - failed} files added`);
  }

  async function drop(stored: string) {
    const name = fileName(stored, record.fileInfo);
    const ok = await confirm({ title: "Remove file", message: `Remove ${name}? It's deleted for good.`, confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      onChanged(await remove(stored));
      showToast("success", `Removed ${name}`);
    } catch (err) {
      showToast("error", `Couldn't remove ${name}: ${errorText(err)}`);
    }
  }

  const onDrag = (e: DragEvent, over: boolean) => {
    if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(over);
  };

  return (
    <section
      className={`card p-4 flex flex-col gap-3 text-sm transition-colors ${dragging ? "ring-2 ring-data bg-data-soft/40" : ""}`}
      onDragOver={(e) => onDrag(e, true)}
      onDragLeave={(e) => onDrag(e, false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDragging(false);
        add(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow text-gray-500">Files{record.files.length > 0 && ` (${record.files.length})`}</h2>
        {canEdit && (
          <button onClick={() => input.current?.click()} disabled={!!progress} className="btn-secondary py-1">
            Add files
          </button>
        )}
      </div>

      {record.files.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {record.files.map((stored) => {
            const info = record.fileInfo?.[stored];
            const name = fileName(stored, record.fileInfo);
            const meta = [formatBytes(info?.size), info?.by, info?.at && formatDate(info.at)].filter(Boolean).join(" · ");
            return (
              <li key={stored} className="group relative flex flex-col gap-1 min-w-0">
                <a
                  href={token ? fileUrl(record, stored, token) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-[4/3] rounded-md border border-gray-200 bg-gray-50 overflow-hidden hover:border-gray-400"
                  title={`Open ${name}`}
                >
                  {isImage(stored) && thumbToken.current.token ? (
                    <img src={fileUrl(record, stored, thumbToken.current.token, "200x200")} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center">
                      <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-white border border-gray-200 text-gray-600">{fileKind(stored)}</span>
                    </span>
                  )}
                </a>
                <span className="text-[13px] text-gray-900 truncate" title={name}>
                  {name}
                </span>
                {meta && <span className="text-[11px] text-gray-400 truncate">{meta}</span>}
                {canEdit && (
                  <button
                    onClick={() => drop(stored)}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-fault-ink text-sm leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    aria-label={`Remove ${name}`}
                    title="Remove"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {progress ? (
        <p className="text-xs text-gray-600">
          Uploading {progress.total > 1 ? `${progress.done + 1} of ${progress.total}: ` : ""}
          {progress.name}…
        </p>
      ) : canEdit ? (
        <p className="text-xs text-gray-400">{record.files.length === 0 ? `Drop files here, or Add files. ${hint}`.trim() : "Drop more files here to add them."}</p>
      ) : (
        record.files.length === 0 && <p className="text-xs text-gray-400">No files.</p>
      )}
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
    </section>
  );
}
