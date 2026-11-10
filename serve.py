#!/usr/bin/env python3
"""Pronomen dev server: static files, plus a tiny progress-sync API.

    python3 serve.py                 # http://0.0.0.0:8123
    python3 serve.py --port 9000     # any other port

Progress for each sync code is one JSON file inside .sync/, named after a hash of
the code so a code can never become a filesystem path. Stdlib only: no installs.

API
  GET  /api/state?code=<code>   -> {code, rev, updatedAt, state}
  POST /api/state?code=<code>   <- {state: {...}}  -> {code, rev, updatedAt}
  GET  /api/lan                 -> {addresses: [...], port}  (for shareable links)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import socket
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
SYNC_DIR = ROOT / ".sync"
CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{3,63}$")
MAX_BODY = 1 << 20  # 1 MiB: a full progress blob is a few kilobytes
LOCK = threading.Lock()


# ------------------------------------------------------------------ state files


def state_path(code: str) -> Path:
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()[:32]
    return SYNC_DIR / f"{digest}.json"


def read_state(code: str) -> dict | None:
    try:
        with state_path(code).open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("state"), dict):
        return None
    return data


def write_state(code: str, state: dict) -> dict:
    SYNC_DIR.mkdir(exist_ok=True)
    previous = read_state(code) or {}
    payload = {
        "code": code,
        "rev": int(previous.get("rev") or 0) + 1,
        "updatedAt": int(time.time() * 1000),
        "state": state,
    }
    path = state_path(code)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    tmp.replace(path)  # atomic, so a half-written blob is never read
    return payload


def lan_addresses() -> list[str]:
    """Best-effort list of this machine's LAN addresses, for shareable links."""
    found: list[str] = []

    def add(address: str) -> None:
        if address and not address.startswith("127.") and address not in found:
            found.append(address)

    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("192.168.0.1", 9))  # UDP connect sends no packets
            add(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass

    try:
        for address in socket.gethostbyname_ex(socket.gethostname())[2]:
            add(address)
    except OSError:
        pass

    return found


# ---------------------------------------------------------------------- handler


class Handler(SimpleHTTPRequestHandler):
    server_version = "PronomenSync/1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # -- plumbing ------------------------------------------------------------

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path: str) -> str:
        # Never serve dot-directories (.sync holds other people's progress).
        clean = unquote(path.split("?", 1)[0].split("#", 1)[0])
        if any(part.startswith(".") for part in Path(clean).parts):
            return str(ROOT / "__not_found__")
        return super().translate_path(path)

    def end_headers(self) -> None:
        # A stale module after an edit looks like a broken change; refetch instead.
        if urlparse(self.path).path.endswith((".html", ".js", ".css", "/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def code_from_query(self) -> str | None:
        raw = (parse_qs(urlparse(self.path).query).get("code") or [""])[0]
        code = raw.strip().lower()
        return code if CODE_RE.match(code) else None

    # -- API -----------------------------------------------------------------

    def handle_state_get(self) -> None:
        code = self.code_from_query()
        if not code:
            self.send_json({"error": "A sync code of 4-64 a-z0-9- characters is required."}, HTTPStatus.BAD_REQUEST)
            return
        with LOCK:
            payload = read_state(code)
        if not payload:
            self.send_json({"code": code, "rev": 0, "updatedAt": 0, "state": None})
            return
        self.send_json(payload)

    def handle_state_post(self) -> None:
        code = self.code_from_query()
        if not code:
            self.send_json({"error": "A sync code of 4-64 a-z0-9- characters is required."}, HTTPStatus.BAD_REQUEST)
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json({"error": "Empty body."}, HTTPStatus.BAD_REQUEST)
            return
        if length > MAX_BODY:
            self.send_json({"error": "Progress blob too large."}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return

        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.send_json({"error": "Body is not valid JSON."}, HTTPStatus.BAD_REQUEST)
            return

        state = parsed.get("state") if isinstance(parsed, dict) else None
        if not isinstance(state, dict):
            self.send_json({"error": "Expected {state: {...}}."}, HTTPStatus.BAD_REQUEST)
            return

        with LOCK:
            payload = write_state(code, state)
        self.send_json({k: payload[k] for k in ("code", "rev", "updatedAt")})

    # -- routing -------------------------------------------------------------

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            self.handle_state_get()
            return
        if path == "/api/lan":
            self.send_json({"addresses": lan_addresses(), "port": self.server.server_address[1]})
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path == "/api/state":
            self.handle_state_post()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, fmt: str, *args) -> None:
        if urlparse(self.path).path.startswith("/api/"):
            return  # sync churn would bury everything else
        super().log_message(fmt, *args)


# ------------------------------------------------------------------------ main


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Pronomen with progress sync.")
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 reaches your phone too")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Pronomen on http://127.0.0.1:{args.port}/")
    for address in lan_addresses():
        print(f"  phone: http://{address}:{args.port}/")
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
