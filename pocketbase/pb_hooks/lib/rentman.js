// Thin typed wrapper around the Rentman public API (https://api.rentman.net).
// Port of the old server/src/rentman/client.ts — same shape, but built on
// PocketBase JSVM's $http.send instead of Node's fetch, and sleep() instead
// of setTimeout for the 429 backoff (JSVM hooks run synchronously, no timers).

const BASE_URL = $os.getenv("RENTMAN_BASE_URL") || "https://api.rentman.net";
const TOKEN = $os.getenv("RENTMAN_API_TOKEN");

if (!TOKEN) {
  console.warn("[rentman] RENTMAN_API_TOKEN is not set — Rentman API calls will fail.");
}

// Same 5-minute window as before — the workshop's poll interval + full
// catalog walks made a shorter TTL expensive; /api/refresh bypasses this.
const CACHE_TTL_MS = 5 * 60000;
const cache = new Map();

function buildUrl(path, searchParams) {
  const base = path.startsWith("http") ? path : BASE_URL.replace(/\/$/, "") + path;
  const params = [];
  for (const key in searchParams || {}) {
    const value = searchParams[key];
    if (value !== undefined && value !== null) {
      params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    }
  }
  if (!params.length) return base;
  return base + (base.indexOf("?") === -1 ? "?" : "&") + params.join("&");
}

function rentmanFetch(path, searchParams) {
  const url = buildUrl(path, searchParams);

  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = $http.send({
      method: "GET",
      url: url,
      headers: {
        Authorization: "Bearer " + TOKEN,
        Accept: "application/json",
      },
    });

    if (res.statusCode === 429 && attempt < maxAttempts) {
      const retryAfterHeader = (res.headers["Retry-After"] || res.headers["retry-after"] || [])[0];
      const retryAfterMs = Number(retryAfterHeader) * 1000 || 500 * Math.pow(2, attempt);
      sleep(retryAfterMs);
      continue;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error("Rentman API " + res.statusCode + " for " + path + ": " + res.raw);
    }

    cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, value: res.json });
    return res.json;
  }
  throw new Error("Rentman API rate limit exceeded for " + path + " after " + maxAttempts + " attempts");
}

function list(resource) {
  return (params) => rentmanFetch("/" + resource, params);
}

function item(resource) {
  return (id) => rentmanFetch("/" + resource + "/" + id).data;
}

// Rentman caps every list request at 1500 items and cursor-paginates beyond
// that (next_page_url) — walk every page rather than just the first.
function listAll(resource) {
  return (params) => {
    const merged = Object.assign({ limit: 1500 }, params || {});
    let page = rentmanFetch("/" + resource, merged);
    const all = page.data.slice();
    while (page.next_page_url) {
      page = rentmanFetch(page.next_page_url);
      all.push.apply(all, page.data);
    }
    return all;
  };
}

const rentman = {
  listEquipment: list("equipment"),
  listAllEquipment: listAll("equipment"),
  getEquipment: item("equipment"),

  listSerialNumbers: list("serialnumbers"),
  listAllSerialNumbers: listAll("serialnumbers"),
  getSerialNumber: item("serialnumbers"),

  listProjects: list("projects"),
  listAllProjects: listAll("projects"),
  getProject: item("projects"),

  listSubprojects: (projectId) => rentmanFetch("/projects/" + projectId + "/subprojects"),

  listProjectEquipment: list("projectequipment"),
  listAllProjectEquipment: listAll("projectequipment"),
  listProjectEquipmentGroups: list("projectequipmentgroup"),
  listAllProjectEquipmentGroups: listAll("projectequipmentgroup"),

  listStockLocations: list("stocklocations"),
  listAllFolders: listAll("folders"),
  listAllStockMovements: listAll("stockmovements"),

  // Rentman relates records by path-style references, e.g. an equipment
  // field like "/equipment/2989" rather than an embedded object or bare id.
  resolveRef: (ref) => {
    if (!ref) return null;
    return rentmanFetch(ref).data;
  },
};

function clearRentmanCache() {
  cache.clear();
}

function idFromRef(ref) {
  return typeof ref === "string" ? ref.split("/").pop() || null : null;
}

// Resolves the "/equipment/123" style reference fields Rentman puts on a
// serial number into the equipment name/code/warehouse location — joins
// against the full equipment/location/folder lists (bulk-fetched once,
// cached) instead of resolving each ref with its own request.
function enrichSerialNumbers(records) {
  const allEquipment = rentman.listAllEquipment();
  const allLocations = rentman.listStockLocations();
  const allFolders = rentman.listAllFolders();

  const equipmentById = new Map(allEquipment.map((e) => [String(e.id), e]));
  const locationById = new Map(allLocations.data.map((l) => [String(l.id), l]));
  const folderById = new Map(allFolders.map((f) => [String(f.id), f]));

  return records.map((r) => {
    const equipment = equipmentById.get(idFromRef(r.equipment) || "") || null;
    return Object.assign({}, r, {
      _equipment: equipment,
      _location: locationById.get(idFromRef(r.asset_location) || "") || null,
      _folder: folderById.get(idFromRef(equipment ? equipment.folder : null) || "") || null,
    });
  });
}

// The bulk /equipment list never populates current_quantity — sum
// stockmovements' `amount` entries per equipment instead (matches what the
// single-item Rentman endpoint returns).
function quantityByEquipmentId() {
  const movements = rentman.listAllStockMovements();
  const quantities = new Map();
  for (const m of movements) {
    const equipmentId = idFromRef(m.equipment);
    if (!equipmentId || typeof m.amount !== "number") continue;
    quantities.set(equipmentId, (quantities.get(equipmentId) || 0) + m.amount);
  }
  return quantities;
}

module.exports = { rentman, clearRentmanCache, idFromRef, enrichSerialNumbers, quantityByEquipmentId };
