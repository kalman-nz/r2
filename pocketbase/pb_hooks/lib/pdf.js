// PDFs (quotes, packing lists, labels) are drawn by print/r2_pdf.py: the
// JSVM has no PDF or font tooling, Python does, and the image already
// carries a Python venv for the label printer. Data goes over as a JSON
// file and the PDF comes back as a file, both in the OS temp dir and
// deleted straight after.
const { pythonBin, printDir } = require("./python.js");

function removeQuietly(path) {
  try {
    $os.remove(path);
  } catch (_) {
    // already gone
  }
}

// kind: "quote" | "packing" | "labels". Returns the PDF's bytes, ready for
// e.blob(); throws BadRequestError with a readable reason on failure.
function renderPdf(kind, data) {
  const base = $os.tempDir() + "/r2-" + $security.randomString(16);
  const input = base + ".json";
  const output = base + ".pdf";
  const errorFile = output + ".err";
  $os.writeFile(input, JSON.stringify(data), 0o600);
  try {
    try {
      $os.cmd(pythonBin(), printDir() + "/r2_pdf.py", kind, input, output).run();
    } catch (err) {
      // When r2_pdf.py runs and fails it writes the real reason to errorFile;
      // only when it never ran (no errorFile) and the OS couldn't find the
      // interpreter is this a "not set up" problem. Don't run the regex over
      // a genuine script error, or one whose text happens to say "not found"
      // (a blocked remote fetch, say) gets mislabelled as a setup problem.
      let reason = "";
      let scriptFailed = false;
      try {
        reason = toString($os.readFile(errorFile));
        scriptFailed = true;
      } catch (_) {
        reason = String((err && err.message) || err);
      }
      if (!scriptFailed && /no such file|not found|executable file|exec/i.test(reason)) {
        reason = "PDF generation isn't set up on this server (no Python at " + pythonBin() + ")";
      }
      throw new BadRequestError("Couldn't make the PDF: " + reason);
    }
    return $os.readFile(output);
  } finally {
    removeQuietly(input);
    removeQuietly(output);
    removeQuietly(errorFile);
  }
}

// Sends PDF bytes inline with a sensible download name.
function sendPdf(e, bytes, filename) {
  e.response.header().set("Content-Disposition", 'inline; filename="' + filename.replace(/[^\w.\- ]/g, "_") + '"');
  e.response.header().set("Cache-Control", "no-store");
  return e.blob(200, "application/pdf", bytes);
}

module.exports = { renderPdf, sendPdf };
