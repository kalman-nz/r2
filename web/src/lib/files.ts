import { useQuery } from "@tanstack/react-query";
import type { RecordModel } from "pocketbase";
import { pb } from "./pocketbase";
import type { FileInfo } from "./api";

// Files on repairs and maintenance jobs are protected
// (pb_hooks/lib/files.js): opening one needs a short-lived file token
// (PocketBase's lasts a few minutes), so keep a fresh one while they're on
// screen.
export function useFileToken(enabled = true) {
  return useQuery({
    queryKey: ["file-token"],
    queryFn: () => pb.files.getToken(),
    enabled,
    staleTime: 90_000,
    refetchInterval: 90_000,
  }).data;
}

export function fileUrl(record: RecordModel, stored: string, token: string | undefined, thumb?: string): string {
  return pb.files.getURL(record, stored, { token: token ?? "", ...(thumb ? { thumb } : {}) });
}

// The name it was uploaded with; PocketBase stores "photo_k3j2h1g4f5.jpg".
export function fileName(stored: string, info: FileInfo | null | undefined): string {
  return info?.[stored]?.name || stored.replace(/_[a-z0-9]{10}(\.[^.]*)?$/i, "$1");
}

// PocketBase makes thumbnails of these.
export function isImage(stored: string): boolean {
  return /\.(jpe?g|png|gif|webp)$/i.test(stored);
}

export function fileKind(stored: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(stored)?.[1]?.toLowerCase() ?? "";
  if (ext === "pdf") return "PDF";
  if (["doc", "docx", "odt", "rtf", "pages"].includes(ext)) return "DOC";
  if (["xls", "xlsx", "ods", "csv", "numbers"].includes(ext)) return "XLS";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"].includes(ext)) return "IMG";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "VID";
  return ext ? ext.toUpperCase().slice(0, 4) : "FILE";
}

export function formatBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
