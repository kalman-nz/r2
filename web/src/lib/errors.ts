import { ClientResponseError } from "pocketbase";

// A readable one-liner for a failed request. PocketBase reports field-level
// problems (a blank required field, a duplicate barcode) in response.data
// under a generic "Failed to create record." message, so spell those out.
export function errorText(err: unknown): string {
  if (err instanceof ClientResponseError) {
    const data = (err.response?.data ?? {}) as Record<string, { message?: string }>;
    const fields = Object.entries(data)
      .filter(([, v]) => v && typeof v.message === "string")
      .map(([field, v]) => `${field}: ${v.message}`);
    if (fields.length > 0) return fields.join(" · ");
    return err.response?.message || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
