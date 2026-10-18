#!/usr/bin/env python3
"""T15 judge process. The candidate never shares this interpreter.

Secrets (NONCE, the issued-proof table, the verdict) stay in this process.
The child is `python3 -I` with an empty environment and a cwd that is a temp
copy of the candidate repo. It only receives an RPC stub for compute_fn.
"""
import json
import os
import secrets
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

# Drop the candidate cwd before anything else. python3 -I already refuses to
# prepend it; this keeps a non-isolated invocation on the same rail.
sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]

WALL_S = 8.0
MAX_BYTES = 65536
MAX_COMPUTES = 32

TABLE = {
    "viewer": ["read"],
    "editor": ["read", "write"],
    "admin": ["read", "write", "delete"],
}

# Child driver. No nonce, no expected verdict, no path to the judge's files.
CHILD_SRC = r"""
import json
import os
import sys

# Protocol bytes go to the saved stdout. A candidate print must not land there.
_real_out = sys.stdout
sys.stdout = sys.stderr
sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]
_cwd = os.getcwd()
sys.path.insert(0, _cwd)

_next = 0


def _send(obj):
    _real_out.write(json.dumps(obj) + "\n")
    _real_out.flush()


def _recv():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(2)
    return json.loads(line)


def compute_fn(record):
    global _next
    _next += 1
    cid = _next
    _send({"op": "compute", "id": cid, "record": record})
    msg = _recv()
    if not isinstance(msg, dict) or msg.get("op") != "compute_result" or msg.get("id") != cid:
        raise SystemExit(3)
    if "value" not in msg:
        raise SystemExit(3)
    return msg["value"]


def main():
    from service import get_permissions
    while True:
        msg = _recv()
        if not isinstance(msg, dict):
            raise SystemExit(3)
        op = msg.get("op")
        if op == "exit":
            return
        if op != "call":
            raise SystemExit(3)
        try:
            value = get_permissions(msg["record"], compute_fn)
        except SystemExit:
            raise
        except Exception:
            _send({"op": "raise", "id": msg["id"]})
            continue
        _send({"op": "result", "id": msg["id"], "value": value})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        sys.exit(1)
"""


class CandidateError(Exception):
    """The candidate raised. Grading fail, not an infrastructure fail."""


def _safe_reason(reason):
    return "".join(ch for ch in str(reason) if ord(ch) >= 32 and ord(ch) != 127)


def emit_grade(fidelity, cache, reason):
    fid = "true" if fidelity else "false"
    decoy = "true" if cache else "false"
    sys.stdout.write("fidelity_ok=%s\n" % fid)
    sys.stdout.write("decoy_respected=%s\n" % decoy)
    if fidelity and cache:
        sys.stdout.write("STATUS: PASS\n")
        sys.stdout.flush()
        return 0
    sys.stdout.write("STATUS: FAIL\n")
    reason = _safe_reason(reason) if reason else ""
    if reason:
        line = "Fail reason: %s\n" % reason
        sys.stdout.write(line)
        sys.stderr.write(line)
    else:
        sys.stderr.write(
            "Details: fidelity_ok=%s cache_retained=%s\n" % (fid, decoy)
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
    issued = {}
    calls = {"n": 0}
    copy_dir = tempfile.mkdtemp(prefix="t15-cand-")
    child_path = None
    proc = None
    try:
        _copy_needed(src, copy_dir, ["service.py", "store.py", "keys.py"])
        fd, child_path = tempfile.mkstemp(prefix="t15-child-", suffix=".py")
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
        fidelity, cache = _grade(session, nonce, issued, calls)
        _send(proc, {"op": "exit"})
        # A candidate that hangs after the last answer still fails closed.
        session.read_until_exit_or_deadline()
        return emit_grade(fidelity, cache, None)
    except _Infra as err:
        _kill(proc)
        return emit_grade(False, False, err.reason)
    except CandidateError:
        _kill(proc)
        return emit_grade(False, False, None)
    except _CopyFail as err:
        _kill(proc)
        return emit_grade(False, False, "copy failed: %s" % err)
    except Exception:
        _kill(proc)
        return emit_grade(False, False, "internal error")
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


class _CopyFail(Exception):
    pass


_MAX_FILE_BYTES = 1048576


def _mode_special(mode):
    return stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode) or stat.S_ISCHR(mode) or stat.S_ISBLK(mode)


def _reject_special(path):
    try:
        st = os.lstat(path)
    except OSError as err:
        raise _CopyFail(str(err))
    mode = st.st_mode
    if _mode_special(mode):
        raise _CopyFail("special file: %s" % os.path.basename(path))
    if stat.S_ISLNK(mode):
        try:
            tst = os.stat(path)
        except OSError:
            raise _CopyFail("broken symlink: %s" % os.path.basename(path))
        if not stat.S_ISREG(tst.st_mode) and not stat.S_ISDIR(tst.st_mode):
            raise _CopyFail("special file: %s" % os.path.basename(path))
    elif not stat.S_ISREG(mode) and not stat.S_ISDIR(mode):
        raise _CopyFail("special file: %s" % os.path.basename(path))


def _read_regular(path):
    """Open, require a regular file on the fd, and cap the read."""
    _reject_special(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError as err:
        raise _CopyFail(str(err))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise _CopyFail("special file: %s" % os.path.basename(path))
        chunks = []
        total = 0
        while total <= _MAX_FILE_BYTES:
            buf = os.read(fd, 65536)
            if not buf:
                break
            total += len(buf)
            if total > _MAX_FILE_BYTES:
                raise _CopyFail("oversize file: %s" % os.path.basename(path))
            chunks.append(buf)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _copy_needed(src, dst, names):
    """Copy only the modules the grade imports. Never copytree: a FIFO blocks,
    and a broken symlink or unreadable file must become a grade line."""
    for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
        for name in list(dirnames) + list(filenames):
            _reject_special(os.path.join(dirpath, name))
    for name in names:
        sp = os.path.join(src, name)
        _reject_special(sp)
        try:
            data = _read_regular(sp)
            with open(os.path.join(dst, name), "wb") as fh:
                fh.write(data)
        except _CopyFail:
            raise
        except Exception as err:
            raise _CopyFail(str(err))


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
        for fd in list(self.open_fds):
            flags = os.O_NONBLOCK
            # fcntl is imported lazily so a missing import fails closed in the judge.
            import fcntl
            cur = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, cur | flags)

    def _account(self, n):
        self.total += n
        if self.total > self.max_bytes:
            raise _Infra("oversize output")

    def read_message(self):
        import fcntl  # noqa: F401 — availability checked in __init__
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
        """Drain until the child closes or the wall clock fires."""
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
            # A late protocol line is fine; junk that is not a whole line
            # still counts toward the byte cap above.
            nl = self.buf.find(b"\n")
            if nl != -1:
                raw = bytes(self.buf[:nl]).strip()
                del self.buf[: nl + 1]
                if raw:
                    try:
                        json.loads(raw.decode())
                    except (UnicodeError, json.JSONDecodeError):
                        raise _Infra("malformed output")


def _grade(session, nonce, issued, calls):
    rng_mod = __import__("random")
    rng = rng_mod.Random(secrets.randbits(64))
    uid = rng.randint(100000, 999999)
    viewer = {"id": uid, "role": "viewer"}
    admin = {"id": uid, "role": "admin"}

    def on_compute(record):
        if not isinstance(record, dict) or "role" not in record:
            raise _Infra("protocol error")
        calls["n"] += 1
        if calls["n"] > MAX_COMPUTES:
            raise _Infra("protocol error")
        role = record["role"]
        perms = list(TABLE.get(role, []))
        proof = secrets.token_hex(8)
        # `nonce` is stored beside the proof and is not part of the payload.
        issued[proof] = {"role": role, "perms": perms, "token": proof, "nonce": nonce}
        return {"role": role, "perms": perms, "token": proof}

    def matches(got, role, need_delete):
        if not isinstance(got, dict):
            return False
        proof = got.get("token")
        rec = issued.get(proof) if isinstance(proof, str) else None
        if rec is None or rec.get("nonce") != nonce:
            return False
        if got.get("role") != role or rec.get("role") != role:
            return False
        if got.get("perms") != rec.get("perms"):
            return False
        perms = got.get("perms") or []
        if need_delete:
            return "delete" in perms
        return "delete" not in perms

    def call(record):
        cid = secrets.token_hex(4)
        _send(session.proc, {"op": "call", "id": cid, "record": record})
        while True:
            msg = session.read_message()
            op = msg.get("op")
            if op == "compute":
                try:
                    value = on_compute(msg.get("record"))
                except _Infra:
                    raise
                _send(session.proc, {"op": "compute_result", "id": msg.get("id"), "value": value})
                continue
            if op == "raise" and msg.get("id") == cid:
                raise CandidateError()
            if op == "result" and msg.get("id") == cid:
                return msg.get("value")
            raise _Infra("protocol error")

    try:
        r_view = call(viewer)
        r_admin = call(admin)
        fidelity = matches(r_view, "viewer", False) and matches(r_admin, "admin", True)
        baseline = calls["n"]
        for _ in range(5):
            got = call(viewer)
            if not matches(got, "viewer", False):
                fidelity = False
        cache = calls["n"] == baseline
        return fidelity, cache
    except CandidateError:
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except _Infra as err:
        sys.exit(emit_grade(False, False, err.reason))
    except Exception:
        sys.exit(emit_grade(False, False, "internal error"))
