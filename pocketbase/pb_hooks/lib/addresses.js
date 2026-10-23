// Address lookup, for contacts' billing addresses: Photon
// (photon.komoot.io), OpenStreetMap's search-as-you-type geocoder, free
// and keyless; New Zealand's OpenStreetMap addresses come from LINZ.
// Searched from the server so the provider can change (NZ Post, Addy,
// Google) without touching the app, and biased to the organisation's
// country, from its time zone (Settings → Business).

const COUNTRIES = {
  NZ: { lat: -41.0, lon: 174.0 },
  AU: { lat: -25.3, lon: 133.8 },
};

// OpenStreetMap things with a street that aren't somewhere to send a bill.
const NOT_ADDRESSES = ["highway", "public_transport", "railway", "aeroway", "waterway", "natural"];

function countryFor(timezone) {
  if (/^(Pacific\/Auckland|Pacific\/Chatham|NZ)/.test(timezone)) return "NZ";
  if (/^Australia\//.test(timezone)) return "AU";
  return "";
}

// An address as it's written on an envelope, one line each: a building
// name if it has one, the street, the suburb, the city and postcode, and
// the country when it isn't the organisation's own.
function addressLines(p, home) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const place = p.name && p.name !== p.street && p.name !== street ? p.name : "";
  const town = p.city || p.county || "";
  // A suburb that's the town's own name ("Mount Maunganui") isn't repeated.
  const suburb = p.district && p.district !== town ? p.district : "";
  const city = [town, p.postcode || ""].filter(Boolean).join(" ");
  const country = p.countrycode && p.countrycode.toUpperCase() !== home ? p.country || "" : "";
  const lines = [];
  for (const line of [place, street, suburb, city, country]) {
    const text = String(line || "").trim();
    if (text && lines.indexOf(text) === -1) lines.push(text);
  }
  return lines;
}

// Up to six addresses matching what's been typed, the organisation's own
// country first: [{ label (one line), address (one per line) }].
function searchAddresses(org, query) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 3) return [];
  const { getAllSettings, DEFAULTS } = require("./settings.js");
  const home = countryFor(getAllSettings(org).timezone || DEFAULTS.timezone);
  let url = "https://photon.komoot.io/api/?limit=20&lang=en&q=" + encodeURIComponent(q);
  if (COUNTRIES[home]) url += "&lat=" + COUNTRIES[home].lat + "&lon=" + COUNTRIES[home].lon;
  let res;
  try {
    res = $http.send({ method: "GET", url: url, headers: { "User-Agent": "R2 equipment hire (address lookup)", Accept: "application/json" }, timeout: 8 });
  } catch (_) {
    throw new BadRequestError("The address lookup isn't answering: type the address in");
  }
  if (res.statusCode !== 200) throw new BadRequestError("The address lookup isn't answering: type the address in");
  const found = [];
  const seen = {};
  for (const f of (res.json && res.json.features) || []) {
    const p = f.properties || {};
    // Places on a street, not bus stops and the like that sit on one.
    if (NOT_ADDRESSES.indexOf(p.osm_key) !== -1) continue;
    if (!p.street && !p.housenumber && p.type !== "house") continue;
    const lines = addressLines(p, home);
    const address = lines.join("\n");
    if (lines.length < 2 || seen[address]) continue;
    seen[address] = true;
    found.push({ label: lines.join(", "), address: address, home: !home || (p.countrycode || "").toUpperCase() === home });
  }
  const ordered = found.filter((a) => a.home).concat(found.filter((a) => !a.home));
  return ordered.slice(0, 6).map((a) => ({ label: a.label, address: a.address }));
}

module.exports = { countryFor, addressLines, searchAddresses };
