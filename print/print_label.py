#!/usr/bin/env python3
"""Send a rendered label image to a network-connected Brother QL printer.

Invoked by PocketBase's pb_hooks (see pocketbase/pb_hooks/lib/print.js) as a
subprocess — takes a PNG rendered from a LabelTemplate + live asset data and
rasters it straight to the printer over tcp://<host>:9100, no driver/CUPS
queue involved.
"""

import argparse
import base64
import json
import socket
import sys
import tempfile


# brother_ql's network backend opens a plain socket with no explicit
# timeout, so a connect() to an unreachable/offline printer hangs
# indefinitely — this default applies to any socket that doesn't set its
# own timeout, which covers that connect call.
socket.setdefaulttimeout(5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    image_source = parser.add_mutually_exclusive_group()
    image_source.add_argument("--image", help="Path to the label PNG to print")
    # PocketBase's JSVM has no native base64 decoder (no atob/Buffer), so its
    # pb_hooks caller writes the PNG's base64 text to a file and lets Python —
    # which has a stdlib decoder — do the decoding. A file, not an argument:
    # Linux refuses any single argument over 128 KB, and a big label's
    # base64 is more than that.
    image_source.add_argument("--image-base64", help="Base64-encoded label PNG to print")
    image_source.add_argument("--image-base64-file", help="Path to a file holding the label PNG as base64")
    parser.add_argument("--host", help="Printer LAN IP (e.g. 10.20.27.79)")
    # For printers reached through a print agent (print/r2_print_agent.py):
    # make the printer's raster commands and write them, base64, to a file
    # instead of sending them anywhere. The agent sends them on.
    parser.add_argument("--raster-out", help="Write the printer commands (base64) to this file instead of printing")
    parser.add_argument("--model", default="QL-810W")
    parser.add_argument("--label", default="62", help="brother_ql label identifier, e.g. 62 for 62mm continuous")
    parser.add_argument("--no-cut", action="store_true", help="Skip the auto-cut after printing")
    parser.add_argument("--check", action="store_true", help="Only check the printer can be reached, print nothing")
    # For pb_hooks: always exit 0 and print one JSON line, {"ok", "unreachable",
    # "message"}, since the JSVM can't read the output of a failed command.
    parser.add_argument("--json", action="store_true", help="Report the result as JSON on stdout")
    args = parser.parse_args()
    if not args.check and not (args.image or args.image_base64 or args.image_base64_file):
        parser.error("--image, --image-base64 or --image-base64-file is required")
    if not args.raster_out and not args.host:
        parser.error("--host is required (or --raster-out)")

    try:
        ok, unreachable, message = run(args)
    except Exception as e:  # a bad image, a missing library — not the printer's fault
        ok, unreachable, message = False, False, f"{type(e).__name__}: {e}"

    if args.json:
        print(json.dumps({"ok": ok, "unreachable": unreachable, "message": message}))
        return 0
    if not ok:
        print(message, file=sys.stderr)
    return 0 if ok else 1


def run(args):
    if args.check:
        # Brother QLs take raster jobs on port 9100; an open port is a
        # printer that's switched on and on the network.
        try:
            socket.create_connection((args.host, 9100), timeout=3).close()
        except OSError as e:
            return False, True, f"Could not reach printer at {args.host}: {e}"
        return True, False, "Online"

    # brother_ql 0.9.4 still uses Image.ANTIALIAS, which Pillow 10 removed —
    # put it back so it runs on a current Pillow too (local dev on new
    # Pythons, where the old pinned Pillow won't install).
    from PIL import Image

    if not hasattr(Image, "ANTIALIAS"):
        Image.ANTIALIAS = Image.LANCZOS

    # Imported here so --check works without the printing libraries.
    from brother_ql.conversion import convert
    from brother_ql.backends.helpers import send
    from brother_ql.raster import BrotherQLRaster

    qlr = BrotherQLRaster(args.model)
    qlr.exception_on_warning = True
    encoded = args.image_base64
    if args.image_base64_file:
        with open(args.image_base64_file, "r", encoding="ascii") as f:
            encoded = f.read()
    if encoded:
        with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
            tmp.write(base64.b64decode(encoded))
            tmp.flush()
            instructions = convert(qlr=qlr, images=[tmp.name], label=args.label, cut=not args.no_cut)
    else:
        instructions = convert(qlr=qlr, images=[args.image], label=args.label, cut=not args.no_cut)

    if args.raster_out:
        with open(args.raster_out, "w", encoding="ascii") as f:
            f.write(base64.b64encode(bytes(instructions)).decode("ascii"))
        return True, False, "Converted"

    try:
        result = send(instructions=instructions, printer_identifier=f"tcp://{args.host}", backend_identifier="network")
    except OSError as e:
        return False, True, f"Could not reach printer at {args.host}: {e}"

    # The network backend can't read status back from the printer, so
    # "sent" is the best confirmation available — did_print always stays
    # False for this backend even on a successful print.
    if result.get("outcome") != "sent":
        return False, False, f"Failed to send label to printer: {result}"
    return True, False, "Sent to printer"


if __name__ == "__main__":
    sys.exit(main())
