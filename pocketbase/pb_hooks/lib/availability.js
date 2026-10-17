// The availability engine: how many units of an item are free over a window.
//
// Pure functions only (no $app, no require of PocketBase globals) so the same
// file runs inside the JSVM and under `node --test` — see
// pocketbase/tests/availability.test.js. lib/availabilityData.js loads stock
// and bookings out of the database and hands plain data to these.
//
// Model:
// - Times are epoch milliseconds and every interval is half-open
//   [start, end): a job returning at 10:00 and another prepping at 10:00 do
//   not overlap.
// - A booking holds `qty` units of one physical item from the job's prep time
//   until its return time plus the item's turnaround buffer.
// - stockChanges shift capacity over an interval the same way (positive for
//   a subhire coming in, negative for a unit away for repair). Nothing feeds
//   these yet; subhires and repair tickets plug in here in v1.
// - "Free over a window" is the MINIMUM free count at any instant inside it,
//   never an average — a one-hour overlap is still a double booking.
// - Free counts can go negative. That's an overbooking, and the UI shows it
//   as one rather than clamping it to zero and hiding the problem.

// Enquiries are price checks and hold nothing; returned/cancelled jobs have
// released their kit.
const RESERVING_STATUSES = ["provisional", "confirmed", "out"];
// Pencilled ("provisional") holds still reserve stock, but freeFirm
// ignores them, so a shortage can say "fine once the pencils are released".
const FIRM_STATUSES = ["confirmed", "out"];

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Piecewise-constant free count for one item across [from, to).
// base: owned, usable units. deltas: [{ start, end, qty }] where qty is
// added while the interval is active (bookings pass negative quantities).
// Returns [{ start, end, free }] covering the whole window, with adjacent
// equal segments merged.
function freeSegments(base, deltas, from, to) {
  if (!(from < to)) return [];
  let atStart = base;
  const changes = new Map();
  const bump = (t, qty) => changes.set(t, (changes.get(t) || 0) + qty);

  for (const d of deltas) {
    if (!(d.start < d.end) || !d.qty || !overlaps(d.start, d.end, from, to)) continue;
    if (d.start <= from) atStart += d.qty;
    else bump(d.start, d.qty);
    if (d.end < to) bump(d.end, -d.qty);
  }

  const times = Array.from(changes.keys()).sort((a, b) => a - b);
  const out = [];
  let cursor = from;
  let value = atStart;
  for (const t of times) {
    const delta = changes.get(t);
    if (delta === 0) continue;
    out.push({ start: cursor, end: t, free: value });
    cursor = t;
    value += delta;
  }
  out.push({ start: cursor, end: to, free: value });

  const merged = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && last.free === seg.free) last.end = seg.end;
    else merged.push(seg);
  }
  return merged;
}

function minFree(segments) {
  let min = Infinity;
  for (const s of segments) if (s.free < min) min = s.free;
  return min === Infinity ? 0 : min;
}

// Turns bookings + stock changes for one item into freeSegments() deltas.
// bookings: [{ itemId, qty, start, end, jobId, status }] where start/end are
// the job's own prep/return times; bufferMs is added to every booking's end
// here rather than by the caller, so it can't be applied twice.
function deltasFor(itemId, opts) {
  const bufferMs = opts.bufferMs || 0;
  const firmOnly = opts.firmOnly === true;
  const deltas = [];
  for (const b of opts.bookings || []) {
    if (b.itemId !== itemId) continue;
    if (opts.excludeJobId && b.jobId === opts.excludeJobId) continue;
    if (RESERVING_STATUSES.indexOf(b.status) === -1) continue;
    if (firmOnly && FIRM_STATUSES.indexOf(b.status) === -1) continue;
    deltas.push({ start: b.start, end: b.end + bufferMs, qty: -b.qty });
  }
  for (const c of opts.stockChanges || []) {
    if (c.itemId !== itemId) continue;
    deltas.push({ start: c.start, end: c.end, qty: c.qty });
  }
  return deltas;
}

// Free units of one physical item across [from, to).
// opts: { stock, bufferMs, bookings, stockChanges, excludeJobId }
// Returns { free, freeFirm, segments } — free counts every reserving
// booking, freeFirm only confirmed/out ones.
function itemAvailability(itemId, from, to, opts) {
  const stock = opts.stock || 0;
  const segments = freeSegments(stock, deltasFor(itemId, opts), from, to);
  const firmSegments = freeSegments(stock, deltasFor(itemId, Object.assign({}, opts, { firmOnly: true })), from, to);
  return { free: minFree(segments), freeFirm: minFree(firmSegments), segments: segments };
}

// A kit is virtual: it owns no stock and is only as available as its
// scarcest component. components: [{ itemId, qty }] for ONE kit;
// freeByItem: { [itemId]: free }. A kit with no components can't go out.
function kitFree(components, freeByItem) {
  if (!components || components.length === 0) return 0;
  let min = Infinity;
  for (const c of components) {
    const perKit = c.qty > 0 ? c.qty : 1;
    const free = freeByItem[c.itemId] !== undefined ? freeByItem[c.itemId] : 0;
    const kits = Math.floor(free / perKit);
    if (kits < min) min = kits;
  }
  return min;
}

// A kit's free count over time, from each component's freeSegments() over
// the same window. components: [{ qty, segments }] for ONE kit.
function kitSegments(components, from, to) {
  if (!(from < to)) return [];
  if (!components || components.length === 0) return [{ start: from, end: to, free: 0 }];
  const times = new Set([from]);
  for (const c of components) {
    for (const s of c.segments) if (s.start > from && s.start < to) times.add(s.start);
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = i + 1 < sorted.length ? sorted[i + 1] : to;
    let min = Infinity;
    for (const c of components) {
      let free = 0;
      for (const s of c.segments) {
        if (s.start <= start && start < s.end) {
          free = s.free;
          break;
        }
      }
      const kits = Math.floor(free / (c.qty > 0 ? c.qty : 1));
      if (kits < min) min = kits;
    }
    const last = out[out.length - 1];
    if (last && last.free === min) last.end = end;
    else out.push({ start: start, end: end, free: min });
  }
  return out;
}

// Shortages for one job. Each item's check window is the job's own booking
// of it, buffer included — another job prepping during our turnaround is a
// real clash — and the job's own bookings are excluded so it isn't counted
// against itself.
// job: { id, start, end }; needs: { [itemId]: qty }
// opts: { stockByItem, bufferMsByItem, bookings, stockChanges }
// Returns { [itemId]: { needed, free, freeFirm, short, shortFirm } } where
// short is how many units can't be covered (0 = fine) and shortFirm is the
// same if every pencilled hold on other jobs were released.
function jobShortages(job, needs, opts) {
  const result = {};
  for (const itemId of Object.keys(needs)) {
    const needed = needs[itemId];
    const bufferMs = (opts.bufferMsByItem && opts.bufferMsByItem[itemId]) || 0;
    const avail = itemAvailability(itemId, job.start, job.end + bufferMs, {
      stock: (opts.stockByItem && opts.stockByItem[itemId]) || 0,
      bufferMs: bufferMs,
      bookings: opts.bookings,
      stockChanges: opts.stockChanges,
      excludeJobId: job.id,
    });
    result[itemId] = {
      needed: needed,
      free: avail.free,
      freeFirm: avail.freeFirm,
      short: Math.max(0, needed - avail.free),
      shortFirm: Math.max(0, needed - avail.freeFirm),
    };
  }
  return result;
}

module.exports = {
  RESERVING_STATUSES,
  FIRM_STATUSES,
  overlaps,
  freeSegments,
  minFree,
  itemAvailability,
  kitFree,
  kitSegments,
  jobShortages,
};
