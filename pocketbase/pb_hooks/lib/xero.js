// Xero export: issued quotes → rows for Xero's sales invoice CSV import
// (Business → Invoices → Import). Pure, like lib/pricing.js, and tested in
// pocketbase/tests/xero.test.js; routes_exports.pb.js picks the quotes.
//
// Xero's import groups rows into invoices by InvoiceNumber, one row per
// line, and creates any contact it hasn't seen. Imported invoices arrive as
// drafts to check and approve. A number already used in Xero is rejected,
// which stops a job being invoiced twice by accident. AccountCode and
// TaxType must match the organisation's own chart of accounts and tax rate
// names (Settings → Accounting).
//
// R2 charges equipment at day rate × hire-day factor; Xero only knows
// quantity × unit price, so the factor is folded into the unit price and
// the description says how many days. Free kit contents and accessories are
// listed in their parent line's description rather than as $0 rows. A
// job-wide discount becomes its own negative line. Xero works GST out
// itself, per line, so its total can differ from R2's by a cent or two.

const HEADERS = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// Up to 4 decimal places, no trailing zeros (Xero's unit price precision).
function amount(n) {
  return String(Math.round(Number(n || 0) * 10000) / 10000);
}

// d/m/y, which is how Xero reads dates for NZ and AU organisations.
function xeroDate(date) {
  return date.day + "/" + date.month + "/" + date.year;
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

// One quote snapshot → invoice lines: [{ description, quantity,
// unitAmount, discountPct }]. InventoryItemCode stays blank: Xero matches
// it against its own items and rejects codes it doesn't know.
function invoiceLines(snapshot) {
  const pricing = snapshot.pricing || {};
  const lines = snapshot.lines || [];
  // A line on a subproject is charged over the subproject's own days.
  const charge = { "": { factor: Number(pricing.factor) || 1, days: Number(pricing.days) || 1 } };
  for (const sp of snapshot.subprojects || []) charge[sp.id] = { factor: Number(sp.factor) || 1, days: Number(sp.days) || 1 };
  const chargeOf = (line) => charge[line.subproject || ""] || charge[""];

  // Free auto-added lines get named in their parent's description instead.
  const included = {};
  for (const line of lines) {
    if (line.parentLine && !Number(line.unitPrice)) {
      (included[line.parentLine] = included[line.parentLine] || []).push(line.quantity + "× " + line.name);
    }
  }

  const out = [];
  for (const line of lines) {
    if (line.parentLine && !Number(line.unitPrice)) continue;
    const perDay = line.priceMode !== "fixed";
    const { factor, days } = chargeOf(line);
    let description = line.name;
    if (line.description) description += " — " + line.description;
    if (perDay) description += " (" + plural(days, "day") + ")";
    if (included[line.id]) description += ". Includes " + included[line.id].join(", ");
    out.push({
      description: description,
      quantity: Number(line.quantity) || 0,
      unitAmount: (Number(line.unitPrice) || 0) * (perDay ? factor : 1),
      discountPct: Number(line.discountPct) || 0,
    });
  }

  const totals = pricing.totals || {};
  if (Number(totals.jobDiscount)) {
    out.push({
      description: "Discount (" + (Number(pricing.discountPct) || 0) + "%)",
      quantity: 1,
      unitAmount: -Number(totals.jobDiscount),
      discountPct: 0,
    });
  }
  return out;
}

// invoices: [{ invoiceNumber, reference, invoiceDate, dueDate ({ day,
// month, year }), contact: { name, email, billingAddress }, snapshot }]
// options: { accountCode, taxType, currency }
function buildXeroCsv(invoices, options) {
  const rows = [HEADERS.join(",")];
  for (const invoice of invoices) {
    const contact = invoice.contact || {};
    const address = String(contact.billingAddress || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    // Xero has four address lines; anything beyond the fourth joins it.
    const addressLines = [address[0] || "", address[1] || "", address[2] || "", address.slice(3).join(", ")];
    for (const line of invoiceLines(invoice.snapshot)) {
      rows.push(
        [
          contact.name || "Unknown client",
          contact.email || "",
          addressLines[0],
          addressLines[1],
          addressLines[2],
          addressLines[3],
          "",
          "",
          "",
          "",
          invoice.invoiceNumber,
          invoice.reference || "",
          xeroDate(invoice.invoiceDate),
          xeroDate(invoice.dueDate),
          "",
          line.description,
          amount(line.quantity),
          amount(line.unitAmount),
          line.discountPct ? amount(line.discountPct) : "",
          options.accountCode,
          options.taxType,
          "",
          "",
          "",
          "",
          options.currency || "NZD",
          "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}

module.exports = { HEADERS, buildXeroCsv, invoiceLines, csvCell };
