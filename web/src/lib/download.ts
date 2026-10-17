import type { DownloadedFile } from "./api";

// Hands a fetched file to the browser as a download (iOS Safari opens a
// preview with a share button instead, which is what people expect there).
export function saveFile({ blob, filename }: DownloadedFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
