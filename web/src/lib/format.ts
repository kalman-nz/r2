export function money(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}
