import { useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "./ToastProvider";

// A handheld barcode/QR scanner acts like a keyboard: it types the scanned
// value into whatever's focused, then sends Enter. This stays enabled the
// whole time (never disabled while a lookup is in flight) and clears
// itself immediately on submit, before the network call — so rapid
// back-to-back scans never get dropped or concatenated into each other
// waiting on a slow one.
//
// Submit is wired directly to the input's Enter keydown rather than relying
// on native <form> submit-on-Enter — that behavior isn't reliably triggered
// by every browser/on-screen-keyboard/HID scanner combination.
export default function ScanInput() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  async function submit(q: string) {
    setValue("");
    try {
      const { id } = await api.searchAssets(q);
      navigate(`/assets/${id}`);
    } catch {
      showToast("error", `No asset found for "${q}"`);
    } finally {
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    submit(q);
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Scan or type serial…"
      className="input w-56"
    />
  );
}
