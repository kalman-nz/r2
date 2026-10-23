// The fields R2 and Rentman both keep, and how each converts, in one place
// for the import (lib/imports.js) and the live sync (lib/rentmanSync.js).
// Pure (no PocketBase globals), so pocketbase/tests can require it.
//
// Only fields Rentman's API lets R2 write are here, and they go both ways.
// Everything else the import brings in (stock counts, serial numbers,
// addresses, project dates…) only comes in from Rentman.
//
// `refs` converts related records: categoryFor(folderId) → R2 category id,
// folderFor(categoryId) → Rentman folder id.

// Rentman relates records by path, "/folders/12"; accept a bare id too.
function refId(value) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.split("/").pop() || null : null;
}

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const num = (v) => Number(v) || 0;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAPS = {
  // R2 items ↔ Rentman equipment
  items: {
    remoteType: "equipment",
    fromRentman(eq, refs) {
      return {
        name: str(eq.name || eq.displayname) || "Rentman item " + eq.id,
        code: str(eq.code),
        category: (refs && refs.categoryFor(refId(eq.folder))) || "",
        price: num(eq.price),
        weightKg: num(eq.weight),
        powerW: num(eq.power),
        locationInWarehouse: str(eq.location_in_warehouse),
        description: str(eq.external_remark),
        notes: str(eq.internal_remark),
        archived: eq.in_archive === true,
      };
    },
    toRentman(f, refs) {
      const out = {};
      if ("name" in f) out.name = f.name;
      if ("code" in f) out.code = f.code;
      if ("category" in f) {
        const folder = refs && refs.folderFor(f.category);
        if (folder) out.folder = "/folders/" + folder;
      }
      if ("price" in f) out.price = num(f.price);
      if ("weightKg" in f) out.weight = num(f.weightKg);
      if ("powerW" in f) out.power = num(f.powerW);
      if ("locationInWarehouse" in f) out.location_in_warehouse = f.locationInWarehouse;
      if ("description" in f) out.external_remark = f.description;
      if ("notes" in f) out.internal_remark = f.notes;
      if ("archived" in f) out.in_archive = f.archived === true;
      return out;
    },
  },

  // R2 contacts ↔ Rentman contacts (clients). `person` is the contact's
  // first contact person, for an email or phone to fall back on.
  contacts: {
    remoteType: "contacts",
    fromRentman(c, refs, person) {
      const emails = [c.email_1, c.email_2, person && person.email].map(str);
      return {
        name: str(c.displayname || c.name) || "Rentman contact " + c.id,
        kind: c.type === "private" ? "person" : "company",
        email: emails.find((e) => EMAIL.test(e)) || "",
        phone: str(c.phone_1 || c.phone_2 || (person && (person.phone || person.mobilephone))),
      };
    },
    toRentman(f) {
      const out = {};
      if ("name" in f) out.name = f.name;
      if ("kind" in f) out.type = f.kind === "person" ? "private" : "company";
      if ("email" in f) out.email_1 = f.email;
      if ("phone" in f) out.phone_1 = f.phone;
      return out;
    },
  },

  // R2 locations (venues) ↔ the Rentman contacts projects happen at
  venues: {
    remoteType: "contacts",
    fromRentman(c, refs, person) {
      return {
        name: str(c.displayname || c.name) || "Rentman contact " + c.id,
        phone: str(c.phone_1 || c.phone_2 || (person && (person.phone || person.mobilephone))),
      };
    },
    toRentman(f) {
      const out = {};
      if ("name" in f) out.name = f.name;
      if ("phone" in f) out.phone_1 = f.phone;
      return out;
    },
  },
};

// The R2 fields a collection syncs both ways.
function outFields(collection) {
  const map = MAPS[collection];
  if (!map) return [];
  return Object.keys(map.fromRentman({ id: 0 }, { categoryFor: () => "" }));
}

module.exports = { MAPS, refId, outFields, EMAIL };
