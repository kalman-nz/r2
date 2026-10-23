// Client for the Momentus Enterprise REST API (formerly Ungerboeck), used
// by the live sync (lib/momentusSync.js) with each venue's own API user.
//
// UNCONFIRMED: written without access to a Momentus instance. Momentus only
// publishes its endpoint reference inside each instance (/api/help), and the
// API is a paid module (reading needs the Standard licence; adding or
// changing orders and resources needs more). Everything that depends on
// their exact API (paths, the search syntax, field names, the sign-in
// handshake) is in ENDPOINTS, SEARCH and FIELDS below, so checking it
// against a real instance means changing this file only. An organisation
// can also override any endpoint path in Settings → Integrations
// (config.endpoints) without a code change.
//
// What it assumes:
// - Sign-in: a JWT signed (HS256) with the API user's secret, issued by the
//   API user's id, sent to sdk_initialize, which returns the bearer token
//   for every other call.
// - Paths are keyed by the organisation code: Events/{org}/{id}.
// - Lists take an OData-style ?search= filter and page with page/pageSize,
//   and come back as an array (or wrapped in Data/value/Items).
// - Fields are PascalCase (Description, StartDate…); FIELDS lists the
//   alternatives tried for each.

const ENDPOINTS = {
  auth: "/api/v1/sdk_initialize",
  events: "/api/v1/Events/{org}",
  event: "/api/v1/Events/{org}/{id}",
  functions: "/api/v1/Functions/{org}",
  account: "/api/v1/Accounts/{org}/{id}",
  space: "/api/v1/Spaces/{org}/{id}",
  orders: "/api/v1/Orders/{org}",
  order: "/api/v1/Orders/{org}/{id}",
  orderItems: "/api/v1/OrderItems/{org}",
  orderItem: "/api/v1/OrderItems/{org}/{order}/{line}",
  resources: "/api/v1/Resources/{org}",
  resource: "/api/v1/Resources/{org}/{id}",
};

// OData-style filters for ?search=.
const SEARCH = {
  eventsBetween: (from, to) => "StartDate le DateTime'" + to + "' and EndDate ge DateTime'" + from + "'",
  functionsOf: (eventId) => "Event eq " + Number(eventId),
  ordersOf: (eventId) => "Event eq " + Number(eventId),
  itemsOf: (orderNumber) => "OrderNumber eq " + Number(orderNumber),
};

// The names tried, in order, for each value read off a Momentus record.
const FIELDS = {
  event: {
    id: ["ID", "EventID", "Event"],
    name: ["Description", "Name", "EventName"],
    status: ["Status", "EventStatus", "StatusCode"],
    statusName: ["StatusDescription", "StatusName"],
    startDate: ["StartDate", "Start"],
    startTime: ["StartTime"],
    endDate: ["EndDate", "End"],
    endTime: ["EndTime"],
    account: ["Account", "AccountCode", "Organization"],
    space: ["Space", "Room", "SpaceCode"],
    modified: ["ChangedOn", "ModifiedDate", "LastModified", "Modified"],
  },
  func: {
    id: ["Function", "ID", "FunctionID"],
    name: ["Description", "Name"],
    space: ["Space", "Room", "SpaceCode"],
    startDate: ["StartDate", "Start"],
    startTime: ["StartTime"],
    endDate: ["EndDate", "End"],
    endTime: ["EndTime"],
  },
  account: {
    name: ["Name", "Description", "DisplayName", "AccountName"],
    email: ["Email", "EmailAddress", "Email1"],
    phone: ["Phone", "PhoneNumber", "Phone1"],
    address: ["Address1", "Address2", "Address3", "City", "State", "PostalCode", "Country"],
    kind: ["Class", "AccountClass", "Type"],
  },
  space: { name: ["Description", "Name"] },
  order: {
    number: ["OrderNumber", "Order", "ID"],
    event: ["Event", "EventID"],
    department: ["Department", "DepartmentCode"],
    type: ["OrderType", "Type"],
    name: ["Description", "Name"],
    status: ["Status", "OrderStatus"],
  },
  orderItem: {
    line: ["OrderLine", "Line", "ID", "Sequence"],
    resource: ["Resource", "ResourceCode", "Item", "ItemCode"],
    name: ["Description", "ResourceDescription", "ItemDescription", "Note"],
    quantity: ["Quantity", "Units", "OrderedUnits"],
    price: ["Price", "UnitPrice", "Rate"],
    amount: ["Amount", "Total", "ExtendedPrice"],
    note: ["Note", "Notes", "Comment"],
  },
};

// The first of these fields the record has.
function pick(record, names) {
  for (const name of names) {
    const v = record ? record[name] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// A list response, however it's wrapped.
function rows(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  for (const key of ["Data", "data", "value", "Items", "items", "Results"]) if (Array.isArray(body[key])) return body[key];
  return [];
}

// cfg: { baseUrl, orgCode, apiUserId, endpoints? }; secret: the API user's
// secret (Settings → Integrations, never sent to the browser).
function createMomentusClient(org, cfg, secret) {
  const base = String(cfg.baseUrl || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) throw new BadRequestError("Add your Momentus address in Settings → Integrations");
  if (!/^https:\/\//i.test(base) && !$os.getenv("R2_ALLOW_HTTP_MOMENTUS")) throw new BadRequestError("Momentus only works over https");
  if (!cfg.orgCode) throw new BadRequestError("Add your Momentus organisation code in Settings → Integrations");
  if (!cfg.apiUserId || !secret) throw new BadRequestError("Add the Momentus API user and its secret in Settings → Integrations");
  const endpoints = Object.assign({}, ENDPOINTS, cfg.endpoints || {});

  function path(name, params) {
    let p = endpoints[name];
    const all = Object.assign({ org: cfg.orgCode }, params || {});
    for (const key of Object.keys(all)) p = p.split("{" + key + "}").join(encodeURIComponent(String(all[key])));
    return p;
  }

  // Bearer tokens last a while; one per organisation is kept in memory.
  const tokenKey = "momentusToken:" + org;
  function token(fresh) {
    const cached = $app.store().get(tokenKey);
    if (!fresh && cached && cached.until > Date.now()) return cached.token;
    const jwt = $security.createJWT({ iss: String(cfg.apiUserId), sub: String(cfg.apiUserId) }, secret, 600);
    const res = $http.send({ method: "GET", url: base + path("auth"), headers: { Authorization: "Bearer " + jwt, Accept: "application/json" }, timeout: 60 });
    if (res.statusCode === 401 || res.statusCode === 403) throw permanent("Momentus didn't accept the API user or secret (" + res.statusCode + ")");
    if (res.statusCode < 200 || res.statusCode >= 300) throw new Error("Momentus sign-in failed (" + res.statusCode + "): " + String(res.raw).slice(0, 300));
    const body = res.json;
    const t = typeof body === "string" ? body : body && (body.Token || body.token || body.access_token);
    if (!t) throw new Error("Momentus sign-in didn't return a token");
    $app.store().set(tokenKey, { token: t, until: Date.now() + 9 * 60000 });
    return t;
  }

  function permanent(message, status) {
    const err = new Error(message);
    err.permanent = true;
    err.status = status;
    return err;
  }

  function call(method, p, query, body) {
    const params = [];
    for (const key of Object.keys(query || {})) {
      if (query[key] !== undefined && query[key] !== null) params.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key])));
    }
    const url = base + p + (params.length ? "?" + params.join("&") : "");
    for (let attempt = 1; attempt <= 4; attempt++) {
      const headers = { Authorization: "Bearer " + token(attempt === 2), Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = $http.send({ method: method, url: url, headers: headers, body: body !== undefined ? JSON.stringify(body) : "", timeout: 120 });
      // An expired token: sign in again once.
      if (res.statusCode === 401 && attempt === 1) continue;
      if ((res.statusCode === 429 || res.statusCode >= 500) && attempt < 4) {
        sleep(500 * Math.pow(2, attempt));
        continue;
      }
      if (res.statusCode === 404 && method === "GET") return null;
      if (res.statusCode === 401 || res.statusCode === 403) {
        throw permanent("Momentus refused " + method + " " + p + " (" + res.statusCode + "): your API licence may not include it", res.statusCode);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error("Momentus API " + res.statusCode + " for " + method + " " + p + ": " + String(res.raw).slice(0, 500));
        err.status = res.statusCode;
        err.permanent = res.statusCode >= 400 && res.statusCode < 500;
        throw err;
      }
      return res.json;
    }
    throw new Error("Momentus kept failing for " + method + " " + p);
  }

  // Every page of a list.
  function list(name, params, search) {
    const out = [];
    const size = 200;
    let firstKey = null;
    for (let page = 1; page <= 500; page++) {
      const batch = rows(call("GET", path(name, params), { search: search, page: page, pageSize: size }));
      if (!batch.length) break;
      // An instance that ignores paging sends page 1 again: stop there.
      const key = JSON.stringify(batch[0]);
      if (page > 1 && key === firstKey) break;
      if (page === 1) firstKey = key;
      out.push.apply(out, batch);
      if (batch.length < size) break;
    }
    return out;
  }

  const one = (name, params) => {
    const body = call("GET", path(name, params));
    return Array.isArray(body) ? body[0] || null : body && body.Data && !Array.isArray(body.Data) ? body.Data : body;
  };

  return {
    events: (fromIso, toIso) => list("events", {}, SEARCH.eventsBetween(fromIso, toIso)),
    event: (id) => one("event", { id: id }),
    functions: (eventId) => list("functions", {}, SEARCH.functionsOf(eventId)),
    account: (code) => one("account", { id: code }),
    space: (code) => one("space", { id: code }),
    orders: (eventId) => list("orders", {}, SEARCH.ordersOf(eventId)),
    orderItems: (orderNumber) => list("orderItems", {}, SEARCH.itemsOf(orderNumber)),
    createOrder: (body) => call("POST", path("orders"), null, body),
    updateOrder: (number, body) => call("PUT", path("order", { id: number }), null, body),
    addOrderItem: (body) => call("POST", path("orderItems"), null, body),
    deleteOrderItem: (number, line) => call("DELETE", path("orderItem", { order: number, line: line })),
    resource: (code) => one("resource", { id: code }),
    createResource: (body) => call("POST", path("resources"), null, body),
    updateResource: (code, body) => call("PUT", path("resource", { id: code }), null, body),
  };
}

module.exports = { createMomentusClient, ENDPOINTS, FIELDS, pick, rows };
