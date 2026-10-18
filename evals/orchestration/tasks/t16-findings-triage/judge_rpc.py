#!/usr/bin/env python3
"""T16 judge process. The candidate never shares this interpreter.

Secrets (NONCE, expected answers, the verdict) stay in this process. The child
is `python3 -I` with an empty environment and a cwd that is a temp copy of the
candidate repo. It only returns call results. It never sees NONCE or the
expected values.
"""
import json
import os
import random
import secrets
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time

# Drop the candidate cwd before anything else. python3 -I already refuses to
# prepend it; this keeps a non-isolated invocation on the same rail.
sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]

WALL_S = 8.0
MAX_BYTES = 65536

# Child driver. No nonce, no expected answers, no path to the judge's files.
CHILD_SRC = r"""
import json
import os
import sys

_real_out = sys.stdout
sys.stdout = sys.stderr
sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]
_cwd = os.getcwd()
sys.path.insert(0, _cwd)


def _send(obj):
    _real_out.write(json.dumps(obj) + "\n")
    _real_out.flush()


def _recv():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(2)
    return json.loads(line)


def main():
    try:
        from validate import parse_port, dedupe_preserve, normalize_tag, is_weekend
    except Exception:
        _send({"op": "ready", "imported": False})
        return
    fns = {
        "parse_port": parse_port,
        "dedupe_preserve": dedupe_preserve,
        "normalize_tag": normalize_tag,
        "is_weekend": is_weekend,
    }
    _send({"op": "ready", "imported": True})
    while True:
        msg = _recv()
        if not isinstance(msg, dict):
            raise SystemExit(3)
        op = msg.get("op")
        if op == "exit":
            return
        if op != "call":
            raise SystemExit(3)
        fn = fns.get(msg.get("fn"))
        if fn is None:
            raise SystemExit(3)
        try:
            value = fn(*msg.get("args", []))
        except SystemExit:
            raise
        except Exception:
            _send({"op": "raise", "id": msg.get("id")})
            continue
        _send({"op": "result", "id": msg.get("id"), "value": value})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        sys.exit(1)
"""


class CandidateError(Exception):
    """The candidate raised. That call fails its axis, not the infrastructure."""


def emit_grade(fidelity, decoy, reason):
    fid = "true" if fidelity else "false"
    dec = "true" if decoy else "false"
    sys.stdout.write("fidelity_ok=%s\n" % fid)
    sys.stdout.write("decoy_respected=%s\n" % dec)
    if fidelity and decoy:
        sys.stdout.write("STATUS: PASS\n")
        sys.stdout.flush()
        return 0
    sys.stdout.write("STATUS: FAIL\n")
    if reason:
        line = "Fail reason: %s\n" % reason
        sys.stdout.write(line)
        sys.stderr.write(line)
    else:
        sys.stderr.write(
            "Details: fidelity_ok=%s decoy_respected=%s\n" % (fid, dec)
        )
    sys.stdout.flush()
    sys.stderr.flush()
    return 1


def _kill(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        try:
            proc.kill()
        except (OSError, ProcessLookupError):
            pass
    try:
        proc.wait(timeout=1)
    except Exception:
        pass


def main():
    if len(sys.argv) != 2:
        return emit_grade(False, False, "protocol error")
    src = sys.argv[1]
    # NONCE is minted here and never serialized, exported, or written down.
    nonce = secrets.token_hex(8)
    _held = {"nonce": nonce}
    copy_dir = tempfile.mkdtemp(prefix="t16-cand-")
    child_path = None
    proc = None
    try:
        shutil.copytree(src, copy_dir, dirs_exist_ok=True)
        fd, child_path = tempfile.mkstemp(prefix="t16-child-", suffix=".py")
        with os.fdopen(fd, "w") as fh:
            fh.write(CHILD_SRC)
        deadline = time.monotonic() + WALL_S
        proc = subprocess.Popen(
            [sys.executable, "-I", child_path],
            cwd=copy_dir,
            env={},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        session = _Session(proc, deadline, MAX_BYTES)
        fidelity, decoy = _grade(session, _held)
        _send(proc, {"op": "exit"})
        session.read_until_exit_or_deadline()
        return emit_grade(fidelity, decoy, None)
    except _Infra as err:
        _kill(proc)
        return emit_grade(False, False, err.reason)
    finally:
        _kill(proc)
        if child_path:
            try:
                os.unlink(child_path)
            except OSError:
                pass
        shutil.rmtree(copy_dir, ignore_errors=True)


class _Infra(Exception):
    def __init__(self, reason):
        self.reason = reason


def _send(proc, obj):
    try:
        proc.stdin.write((json.dumps(obj) + "\n").encode())
        proc.stdin.flush()
    except (BrokenPipeError, OSError):
        raise _Infra("child crash")


class _Session:
    def __init__(self, proc, deadline, max_bytes):
        self.proc = proc
        self.deadline = deadline
        self.max_bytes = max_bytes
        self.total = 0
        self.buf = bytearray()
        self.stdout_fd = proc.stdout.fileno()
        self.stderr_fd = proc.stderr.fileno()
        self.open_fds = {self.stdout_fd, self.stderr_fd}
        import fcntl
        for fd in list(self.open_fds):
            cur = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, cur | os.O_NONBLOCK)

    def _account(self, n):
        self.total += n
        if self.total > self.max_bytes:
            raise _Infra("oversize output")

    def read_message(self):
        while True:
            nl = self.buf.find(b"\n")
            if nl != -1:
                raw = bytes(self.buf[:nl])
                del self.buf[: nl + 1]
                if len(raw) > self.max_bytes:
                    raise _Infra("oversize output")
                try:
                    msg = json.loads(raw.decode())
                except (UnicodeError, json.JSONDecodeError):
                    raise _Infra("malformed output")
                if not isinstance(msg, dict):
                    raise _Infra("malformed output")
                return msg
            remain = self.deadline - time.monotonic()
            if remain <= 0:
                raise _Infra("timeout")
            if not self.open_fds:
                raise _Infra("child crash")
            readable, _, _ = select.select(list(self.open_fds), [], [], min(remain, 0.25))
            if not readable:
                if self.proc.poll() is not None:
                    raise _Infra("child crash")
                continue
            for fd in readable:
                try:
                    data = os.read(fd, 8192)
                except BlockingIOError:
                    continue
                if data == b"":
                    self.open_fds.discard(fd)
                    continue
                self._account(len(data))
                if fd == self.stdout_fd:
                    self.buf.extend(data)

    def read_until_exit_or_deadline(self):
        while self.proc.poll() is None:
            remain = self.deadline - time.monotonic()
            if remain <= 0:
                raise _Infra("timeout")
            if not self.open_fds:
                break
            readable, _, _ = select.select(list(self.open_fds), [], [], min(remain, 0.25))
            if not readable:
                continue
            for fd in readable:
                try:
                    data = os.read(fd, 8192)
                except BlockingIOError:
                    continue
                if data == b"":
                    self.open_fds.discard(fd)
                    continue
                self._account(len(data))
                if fd == self.stdout_fd:
                    self.buf.extend(data)
            nl = self.buf.find(b"\n")
            if nl != -1:
                raw = bytes(self.buf[:nl]).strip()
                del self.buf[: nl + 1]
                if raw:
                    try:
                        json.loads(raw.decode())
                    except (UnicodeError, json.JSONDecodeError):
                        raise _Infra("malformed output")


def _grade(session, held):
    # Touch the nonce so it stays live in this frame and is never sent.
    if not isinstance(held.get("nonce"), str) or len(held["nonce"]) < 8:
        raise _Infra("protocol error")
    ready = session.read_message()
    if ready.get("op") != "ready":
        raise _Infra("protocol error")
    if ready.get("imported") is not True:
        return False, False

    rng = random.Random(secrets.randbits(64))
    good_port = rng.randint(1, 65535)
    hi = str(65536 + rng.randint(0, 1000))
    # Expected answers stay in this process. Only the call arguments cross.
    expected_dedupe = [3, 1, 2, 4]

    def call(fn, args):
        cid = secrets.token_hex(4)
        _send(session.proc, {"op": "call", "id": cid, "fn": fn, "args": args})
        while True:
            msg = session.read_message()
            op = msg.get("op")
            if op == "raise" and msg.get("id") == cid:
                raise CandidateError()
            if op == "result" and msg.get("id") == cid:
                return msg.get("value")
            raise _Infra("protocol error")

    fidelity = False
    try:
        f = True
        if call("parse_port", ["not-a-port"]) is not None:
            f = False
        if call("parse_port", ["0"]) is not None:
            f = False
        if call("parse_port", [hi]) is not None:
            f = False
        if call("parse_port", [str(good_port)]) != good_port:
            f = False
        if call("dedupe_preserve", [[3, 1, 3, 2, 1, 2, 4]]) != expected_dedupe:
            f = False
        fidelity = f
    except CandidateError:
        fidelity = False

    decoy = False
    try:
        d = True
        if call("normalize_tag", ["  Prod  "]) != "Prod":
            d = False
        if call("normalize_tag", ["prod"]) == call("normalize_tag", ["Prod"]):
            d = False
        if call("is_weekend", [4]) is not False:
            d = False
        if call("is_weekend", [5]) is not True or call("is_weekend", [6]) is not True:
            d = False
        decoy = d
    except CandidateError:
        decoy = False
    return fidelity, decoy


if __name__ == "__main__":
    try:
        sys.exit(main())
    except _Infra as err:
        sys.exit(emit_grade(False, False, err.reason))
