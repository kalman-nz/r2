#!/usr/bin/env python3
"""Send a rendered label image to a network-connected Brother QL printer.

Invoked by PocketBase's pb_hooks (see pocketbase/pb_hooks/lib/print.js) as a
subprocess — takes a PNG rendered from a LabelTemplate + live asset data and
rasters it straight to the printer over tcp://<host>:9100, no driver/CUPS
queue involved.
"""

import argparse
import base64
import socket
import sys
import tempfile

from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster

# brother_ql's network backend opens a plain socket with no explicit
# timeout, so a connect() to an unreachable/offline printer hangs
# indefinitely — this default applies to any socket that doesn't set its
# own timeout, which covers that connect call.
socket.setdefaulttimeout(5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    image_source = parser.add_mutually_exclusive_group(required=True)
    image_source.add_argument("--image", help="Path to the label PNG to print")
    # PocketBase's JSVM has no native base64 decoder (no atob/Buffer), so its
    # pb_hooks caller passes the PNG straight through as base64 and lets
    # Python — which has a stdlib decoder — do the decoding instead of first
    # writing a binary file from JS.
    image_source.add_argument("--image-base64", help="Base64-encoded label PNG to print")
    parser.add_argument("--host", required=True, help="Printer LAN IP (e.g. 10.20.27.79)")
    parser.add_argument("--model", default="QL-810W")
    parser.add_argument("--label", default="62", help="brother_ql label identifier, e.g. 62 for 62mm continuous")
    parser.add_argument("--no-cut", action="store_true", help="Skip the auto-cut after printing")
    args = parser.parse_args()

    if args.image_base64:
        with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
            tmp.write(base64.b64decode(args.image_base64))
            tmp.flush()
            image_path = tmp.name
            qlr = BrotherQLRaster(args.model)
            qlr.exception_on_warning = True
            instructions = convert(qlr=qlr, images=[image_path], label=args.label, cut=not args.no_cut)
    else:
        qlr = BrotherQLRaster(args.model)
        qlr.exception_on_warning = True
        instructions = convert(qlr=qlr, images=[args.image], label=args.label, cut=not args.no_cut)

    try:
        result = send(instructions=instructions, printer_identifier=f"tcp://{args.host}", backend_identifier="network")
    except OSError as e:
        print(f"Could not reach printer at {args.host}: {e}", file=sys.stderr)
        return 1

    # The network backend can't read status back from the printer, so
    # "sent" is the best confirmation available — did_print always stays
    # False for this backend even on a successful print.
    if result.get("outcome") != "sent":
        print(f"Failed to send label to printer: {result}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
