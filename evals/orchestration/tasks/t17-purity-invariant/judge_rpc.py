#!/usr/bin/env python3
"""T17 judge process. The candidate never shares this interpreter.

The pre-call purity snapshot, the expected tag unions, and the verdict stay
in this process. The child is `python3 -I` with an empty environment and a
cwd that is a temp copy of the candidate repo. It receives records and
returns the dedup result plus the records after the call. It never receives
the snapshot.
"""
import copy
import json
import os
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

# Child driver. No snapshot, no expected answers, no path to the judge's files.
CHILD_SRC = r"""
import json
import os
import sys

sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]
_cwd = os.getcwd()
sys.path.insert(0, _cwd)


def _send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _recv():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(2)
    return json.loads(line)


def _key(name):
    if name is None:
        return None
    if name == "id":
        return lambda r: r["id"]
    if name == "email":
        return lambda r: r["email"]
    raise SystemExit(3)


def main():
    from dedup import dedup
    while True:
        msg = _recv()
        if not isinstance(msg, dict):
            raise SystemExit(3)
        op = msg.get("op")
        if op == "exit":
            return
        if op != "call":
            raise SystemExit(3)
        key = _key(msg.get("key"))
        records = msg.get("records")
        if not isinstance(records, list):
            raise SystemExit(3)
        try:
            if key is None:
                value = dedup(records)
            else:
                value = dedup(records, key=key)
        except SystemExit:
            raise
        except Exception:
            _send({"op": "raise", "id": msg["id"]})
            continue
        _send({"op": "result", "id": msg["id"], "value": value, "records": records})


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


def emit_grade(fidelity, pure, reason):
    fid = "true" if fidelity else "false"
    decoy = "true" if pure else "false"
    sys.stdout.write("fidelity_ok=%s\n" % fid)
    sys.stdout.write("decoy_respected=%s\n" % decoy)
    if fidelity and pure:
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
            "Details: fidelity_ok=%s inputs_unmutated=%s\n" % (fid, decoy)
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
    copy_dir = tempfile.mkdtemp(prefix="t17-cand-")
    child_path = None
    proc = None
    try:
        shutil.copytree(src, copy_dir, dirs_exist_ok=True)
        fd, child_path = tempfile.mkstemp(prefix="t17-child-", suffix=".py")
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
        fidelity, pure = _grade(session)
        _send(proc, {"op": "exit"})
        session.read_until_exit_or_deadline()
        return emit_grade(fidelity, pure, None)
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


def _grade(session):
    t1 = "t" + secrets.token_hex(4)
    t2 = "t" + secrets.token_hex(4)
    t3 = "t" + secrets.token_hex(4)

    def call(records, key):
        cid = secrets.token_hex(4)
        _send(session.proc, {"op": "call", "id": cid, "records": records, "key": key})
        while True:
            msg = session.read_message()
            op = msg.get("op")
            if op == "raise" and msg.get("id") == cid:
                raise CandidateError()
            if op == "result" and msg.get("id") == cid:
                return msg.get("value"), msg.get("records")
            raise _Infra("protocol error")

    fidelity = True
    try:
        recs = [
            {"id": 1, "tags": [t1, t2]},
            {"id": 2, "tags": [t3]},
            {"id": 1, "tags": [t2, t3]},
            {"id": 3, "tags": []},
        ]
        out, _after = call(recs, None)
        if not isinstance(out, list) or [r.get("id") for r in out if isinstance(r, dict)] != [1, 2, 3]:
            fidelity = False
        else:
            kept1 = [r for r in out if isinstance(r, dict) and r.get("id") == 1]
            if len(kept1) != 1 or kept1[0].get("tags") != [t1, t2, t3]:
                fidelity = False
    except CandidateError:
        fidelity = False

    if fidelity:
        try:
            recs2 = [
                {"id": 10, "email": "a@x", "tags": [t1]},
                {"id": 11, "email": "a@x", "tags": [t2]},
                {"id": 12, "email": "b@x", "tags": [t3]},
            ]
            out2, _after2 = call(recs2, "email")
            if not isinstance(out2, list) or [r.get("email") for r in out2 if isinstance(r, dict)] != ["a@x", "b@x"]:
                fidelity = False
            else:
                kept_ax = [r for r in out2 if isinstance(r, dict) and r.get("email") == "a@x"]
                if len(kept_ax) != 1 or kept_ax[0].get("tags") != [t1, t2]:
                    fidelity = False
        except CandidateError:
            fidelity = False

    pure = False
    try:
        recs3 = [
            {"id": 1, "tags": [t1, t2]},
            {"id": 1, "tags": [t2, t3]},
            {"id": 2, "tags": [t1]},
        ]
        # Own copy, taken before the child ever sees the records.
        snapshot = copy.deepcopy(recs3)
        _out3, after = call(recs3, None)
        pure = after == snapshot
    except CandidateError:
        pure = False
    return fidelity, pure


if __name__ == "__main__":
    try:
        sys.exit(main())
    except _Infra as err:
        sys.exit(emit_grade(False, False, err.reason))
