// Where the Python helpers in print/ live (label printing, PDFs). The
// Docker image installs them in /pb/print with their own venv; for local
// development scripts/dev-pocketbase.sh points these at the repo's print/
// directory and a venv under .pb/.
function pythonBin() {
  return $os.getenv("R2_PYTHON") || "/pb/print/venv/bin/python";
}

function printDir() {
  return $os.getenv("R2_PRINT_DIR") || "/pb/print";
}

module.exports = { pythonBin, printDir };
