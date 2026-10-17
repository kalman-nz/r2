// Spreadsheet → rows, for Settings > Import. Handles what Excel, Numbers
// and Google Sheets actually export: quoted fields with commas, quotes
// ("") and line breaks inside them, CRLF line endings, a UTF-8 BOM, and
// semicolon or tab delimiters (Excel in some locales).
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const firstLine = input.slice(0, input.indexOf("\n") === -1 ? input.length : input.indexOf("\n"));
  const delimiter = [",", ";", "\t"].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully blank lines (trailing newlines, spacer rows).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

// "Day Rate ($)" → "dayrate", for matching headers to fields.
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}
