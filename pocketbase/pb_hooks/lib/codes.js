// Automatic item codes and barcodes. The pure parts (luhnDigit, makeBarcode,
// isGeneratedBarcode, typedCode) are tested in pocketbase/tests/codes.test.js;
// the rest look at the database.
//
//   item code  5 digits, counting up per organisation from 10001: short
//              enough to say out loud and write on a case
//   barcode    10 digits, so it never looks like an item code on the same
//              label; never starts with 0 (spreadsheets drop it), and the
//              last digit is a Luhn check digit, so a mistyped barcode
//              doesn't land on another item's
//
// Both are only filled in when left blank, so imported codes and existing
// asset tags still work.

const FIRST_CODE = 10001;

// The Luhn check digit for a string of digits.
function luhnDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

// random() returns [0, 1), like Math.random.
function makeBarcode(random) {
  let body = String(1 + Math.floor(random() * 9));
  for (let i = 0; i < 8; i++) body += String(Math.floor(random() * 10));
  return body + luhnDigit(body);
}

function isGeneratedBarcode(code) {
  return /^[1-9]\d{9}$/.test(code) && luhnDigit(code.slice(0, 9)) === code[9];
}

// What someone typed, as it would have been printed: "123 456-7890" →
// "1234567890". Only for all-digit codes, so asset tags with spaces in them
// still match exactly.
function typedCode(code) {
  const c = String(code || "").trim();
  return /^[\d\s-]+$/.test(c) ? c.replace(/[\s-]/g, "") : c;
}

function barcodeTaken(app, org, code) {
  const params = { org: org, code: code };
  return (
    app.findRecordsByFilter("items", "org = {:org} && barcode = {:code}", "", 1, 0, params).length > 0 ||
    app.findRecordsByFilter("serials", "org = {:org} && barcode = {:code}", "", 1, 0, params).length > 0
  );
}

function newBarcode(app, org) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = makeBarcode(Math.random);
    if (!barcodeTaken(app, org, code)) return code;
  }
  throw new BadRequestError("Couldn't find a free barcode. Try again");
}

// The next 5-digit code in this organisation. Existing codes of any other
// shape (imported from Rentman, say) are left alone and don't count.
function nextItemCode(app, org) {
  const rows = arrayOf(new DynamicModel({ n: 0 }));
  app
    .db()
    .newQuery("SELECT COALESCE(MAX(CAST(code AS INTEGER)), 0) AS n FROM items WHERE org = {:org} AND code GLOB '[1-9][0-9][0-9][0-9][0-9]'")
    .bind({ org: org })
    .all(rows);
  const next = Math.max(FIRST_CODE, rows[0].n + 1);
  if (next > 99999) throw new BadRequestError("This organisation has used every 5-digit item code");
  return String(next);
}

module.exports = { luhnDigit, makeBarcode, isGeneratedBarcode, typedCode, barcodeTaken, newBarcode, nextItemCode };
