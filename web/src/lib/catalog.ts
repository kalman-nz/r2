import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { Category, Contact, CustomField, Location, Venue } from "./api";
import { orgFilter } from "./currentOrg";

// Shared react-query hooks for the small lists most pages need (dropdowns,
// names for ids). Query keys match the collection names, so invalidating
// ["contacts"] after an edit refreshes every dropdown too.

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => pb.collection("categories").getFullList<Category>({ filter: orgFilter(), sort: "sortOrder,name" }),
  });
}

// The organisation's custom fields for items, in the order they're shown.
// Under the ["customFields"] prefix the importer refreshes.
export function useItemCustomFields() {
  return useQuery({
    queryKey: ["customFields", "item"],
    queryFn: () => pb.collection("custom_fields").getFullList<CustomField>({ filter: orgFilter('appliesTo = "item"'), sort: "sortOrder,label" }),
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => pb.collection("locations").getFullList<Location>({ filter: orgFilter(), sort: "name" }),
  });
}

export function useContacts() {
  return useQuery({
    queryKey: ["contacts"],
    queryFn: () => pb.collection("contacts").getFullList<Contact>({ filter: orgFilter(), sort: "name" }),
  });
}

export function useVenues() {
  return useQuery({
    queryKey: ["venues"],
    queryFn: () => pb.collection("venues").getFullList<Venue>({ filter: orgFilter(), sort: "name" }),
  });
}

// id -> "Audio/Speakers". Slash-separated so a label's equipmentFolder
// field can pick levels out of it (see applyFolderLevels in labelSpec.ts).
export function buildCategoryPaths(categories: Category[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const paths = new Map<string, string>();
  for (const c of categories) {
    const names: string[] = [];
    const seen = new Set<string>();
    let current: Category | undefined = c;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parent ? byId.get(current.parent) : undefined;
    }
    paths.set(c.id, names.join("/"));
  }
  return paths;
}

export function useCategoryPaths() {
  const { data: categories = [] } = useCategories();
  return useMemo(() => buildCategoryPaths(categories), [categories]);
}

// Readable form of a category path for screens ("Audio / Speakers").
export function displayPath(path: string | undefined): string {
  return path ? path.split("/").join(" / ") : "";
}
