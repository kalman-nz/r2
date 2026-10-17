// Thin wrapper around the Rentman public API (https://api.rentman.net), used
// only by the importer (lib/rentmanImport.js) to pull a customer's own data
// out of their own Rentman account with their own API token. Built on
// PocketBase JSVM's $http.send, with sleep() for the 429 backoff (JSVM
// hooks run synchronously, no timers).
//
// Field names used by the importer were confirmed against a live token
// when this app was a Rentman companion; anything not confirmed is called
// out where it's read.

const BASE_URL = $os.getenv("RENTMAN_BASE_URL") || "https://api.rentman.net";

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

// token: the API token from Settings > Import (or RENTMAN_API_TOKEN).
function createRentmanClient(token) {
  if (!token) throw new Error("No Rentman API token — add one in Settings > Import");

  function rentmanFetch(path, searchParams) {
    const url = buildUrl(path, searchParams);
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = $http.send({
        method: "GET",
        url: url,
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        timeout: 120,
      });

      if (res.statusCode === 429 && attempt < maxAttempts) {
        const retryAfterHeader = (res.headers["Retry-After"] || res.headers["retry-after"] || [])[0];
        const retryAfterMs = Number(retryAfterHeader) * 1000 || 500 * Math.pow(2, attempt);
        sleep(retryAfterMs);
        continue;
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        throw new Error("Rentman rejected the API token (" + res.statusCode + ") — check it in Settings > Import");
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error("Rentman API " + res.statusCode + " for " + path + ": " + String(res.raw).slice(0, 500));
      }
      return res.json;
    }
    throw new Error("Rentman API rate limit exceeded for " + path + " after " + maxAttempts + " attempts");
  }

  // Rentman caps every list request at 1500 items and cursor-paginates beyond
  // that (next_page_url) — walk every page rather than just the first.
  function listAll(resource) {
    let page = rentmanFetch("/" + resource, { limit: 1500 });
    const all = page.data.slice();
    while (page.next_page_url) {
      page = rentmanFetch(page.next_page_url);
      all.push.apply(all, page.data);
    }
    return all;
  }

  return {
    listAllEquipment: () => listAll("equipment"),
    listAllSerialNumbers: () => listAll("serialnumbers"),
    listAllStockLocations: () => listAll("stocklocations"),
    listAllFolders: () => listAll("folders"),
    listAllStockMovements: () => listAll("stockmovements"),
    // Custom field *definitions* — the account's own extra fields, each
    // showing up as "custom_<id>" in an equipment/serialnumber's `custom`
    // object.
    listAllExtraInputFields: () => listAll("extrainputfields"),
  };
}

// Rentman relates records by path-style references, e.g. an equipment
// field like "/equipment/2989" rather than an embedded object or bare id.
function idFromRef(ref) {
  return typeof ref === "string" ? ref.split("/").pop() || null : null;
}

module.exports = { createRentmanClient, idFromRef };
