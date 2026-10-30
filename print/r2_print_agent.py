#!/usr/bin/env python3
"""R2 print agent: takes labels from R2 to the Brother printers on this network.

R2 in the cloud can't reach a venue's label printers, so this runs on a
computer at the venue that stays on (a Raspberry Pi, the venue's server). It
asks R2 for labels, sends each one to its printer, tells R2 how that went,
and keeps R2 up to date on which printers answer. It only ever connects out
to R2, so there's nothing to open in the firewall. Python 3.8 or newer,
nothing else to install.

    python3 r2_print_agent.py --url https://r2.example.com --token r2pa_...

On Linux (a Raspberry Pi, say) it can install itself as a service that
starts with the machine and restarts if it stops:

    sudo python3 r2_print_agent.py --install --url https://r2.example.com --token r2pa_...

The URL and token can also come from R2_URL and R2_AGENT_TOKEN. Make an
agent, and its token, in R2: Settings → Printer setup → Print agents.
"""

import argparse
import base64
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

VERSION = "1"
PRINTER_PORT = 9100  # Brother QL printers take raster jobs here
WAIT = 20  # seconds R2 holds each request open waiting for a label
CHECK_EVERY = 30  # seconds between checks that the printers answer


def log(message):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


class NotAccepted(Exception):
    """R2 doesn't accept this agent's token."""


def call(url, token, method, path, body=None, timeout=15):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "r2-print-agent/" + VERSION,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as err:
        if err.code in (401, 403):
            try:
                message = json.loads(err.read() or b"{}").get("message", "")
            except ValueError:
                message = ""
            raise NotAccepted(message or "R2 turned the agent's token down")
        raise


def send_to_printer(host, data):
    """One label's raster commands, straight to the printer."""
    try:
        with socket.create_connection((host, PRINTER_PORT), timeout=5) as conn:
            conn.settimeout(60)
            conn.sendall(data)
        return {"ok": True, "unreachable": False, "message": "Printed"}
    except OSError as err:
        return {"ok": False, "unreachable": True, "message": f"Couldn't reach the printer at {host}: {err}"}


def answers(host):
    try:
        socket.create_connection((host, PRINTER_PORT), timeout=3).close()
        return {"ok": True, "message": "Online", "host": host}
    except OSError:
        return {"ok": False, "message": "Not reachable", "host": host}


def run(url, token):
    log(f"R2 print agent {VERSION}, printing for {url}")
    printers = []
    checked_at = 0.0
    first = True
    retry = 2
    while True:
        try:
            # The first ask comes straight back, with the printers to look after.
            got = call(url, token, "GET", f"/api/print-agent/jobs?wait={0 if first else WAIT}", timeout=WAIT + 20) or {}
            if first:
                log("Connected to R2")
            first = False
            retry = 2

            for job in got.get("jobs", []):
                result = send_to_printer(job["host"], base64.b64decode(job["data"]))
                log(("Printed a label on " if result["ok"] else "Didn't print a label on ") + job["host"] + ("" if result["ok"] else f": {result['message']}"))
                # The rest still print if R2 can't be told about this one.
                try:
                    call(url, token, "POST", "/api/print-agent/jobs/" + job["id"], result)
                except (urllib.error.URLError, OSError, ValueError) as err:
                    log(f"Couldn't tell R2 how that went ({err})")

            mine = sorted((p["id"], p["host"]) for p in got.get("printers", []))
            if mine != sorted((p["id"], p["host"]) for p in printers):
                printers = got.get("printers", [])
                names = ", ".join(f"{p['name']} ({p['host']})" for p in printers) or "none yet"
                log(f"Printers: {names}")
                checked_at = 0.0
            if time.time() - checked_at >= CHECK_EVERY:
                report = {p["id"]: answers(p["host"]) for p in printers}
                call(url, token, "POST", "/api/print-agent/status", {"printers": report, "version": VERSION, "hostname": socket.gethostname()})
                checked_at = time.time()
        except NotAccepted as err:
            log(f"{err}. Trying again in a minute.")
            first = True
            time.sleep(60)
        except (urllib.error.URLError, OSError, ValueError, KeyError) as err:
            log(f"Couldn't talk to R2 ({err}). Trying again in {retry}s.")
            first = True
            time.sleep(retry)
            retry = min(retry * 2, 60)


SERVICE = """[Unit]
Description=R2 print agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/r2-print-agent.env
ExecStart={python} {script}
Restart=always
RestartSec=5
DynamicUser=yes

[Install]
WantedBy=multi-user.target
"""


def install(url, token):
    """A systemd service, for Linux machines that stay on (a Raspberry Pi)."""
    if platform.system() != "Linux" or not shutil.which("systemctl"):
        sys.exit("--install sets up a systemd service, on Linux. Elsewhere, start this script when the computer starts (Task Scheduler on Windows).")
    if os.geteuid() != 0:
        sys.exit("Run --install with sudo.")
    folder = "/opt/r2-print-agent"
    os.makedirs(folder, exist_ok=True)
    script = os.path.join(folder, "r2_print_agent.py")
    shutil.copyfile(os.path.abspath(__file__), script)
    os.chmod(script, 0o755)
    env = "/etc/r2-print-agent.env"
    with open(env, "w") as f:
        f.write(f"R2_URL={url}\nR2_AGENT_TOKEN={token}\n")
    os.chmod(env, 0o600)
    with open("/etc/systemd/system/r2-print-agent.service", "w") as f:
        f.write(SERVICE.format(python=sys.executable, script=script))
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "r2-print-agent"], check=True)
    subprocess.run(["systemctl", "restart", "r2-print-agent"], check=True)
    print("Installed and started. It starts with the machine from now on.")
    print("See what it's doing:  journalctl -u r2-print-agent -f")


def main():
    parser = argparse.ArgumentParser(description="Takes labels from R2 to the Brother printers on this network.")
    parser.add_argument("--url", default=os.environ.get("R2_URL", ""), help="R2's address, e.g. https://r2.example.com")
    parser.add_argument("--token", default=os.environ.get("R2_AGENT_TOKEN", ""), help="The agent's token, from Printer setup")
    parser.add_argument("--install", action="store_true", help="Install as a service that starts with the machine (Linux)")
    args = parser.parse_args()
    url = args.url.strip().rstrip("/")
    token = args.token.strip()
    if not url.startswith(("http://", "https://")):
        parser.error("--url needs R2's address, starting https://")
    if not token.startswith("r2pa_"):
        parser.error("--token needs the agent's token from Printer setup (it starts r2pa_)")
    if args.install:
        install(url, token)
        return
    try:
        run(url, token)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
