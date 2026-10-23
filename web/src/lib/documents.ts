import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import { orgFilter } from "./currentOrg";
import type { DocumentEquipment, DocumentFieldType, DocumentTemplate, JobLineView } from "./api";

// Project documents (pb_hooks/lib/documents.js): the organisation's own
// printable forms, from a project's Documents menu.

export const FIELD_TYPES: { value: DocumentFieldType; label: string; hint: string }[] = [
  { value: "heading", label: "Heading", hint: "Starts a new section" },
  { value: "note", label: "Instructions", hint: "Printed text, like a reminder or terms" },
  { value: "text", label: "Short answer", hint: "A line to write on" },
  { value: "textarea", label: "Long answer", hint: "A box of lines to write in" },
  { value: "checkbox", label: "Tick box", hint: "A box to tick" },
  { value: "date", label: "Date and time", hint: "Spaces for a date and time" },
  { value: "signature", label: "Signature", hint: "Name, signature and date" },
];

export const EQUIPMENT_MODES: { value: DocumentEquipment; label: string; hint: string }[] = [
  { value: "none", label: "No equipment", hint: "Just the form" },
  { value: "list", label: "Equipment list", hint: "What's on the project, by heading" },
  { value: "checklist", label: "Checklist", hint: "A box to tick for each item, with where it's kept" },
  { value: "return", label: "Return check", hint: "How many went out, spaces for how many came back, OK and notes" },
];

export function useDocumentTemplates(enabled = true) {
  return useQuery({
    queryKey: ["document-templates"],
    queryFn: () => pb.collection("document_templates").getFullList<DocumentTemplate>({ filter: orgFilter(), sort: "sortOrder,created" }),
    enabled,
    staleTime: 60_000,
  });
}

// A project's physical kit by heading, in project order, with a kit's
// contents under it (custom lines like delivery aren't packed).
export function linesByHeading(all: JobLineView[]): { name: string; lines: JobLineView[] }[] {
  const lines = all.filter((l) => l.lineType !== "custom");
  const groups: { name: string; lines: JobLineView[] }[] = [];
  const parentGroup = new Map<string, string>();
  for (const line of lines) {
    const name = line.parentLine ? (parentGroup.get(line.parentLine) ?? line.group) : line.group;
    if (!line.parentLine) parentGroup.set(line.id, name);
    let group = groups.find((g) => g.name === name);
    if (!group) groups.push((group = { name, lines: [] }));
    group.lines.push(line);
  }
  return groups;
}

// A new part's id, unique within its document.
export const newFieldId = () => Math.random().toString(36).slice(2, 10);
