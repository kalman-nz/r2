// Loads stock, buffers and bookings out of the database and runs them
// through the pure engine in lib/availability.js. Everything here reads
// with raw SQL into DynamicModels, since availability for a whole catalogue
// touches thousands of rows and building full Record objects for each is
// needlessly slow. Every query is limited to one organisation.
const engine = require("./availability.js");
const { HOUR_MS, toMs, toPbDate } = require("./time.js");

const RESERVING_SQL = "('" + engine.RESERVING_STATUSES.join("','") + "')";

// Usable units and turnaround buffer for every physical item.
// Bulk stock is stockQty minus anything flagged out of service; serialised
// stock is the number of active serials. bufferMs is the global buffer from
// settings plus the item's own.
function loadStock(app, org, globalBufferHours) {
  const items = arrayOf(new DynamicModel({ id: "", tracking: "", stockQty: -0, outOfServiceQty: -0, bufferHours: -0 }));
  app
    .db()
    .newQuery("SELECT id, tracking, stockQty, outOfServiceQty, bufferHours FROM items WHERE kind = 'item' AND org = {:org}")
    .bind({ org: org })
    .all(items);
  const counts = arrayOf(new DynamicModel({ item: "", n: 0 }));
  app
    .db()
    .newQuery("SELECT item, COUNT(*) AS n FROM serials WHERE status = 'active' AND org = {:org} GROUP BY item")
    .bind({ org: org })
    .all(counts);

  const serialCount = {};
  for (const c of counts) serialCount[c.item] = c.n;

  const stockByItem = {};
  const bufferMsByItem = {};
  let maxBufferMs = 0;
  for (const it of items) {
    stockByItem[it.id] =
      it.tracking === "serial" ? serialCount[it.id] || 0 : Math.max(0, Math.round(it.stockQty) - Math.round(it.outOfServiceQty));
    const buffer = (globalBufferHours + (it.bufferHours || 0)) * HOUR_MS;
    bufferMsByItem[it.id] = buffer;
    if (buffer > maxBufferMs) maxBufferMs = buffer;
  }
  return { stockByItem: stockByItem, bufferMsByItem: bufferMsByItem, maxBufferMs: maxBufferMs };
}

// Every reserving booking of a physical item that could touch [fromMs, untilMs),
// allowing for the longest buffer. Kit parent lines aren't bookings — their
// component lines are.
function loadBookings(app, org, fromMs, untilMs, maxBufferMs) {
  const rows = arrayOf(new DynamicModel({ item: "", qty: -0, job: "", status: "", prepAt: "", returnAt: "" }));
  app
    .db()
    .newQuery(
      "SELECT jl.item AS item, jl.quantity AS qty, j.id AS job, j.status AS status, j.prepAt AS prepAt, j.returnAt AS returnAt " +
        "FROM job_lines jl JOIN jobs j ON j.id = jl.job JOIN items i ON i.id = jl.item " +
        "WHERE j.org = {:org} AND i.kind = 'item' AND j.status IN " +
        RESERVING_SQL +
        " AND j.prepAt < {:to} AND j.returnAt > {:from}",
    )
    .bind({ org: org, to: toPbDate(untilMs), from: toPbDate(fromMs - maxBufferMs) })
    .all(rows);
  return rows.map((r) => ({
    itemId: r.item,
    qty: r.qty,
    start: toMs(r.prepAt),
    end: toMs(r.returnAt),
    jobId: r.job,
    status: r.status,
  }));
}

function groupByItem(bookings) {
  const byItem = {};
  for (const b of bookings) (byItem[b.itemId] = byItem[b.itemId] || []).push(b);
  return byItem;
}

// Kit id -> [{ itemId, qty }] for every kit's components.
function loadKitComponents(app, org) {
  const rows = arrayOf(new DynamicModel({ parent: "", child: "", quantity: -0 }));
  app
    .db()
    .newQuery("SELECT parent, child, quantity FROM item_components WHERE kind = 'component' AND org = {:org}")
    .bind({ org: org })
    .all(rows);
  const kits = {};
  for (const r of rows) (kits[r.parent] = kits[r.parent] || []).push({ itemId: r.child, qty: Math.round(r.quantity) });
  return kits;
}

function kitIds(app, org) {
  const rows = arrayOf(new DynamicModel({ id: "" }));
  app.db().newQuery("SELECT id FROM items WHERE kind = 'kit' AND org = {:org}").bind({ org: org }).all(rows);
  return rows.map((r) => r.id);
}

// Free counts for every item and kit over one window, e.g. for the item
// picker on a job (excludeJobId = that job, so its own lines don't count
// against it). Returns { [itemId]: { stock, free, freeFirm } }; kits have
// stock null.
function availabilityForWindow(app, org, fromMs, untilMs, excludeJobId, globalBufferHours) {
  const stock = loadStock(app, org, globalBufferHours);
  const byItem = groupByItem(loadBookings(app, org, fromMs, untilMs, stock.maxBufferMs));
  const result = {};
  for (const itemId of Object.keys(stock.stockByItem)) {
    const a = engine.itemAvailability(itemId, fromMs, untilMs, {
      stock: stock.stockByItem[itemId],
      bufferMs: stock.bufferMsByItem[itemId],
      bookings: byItem[itemId] || [],
      excludeJobId: excludeJobId,
    });
    result[itemId] = { stock: stock.stockByItem[itemId], free: a.free, freeFirm: a.freeFirm };
  }
  const components = loadKitComponents(app, org);
  const free = {};
  const freeFirm = {};
  for (const id of Object.keys(result)) {
    free[id] = result[id].free;
    freeFirm[id] = result[id].freeFirm;
  }
  for (const kitId of kitIds(app, org)) {
    result[kitId] = {
      stock: null,
      free: engine.kitFree(components[kitId], free),
      freeFirm: engine.kitFree(components[kitId], freeFirm),
    };
  }
  return result;
}

// Free count over time for one item or kit, plus the bookings behind it —
// the item page's availability view.
function itemTimeline(app, item, fromMs, untilMs, globalBufferHours) {
  const org = item.getString("org");
  const stock = loadStock(app, org, globalBufferHours);
  const bookings = loadBookings(app, org, fromMs, untilMs, stock.maxBufferMs);
  const byItem = groupByItem(bookings);

  function segmentsFor(itemId) {
    return engine.itemAvailability(itemId, fromMs, untilMs, {
      stock: stock.stockByItem[itemId] || 0,
      bufferMs: stock.bufferMsByItem[itemId] || 0,
      bookings: byItem[itemId] || [],
    }).segments;
  }

  if (item.getString("kind") === "kit") {
    const components = loadKitComponents(app, org)[item.id] || [];
    const relevant = {};
    for (const c of components) relevant[c.itemId] = true;
    return {
      stock: null,
      segments: engine.kitSegments(
        components.map((c) => ({ qty: c.qty, segments: segmentsFor(c.itemId) })),
        fromMs,
        untilMs,
      ),
      bookings: bookings.filter((b) => relevant[b.itemId]),
    };
  }
  return {
    stock: stock.stockByItem[item.id] || 0,
    segments: segmentsFor(item.id),
    bookings: (byItem[item.id] || []).filter((b) => b.end + (stock.bufferMsByItem[item.id] || 0) > fromMs),
  };
}

// Shortages for one job's physical items. needs: { [itemId]: qty }.
function jobAvailability(app, org, jobId, startMs, endMs, needs, globalBufferHours) {
  const stock = loadStock(app, org, globalBufferHours);
  const bookings = loadBookings(app, org, startMs, endMs + stock.maxBufferMs, stock.maxBufferMs);
  return engine.jobShortages({ id: jobId, start: startMs, end: endMs }, needs, {
    stockByItem: stock.stockByItem,
    bufferMsByItem: stock.bufferMsByItem,
    bookings: bookings,
  });
}

module.exports = { availabilityForWindow, itemTimeline, jobAvailability };
