#!/usr/bin/env python3
"""task-width-ingest.py — tiny zero-dependency inbox for fleet task-width data.

Run this ON ONE always-on box (e.g. the machine where you run Claude). Other
machines/agents POST their `task-width-fleet.sh scan` JSONL to it; it appends
raw per-repo lines to an inbox file. You (or Claude) then read the inbox / hit
/report — no copy-paste, no per-machine file shuffling.

  python3 task-width-ingest.py [--port 8787] [--bind 0.0.0.0]
                               [--inbox ~/.autopilot/task-width/inbox.jsonl]

Auth: if env TASK_WIDTH_TOKEN is set, every request must send header
  X-Token: <that value>  (POSTs without it are rejected). If unset AND bound to
a non-loopback address, it warns loudly — an open POST endpoint on a routable
interface is abusable.

Endpoints:
  POST /submit   body = one or more JSONL lines (raw scan output). Appended
                 verbatim (+ a received-at wrapper is NOT added; lines stay raw
                 so central dedup/confidence-gating sees the original objects).
                 -> {"ok":true,"appended":N}
  GET  /report   runs `task-width-fleet.sh aggregate <inbox>` and returns text.
  GET  /raw      returns the inbox file as-is (JSONL).
  GET  /health   -> ok

Submit from any machine:
  bash task-width-fleet.sh scan --root ~/projects --submit http://HOST:8787
  # or by hand:
  curl -s -XPOST --data-binary @"$(hostname -s).jsonl" \
       -H "X-Token: $TASK_WIDTH_TOKEN" http://HOST:8787/submit
"""
import argparse, hmac, json, os, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SELF_DIR = os.path.dirname(os.path.abspath(__file__))
FLEET = os.path.join(SELF_DIR, "task-width-fleet.sh")
TOKEN = os.environ.get("TASK_WIDTH_TOKEN", "")

def make_handler(inbox):
    class H(BaseHTTPRequestHandler):
        def _send(self, code, body, ctype="application/json"):
            b = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def _auth_ok(self):
            if not TOKEN:
                return True
            return hmac.compare_digest(self.headers.get("X-Token", ""), TOKEN)

        def log_message(self, fmt, *args):  # quieter log
            sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, "ok\n", "text/plain")
            if not self._auth_ok():
                return self._send(401, '{"ok":false,"error":"bad token"}')
            if self.path == "/report":
                try:
                    out = subprocess.run(["bash", FLEET, "aggregate", inbox],
                                         capture_output=True, text=True, timeout=120)
                    return self._send(200, out.stdout or out.stderr, "text/plain")
                except Exception as e:
                    return self._send(500, f"report failed: {e}\n", "text/plain")
            if self.path == "/raw":
                try:
                    with open(inbox, "rb") as f:
                        return self._send(200, f.read(), "text/plain")
                except FileNotFoundError:
                    return self._send(200, b"", "text/plain")
            return self._send(404, '{"ok":false,"error":"not found"}')

        def do_POST(self):
            if not self._auth_ok():
                return self._send(401, '{"ok":false,"error":"bad token"}')
            if self.path not in ("/submit", "/"):
                return self._send(404, '{"ok":false,"error":"not found"}')
            try:
                n = int(self.headers.get("Content-Length", 0))
            except ValueError:
                return self._send(400, '{"ok":false,"error":"bad Content-Length"}')
            raw = self.rfile.read(n).decode("utf-8", "replace") if n > 0 else ""
            appended = 0
            os.makedirs(os.path.dirname(inbox), exist_ok=True)
            with open(inbox, "a") as f:
                for line in raw.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        json.loads(line)          # validate; skip junk
                    except Exception:
                        continue
                    f.write(line + "\n")
                    appended += 1
            return self._send(200, json.dumps({"ok": True, "appended": appended}))
    return H

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--inbox", default=os.path.expanduser("~/.autopilot/task-width/inbox.jsonl"))
    a = ap.parse_args()
    a.inbox = os.path.expanduser(a.inbox)
    if a.bind not in ("127.0.0.1", "localhost") and not TOKEN:
        sys.stderr.write("WARNING: bound to %s with NO TASK_WIDTH_TOKEN set — "
                         "anyone who can reach this port can POST. Set the env "
                         "var or bind 127.0.0.1.\n" % a.bind)
    srv = ThreadingHTTPServer((a.bind, a.port), make_handler(a.inbox))
    sys.stderr.write("task-width-ingest on %s:%d  inbox=%s  token=%s\n"
                     % (a.bind, a.port, a.inbox, "set" if TOKEN else "NONE"))
    sys.stderr.write("  submit:  curl -XPOST --data-binary @<host>.jsonl http://<this>:%d/submit\n" % a.port)
    sys.stderr.write("  report:  curl http://<this>:%d/report\n" % a.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
main()
