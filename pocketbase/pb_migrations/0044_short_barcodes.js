/// <reference path="../pb_data/types.d.ts" />

// Barcodes R2 made used to be 10 digits; new ones are 7 (lib/codes.js). This
// swaps every old 10-digit one on items and units for a fresh 7-digit one.
// Barcodes that weren't made by R2 (imported, asset tags) are left alone.
// Tags printed with the old barcodes need reprinting.

migrate(
  (app) => {
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

    function isOldBarcode(code) {
      return /^[1-9]\d{9}$/.test(code) && luhnDigit(code.slice(0, 9)) === code[9];
    }

    function makeBarcode() {
      let body = String(1 + Math.floor(Math.random() * 9));
      for (let i = 0; i < 5; i++) body += String(Math.floor(Math.random() * 10));
      return body + luhnDigit(body);
    }

    const tables = ["items", "serials"];

    // Every barcode in use, so the new ones don't clash with anything.
    const taken = {};
    for (const table of tables) {
      const rows = arrayOf(new DynamicModel({ barcode: "" }));
      app.db().newQuery("SELECT barcode FROM " + table + " WHERE barcode != ''").all(rows);
      for (const r of rows) taken[r.barcode] = true;
    }

    for (const table of tables) {
      const rows = arrayOf(new DynamicModel({ id: "", barcode: "" }));
      app.db().newQuery("SELECT id, barcode FROM " + table + " WHERE length(barcode) = 10").all(rows);
      for (const r of rows) {
        if (!isOldBarcode(r.barcode)) continue;
        let code = makeBarcode();
        while (taken[code]) code = makeBarcode();
        taken[code] = true;
        app
          .db()
          .newQuery("UPDATE " + table + " SET barcode = {:code} WHERE id = {:id}")
          .bind({ code: code, id: r.id })
          .execute();
      }
    }
  },
  () => {
    // Left as they are: the old barcodes aren't kept.
  },
);
