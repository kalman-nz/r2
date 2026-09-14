// Pulls Rentman resources into the local rm_* mirror collections so every
// /api/* read route can serve from PocketBase instead of hitting Rentman's
// (slow) API per request. Runs on a schedule (cron_sync.pb.js), on demand
// (POST /api/sync/full), and — best-effort, for just the changed resource
// type — from the Rentman webhook receiver (routes_webhook_rentman.pb.js).
//
// This app is a label-printing tool, not a Rentman replacement — the
// mirror only covers what printing a label and looking up an asset
// actually needs: equipment, serial numbers, stock locations (for
// "_location"), and folders (for the printable "equipmentFolder" label
// field). Projects/financials/contacts aren't mirrored; a "current
// project" label just resolves the one Rentman ref it needs live, at
// asset-lookup time — see routes_assets.pb.js.
//
// Each equipment record's current_quantity is computed from stockmovements
// *at sync time* and stored on the mirrored record — stockmovements
// themselves aren't mirrored (that table can grow unbounded over the years
// and nothing besides this one rollup needs it), so reads never pay for
// summing it.

function syncStockLocations(app) {
  const { rentman } = require(`${__hooks}/lib/rentman.js`);
  const { upsert, removeMissing } = require(`${__hooks}/lib/mirror.js`);
  const all = rentman.listStockLocations().data;
  for (const row of all) upsert(app, "rm_stocklocations", row.id, row);
  removeMissing(app, "rm_stocklocations", all.map((r) => r.id));
  return all.length;
}

function syncFolders(app) {
  const { rentman } = require(`${__hooks}/lib/rentman.js`);
  const { upsert, removeMissing } = require(`${__hooks}/lib/mirror.js`);
  const all = rentman.listAllFolders();
  for (const row of all) upsert(app, "rm_folders", row.id, row);
  removeMissing(app, "rm_folders", all.map((r) => r.id));
  return all.length;
}

// Not archive-filtered here — /api/equipment/{id} still needs to resolve an
// archived id if something links straight to it, same as before the
// mirror. The list route filters archived items itself, same as before.
function syncEquipment(app) {
  const { rentman, quantityByEquipmentId } = require(`${__hooks}/lib/rentman.js`);
  const { upsert, removeMissing } = require(`${__hooks}/lib/mirror.js`);
  const all = rentman.listAllEquipment();
  const quantities = quantityByEquipmentId();
  for (const eq of all) {
    const withQty = Object.assign({}, eq, {
      current_quantity: eq.current_quantity != null ? eq.current_quantity : quantities.get(String(eq.id)) || 0,
    });
    upsert(app, "rm_equipment", eq.id, withQty);
  }
  removeMissing(app, "rm_equipment", all.map((eq) => eq.id));
  return all.length;
}

function syncSerialNumbers(app) {
  const { rentman } = require(`${__hooks}/lib/rentman.js`);
  const { upsert, removeMissing } = require(`${__hooks}/lib/mirror.js`);
  const all = rentman.listAllSerialNumbers();
  for (const row of all) upsert(app, "rm_serialnumbers", row.id, row);
  removeMissing(app, "rm_serialnumbers", all.map((r) => r.id));
  return all.length;
}

// Order matters a little: equipment needs a fresh stockmovements pull for
// quantities, and everything else is independent — cheapest/most-likely-to-
// fail-fast resources first so a slow Rentman outage is caught quickly.
function syncAll(app) {
  const { clearRentmanCache } = require(`${__hooks}/lib/rentman.js`);
  const { setSyncState } = require(`${__hooks}/lib/mirror.js`);
  clearRentmanCache();
  const startedAt = Date.now();
  try {
    const counts = {
      stocklocations: syncStockLocations(app),
      folders: syncFolders(app),
      equipment: syncEquipment(app),
      serialnumbers: syncSerialNumbers(app),
    };
    setSyncState(app, "lastSyncedAt", new Date().toISOString());
    setSyncState(app, "lastSyncError", "");
    setSyncState(app, "lastSyncCounts", counts);
    setSyncState(app, "lastSyncDurationMs", Date.now() - startedAt);
    return counts;
  } catch (err) {
    setSyncState(app, "lastSyncError", String(err && err.message ? err.message : err));
    throw err;
  }
}

const RESOURCE_SYNCERS = {
  equipment: syncEquipment,
  serialnumbers: syncSerialNumbers,
  stocklocations: syncStockLocations,
  folders: syncFolders,
};

// Rentman's exact webhook payload shape isn't confirmed yet — their docs
// site blocks automated fetches, so this is a best-effort guess at common
// shapes ({ items: [{ type, id }, ...] } or a bare { type/resource/model,
// id }) that re-syncs whichever *resource type* the payload names (a full
// re-pull of that one resource — cheap relative to a full syncAll, and
// correct without having to trust an exact id field name). Anything
// unrecognized throws so the webhook handler falls back to a full syncAll
// instead of silently doing nothing — see routes_webhook_rentman.pb.js.
function syncFromWebhookPayload(app, body) {
  const items = Array.isArray(body && body.items) ? body.items : [body || {}];
  const resourceTypesSeen = new Set();
  for (const item of items) {
    const resource = String(
      item.type || item.resource || item.model || item.entity || item.hook_event || "",
    ).toLowerCase();
    if (!resource) throw new Error("Could not identify a resource type in the webhook payload");
    resourceTypesSeen.add(resource);
  }
  const synced = [];
  for (const resource of resourceTypesSeen) {
    const syncer = RESOURCE_SYNCERS[resource];
    // Not every Rentman resource type is mirrored (e.g. a webhook firing
    // for a project change) — nothing to do locally, not an error.
    if (!syncer) continue;
    syncer(app);
    synced.push(resource);
  }
  if (synced.length === 0) throw new Error("No mirrored resource type recognized in webhook payload");
  return synced;
}

module.exports = {
  syncAll,
  syncFromWebhookPayload,
  syncStockLocations,
  syncFolders,
  syncEquipment,
  syncSerialNumbers,
};
