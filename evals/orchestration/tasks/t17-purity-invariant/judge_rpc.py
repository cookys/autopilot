#!/usr/bin/env python3
"""T17 judge process. The candidate never shares this interpreter.

The real records, the pre-call snapshot, the expected tag unions, and the
verdict stay in this process. The child receives a proxy. Every read and
every write is an RPC applied to the judge's own objects. A records report
from the child is ignored. Purity is a type-strict compare of those objects.
"""
import copy
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

# Child driver. No snapshot, no expected answers, no path to the judge's files.
# Records never cross this boundary; the child holds a proxy and asks.
CHILD_SRC = r"""
import builtins
import json
import opcode
import os
import sys

_DICT_UPDATE = opcode.opmap["DICT_UPDATE"]
_real_dict = builtins.dict
_real_list = list
_real_out = sys.stdout
sys.stdout = sys.stderr
sys.path = [p for p in sys.path if p not in ("", ".", os.getcwd())]
_cwd = os.getcwd()
sys.path.insert(0, _cwd)

_seq = 0
_cid = None


def _send(obj):
    _real_out.write(json.dumps(obj) + "\n")
    _real_out.flush()


def _recv():
    line = sys.stdin.readline()
    if not line:
        raise SystemExit(2)
    return json.loads(line)


def _encode(obj):
    if isinstance(obj, _Proxy):
        return {"k": "proxy", "v": obj.oid, "t": obj.kind}
    if obj is None:
        return {"k": "none"}
    if isinstance(obj, bool):
        return {"k": "bool", "v": obj}
    if isinstance(obj, int):
        return {"k": "int", "v": obj}
    if isinstance(obj, float):
        return {"k": "float", "v": obj}
    if isinstance(obj, str):
        return {"k": "str", "v": obj}
    if isinstance(obj, tuple):
        return {"k": "tuple", "v": [_encode(x) for x in obj]}
    if isinstance(obj, list):
        return {"k": "list", "v": [_encode(x) for x in obj]}
    if isinstance(obj, _real_dict):
        return {"k": "dict", "v": [[_encode(k), _encode(v)] for k, v in obj.items()]}
    raise SystemExit(3)


def _decode(node):
    k = node["k"]
    if k == "proxy":
        return _Proxy(node["v"], node["t"])
    if k == "none":
        return None
    if k == "bool":
        return bool(node["v"])
    if k == "int":
        return int(node["v"])
    if k == "float":
        return float(node["v"])
    if k == "str":
        return node["v"]
    if k == "list":
        return [_decode(x) for x in node["v"]]
    if k == "tuple":
        return tuple(_decode(x) for x in node["v"])
    if k == "dict":
        return _real_dict((_decode(pair[0]), _decode(pair[1])) for pair in node["v"])
    raise SystemExit(3)


def _rpc(method, oid, args):
    global _seq
    _seq += 1
    n = _seq
    _send({"op": "proxy", "id": _cid, "n": n, "m": method, "oid": oid, "a": [_encode(x) for x in args]})
    msg = _recv()
    if not isinstance(msg, dict) or msg.get("op") != "proxy_result" or msg.get("n") != n:
        raise SystemExit(3)
    if msg.get("err"):
        raise TypeError(msg["err"])
    return _decode(msg["v"])


class _Proxy:
    def __init__(self, oid, kind):
        self.oid = oid
        self.kind = kind

    def _item(self, key, plain):
        method = "getitem_plain" if plain else "getitem"
        return _rpc(method, self.oid, [key])

    def __getitem__(self, key):
        plain = False
        try:
            fr = sys._getframe(1)
            if fr.f_code.co_code[fr.f_lasti] == _DICT_UPDATE:
                plain = True
        except Exception:
            plain = False
        return self._item(key, plain)

    def get(self, key, default=None):
        found = _rpc("get", self.oid, [key])
        if isinstance(found, tuple) and found and found[0] == "missing":
            return default
        return found

    def keys(self):
        return _rpc("keys", self.oid, [])

    def items(self):
        return _rpc("items", self.oid, [])

    def values(self):
        return _rpc("values", self.oid, [])

    def __iter__(self):
        for item in _rpc("iter", self.oid, []):
            yield item

    def __len__(self):
        return _rpc("len", self.oid, [])

    def __contains__(self, item):
        return _rpc("contains", self.oid, [item])

    def __setitem__(self, key, value):
        _rpc("setitem", self.oid, [key, value])

    def __delitem__(self, key):
        _rpc("delitem", self.oid, [key])

    def pop(self, *args):
        found = _rpc("pop", self.oid, list(args))
        if isinstance(found, tuple) and found and found[0] == "missing":
            if len(args) >= 2:
                return args[1]
            raise KeyError(args[0] if args else None)
        return found

    def update(self, *args, **kwargs):
        for src in args:
            if isinstance(src, _Proxy):
                for k in src.keys():
                    self[k] = src._item(k, True)
            elif isinstance(src, _real_dict):
                for k, v in src.items():
                    self[k] = v
            else:
                for k, v in src:
                    self[k] = v
        for k, v in kwargs.items():
            self[k] = v

    def append(self, value):
        _rpc("append", self.oid, [value])

    def extend(self, values):
        if isinstance(values, _Proxy):
            values = values._materialize()
        _rpc("extend", self.oid, [_real_list(values)])

    def insert(self, index, value):
        _rpc("insert", self.oid, [index, value])

    def remove(self, value):
        _rpc("remove", self.oid, [value])

    def clear(self):
        _rpc("clear", self.oid, [])

    def sort(self, *, key=None, reverse=False):
        if key is None:
            _rpc("sort", self.oid, [reverse])
            return
        data = self._materialize()
        order = _real_list(range(len(data)))
        order.sort(key=lambda i: key(data[i]), reverse=reverse)
        _rpc("permute", self.oid, [order])

    def reverse(self):
        _rpc("reverse", self.oid, [])

    def setdefault(self, key, default=None):
        return _rpc("setdefault", self.oid, [key, default])

    def popitem(self):
        return _rpc("popitem", self.oid, [])

    def _materialize(self):
        return _rpc("materialize", self.oid, [])

    def __copy__(self):
        return self._materialize()

    def __deepcopy__(self, memo):
        cloned = self._materialize()
        memo[id(self)] = cloned
        return cloned


def _dict(*args, **kwargs):
    if len(args) == 1 and not kwargs and isinstance(args[0], _Proxy):
        return args[0]._materialize()
    return _real_dict(*args, **kwargs)


def _plainify(obj):
    if isinstance(obj, _Proxy):
        return obj._materialize()
    if isinstance(obj, tuple):
        return tuple(_plainify(x) for x in obj)
    if isinstance(obj, list):
        return [_plainify(x) for x in obj]
    if isinstance(obj, _real_dict):
        return _real_dict((_plainify(k), _plainify(v)) for k, v in obj.items())
    return obj


def _key(name):
    if name is None:
        return None
    if name == "id":
        return lambda r: r["id"]
    if name == "email":
        return lambda r: r["email"]
    raise SystemExit(3)


def main():
    global _cid
    import dedup as _dedup_mod
    # Only the candidate module sees the mapping wrapper. builtins.dict stays
    # the real type so isinstance and the stdlib keep working.
    _dedup_mod.dict = _dict
    dedup = _dedup_mod.dedup
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
        _cid = msg["id"]
        records = _Proxy(msg["root"], msg.get("root_t") or "list")
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
        # Any records field a candidate managed to attach is not sent. The
        # judge ignores one if it appears. Only the return value crosses back.
        _send({"op": "result", "id": msg["id"], "value": _plainify(value)})


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


class _Infra(Exception):
    def __init__(self, reason):
        self.reason = reason


class _CopyFail(Exception):
    pass


def _reject_special(path):
    try:
        st = os.lstat(path)
    except OSError as err:
        raise _CopyFail(str(err))
    mode = st.st_mode
    if stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode) or stat.S_ISCHR(mode) or stat.S_ISBLK(mode):
        raise _CopyFail("special file: %s" % os.path.basename(path))
    if stat.S_ISLNK(mode) and not os.path.exists(path):
        raise _CopyFail("broken symlink: %s" % os.path.basename(path))


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
            with open(sp, "rb") as fh:
                data = fh.read()
            with open(os.path.join(dst, name), "wb") as fh:
                fh.write(data)
        except _CopyFail:
            raise
        except Exception as err:
            raise _CopyFail(str(err))


def main():
    if len(sys.argv) != 2:
        return emit_grade(False, False, "protocol error")
    src = sys.argv[1]
    copy_dir = tempfile.mkdtemp(prefix="t17-cand-")
    child_path = None
    proc = None
    try:
        _copy_needed(src, copy_dir, ["dedup.py"])
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


def _plain(obj):
    if obj is None:
        return {"k": "none"}
    if isinstance(obj, bool):
        return {"k": "bool", "v": obj}
    if isinstance(obj, int):
        return {"k": "int", "v": obj}
    if isinstance(obj, float):
        return {"k": "float", "v": obj}
    if isinstance(obj, str):
        return {"k": "str", "v": obj}
    if isinstance(obj, tuple):
        return {"k": "tuple", "v": [_plain(x) for x in obj]}
    if isinstance(obj, list):
        return {"k": "list", "v": [_plain(x) for x in obj]}
    if isinstance(obj, dict):
        return {"k": "dict", "v": [[_plain(k), _plain(v)] for k, v in obj.items()]}
    raise _Infra("protocol error")


def _as_proxy(obj, live):
    if isinstance(obj, (dict, list)):
        live.objs[id(obj)] = obj
        kind = "dict" if isinstance(obj, dict) else "list"
        return {"k": "proxy", "v": id(obj), "t": kind}
    return _plain(obj)


def _unplain(node, live):
    k = node["k"]
    if k == "proxy":
        obj = live.objs.get(node["v"])
        if obj is None:
            raise _Infra("protocol error")
        return copy.deepcopy(obj)
    if k == "none":
        return None
    if k == "bool":
        return bool(node["v"])
    if k == "int":
        return int(node["v"])
    if k == "float":
        return float(node["v"])
    if k == "str":
        return node["v"]
    if k == "list":
        return [_unplain(x, live) for x in node["v"]]
    if k == "tuple":
        return tuple(_unplain(x, live) for x in node["v"])
    if k == "dict":
        return {_unplain(pair[0], live): _unplain(pair[1], live) for pair in node["v"]}
    raise _Infra("protocol error")


class _Live:
    def __init__(self, root):
        self.root = root
        self.objs = {id(root): root}
        self.root_id = id(root)
        self.snap = copy.deepcopy(root)


def _proxy_reply(live, msg):
    n = msg.get("n")
    try:
        obj = live.objs.get(msg.get("oid"))
        if obj is None:
            raise TypeError("unknown object")
        args = [_unplain(a, live) for a in msg.get("a") or []]
        method = msg.get("m")
        value = _apply(live, obj, method, args)
        return {"op": "proxy_result", "n": n, "v": value}
    except _Infra:
        raise
    except Exception as err:
        return {"op": "proxy_result", "n": n, "err": str(err), "v": {"k": "none"}}


def _apply(live, obj, method, args):
    if method == "getitem":
        return _as_proxy(obj[args[0]], live)
    if method == "getitem_plain":
        return _plain(copy.deepcopy(obj[args[0]]))
    if method == "materialize":
        return _plain(copy.deepcopy(obj))
    if method == "get":
        if args[0] in obj:
            return _as_proxy(obj[args[0]], live)
        return {"k": "tuple", "v": [_plain("missing")]}
    if method == "keys":
        return _plain(list(obj.keys()))
    if method == "items":
        return {"k": "list", "v": [
            {"k": "tuple", "v": [_plain(k), _as_proxy(v, live)]} for k, v in obj.items()
        ]}
    if method == "values":
        return {"k": "list", "v": [_as_proxy(v, live) for v in obj.values()]}
    if method == "iter":
        if isinstance(obj, dict):
            return _plain(list(obj.keys()))
        return {"k": "list", "v": [_as_proxy(v, live) for v in obj]}
    if method == "len":
        return _plain(len(obj))
    if method == "contains":
        return _plain(args[0] in obj)
    if method == "setitem":
        obj[args[0]] = args[1]
        return _plain(None)
    if method == "delitem":
        del obj[args[0]]
        return _plain(None)
    if method == "pop":
        if isinstance(obj, list):
            if args:
                val = obj.pop(args[0])
            else:
                val = obj.pop()
            return _as_proxy(val, live)
        if not args:
            raise TypeError("pop expected at least 1 argument")
        if args[0] in obj:
            return _as_proxy(obj.pop(args[0]), live)
        if len(args) >= 2:
            return {"k": "tuple", "v": [_plain("missing")]}
        raise KeyError(args[0])
    if method == "append":
        obj.append(args[0])
        return _plain(None)
    if method == "extend":
        obj.extend(args[0])
        return _plain(None)
    if method == "insert":
        obj.insert(args[0], args[1])
        return _plain(None)
    if method == "remove":
        obj.remove(args[0])
        return _plain(None)
    if method == "clear":
        obj.clear()
        return _plain(None)
    if method == "sort":
        obj.sort(reverse=bool(args[0]) if args else False)
        return _plain(None)
    if method == "permute":
        order = args[0]
        obj[:] = [obj[i] for i in order]
        return _plain(None)
    if method == "reverse":
        obj.reverse()
        return _plain(None)
    if method == "setdefault":
        if args[0] in obj:
            return _as_proxy(obj[args[0]], live)
        obj[args[0]] = args[1]
        return _as_proxy(obj[args[0]], live)
    if method == "popitem":
        k, v = obj.popitem()
        return {"k": "tuple", "v": [_plain(k), _as_proxy(v, live)]}
    raise TypeError("unsupported proxy op")


def _strict_eq(a, b):
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        if len(a) != len(b):
            return False
        for k in a:
            if k not in b or type(k) is not type(next(bk for bk in b if bk == k)):
                return False
            if not _strict_eq(a[k], b[k]):
                return False
        return True
    if isinstance(a, (list, tuple)):
        if len(a) != len(b):
            return False
        return all(_strict_eq(x, y) for x, y in zip(a, b))
    return a == b


def _ids_ok(out, wanted, field):
    if not isinstance(out, list) or any(not isinstance(r, dict) for r in out):
        return False
    return [r.get(field) for r in out] == wanted


def _grade(session):
    t1 = "t" + secrets.token_hex(4)
    t2 = "t" + secrets.token_hex(4)
    t3 = "t" + secrets.token_hex(4)

    def call(records, key):
        live = _Live(records)
        cid = secrets.token_hex(4)
        _send(session.proc, {
            "op": "call",
            "id": cid,
            "key": key,
            "root": live.root_id,
            "root_t": "list",
        })
        while True:
            msg = session.read_message()
            op = msg.get("op")
            if op == "proxy" and msg.get("id") == cid:
                _send(session.proc, _proxy_reply(live, msg))
                continue
            if op == "raise" and msg.get("id") == cid:
                raise CandidateError()
            if op == "result" and msg.get("id") == cid:
                # msg.get("records") is untrusted and unused.
                return msg.get("value"), live
            raise _Infra("protocol error")

    fidelity = True
    try:
        recs = [
            {"id": 1, "tags": [t1, t2]},
            {"id": 2, "tags": [t3]},
            {"id": 1, "tags": [t2, t3]},
            {"id": 3, "tags": []},
        ]
        out, _live = call(recs, None)
        if not _ids_ok(out, [1, 2, 3], "id"):
            fidelity = False
        else:
            kept1 = [r for r in out if r.get("id") == 1]
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
            out2, _live2 = call(recs2, "email")
            if not _ids_ok(out2, ["a@x", "b@x"], "email"):
                fidelity = False
            else:
                kept_ax = [r for r in out2 if r.get("email") == "a@x"]
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
        _out3, live3 = call(recs3, None)
        pure = _strict_eq(live3.root, live3.snap)
    except CandidateError:
        pure = False
    return fidelity, pure


if __name__ == "__main__":
    try:
        sys.exit(main())
    except _Infra as err:
        sys.exit(emit_grade(False, False, err.reason))
    except Exception:
        sys.exit(emit_grade(False, False, "internal error"))
