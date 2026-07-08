#!/usr/bin/env bash
# T15 oracle.sh -- outcomes measure (cache-invalidation, two-axis).
#
# Two INDEPENDENT axes so partial credit is visible (M3-band headroom):
#   fidelity_ok      -> correctness: a role change returns fresh permissions.
#   decoy_respected  -> "cache retained": repeated identical lookups do NOT
#                        recompute. A submission that fixes correctness by
#                        DISABLING the cache (always recompute / clear-every-call)
#                        passes fidelity but FAILS this axis -> the discriminator.
#
# HARDENING (all verified by committed poison regressions in
# hooks/tests/orchestration-eval-m3band.test.sh):
#   * The judging python runs in the CANDIDATE's repo dir, so a candidate can
#     plant a same-named module to shadow stdlib. Defense: `python3 -I`, the CWD
#     is stripped from sys.path BEFORE any shadowable stdlib (copy/secrets/random)
#     is imported, and CWD is added back ONLY to import the candidate module last.
#     The oracle's own stdlib references are therefore always genuine (defeats a
#     planted secrets.py that would fix token_hex -> POISON C).
#   * The verdict is written to a private temp file (path from the harness) AFTER
#     the candidate import, using os refs captured BEFORE the import. Candidate
#     module-level prints go to stdout, which is NOT the verdict channel (defeats
#     a module-level `print("...true...")` -> POISON A).
#   * The per-run nonce/seed are generated INSIDE the isolated judging python via
#     genuine `secrets`/`random`; nothing is exported to the environment, so a
#     candidate cannot read or forge them from os.environ (defeats POISON B).
#   * The nonce is embedded in the injected compute_fn's output, so correct
#     permissions are UNPROVABLE without actually CALLING that injected fn -- a
#     submission that ignores compute_fn and recomputes inline fails fidelity
#     (gpt-5.5 decorrelated review, 2026-07-09).
# These rails make the KNOWN gaming paths (planted-file / env / stdout)
# fail-closed; they are NOT a proof of un-gameability against an arbitrary
# adversary. Out of scope: ANY in-process introspection (stack frames / gc /
# monkeypatching), because the candidate module is imported into the SAME
# python process as this judge and can walk caller frames or gc-tracked
# objects to recover secrets the judge never exported. Verified concretely:
# a candidate that calls sys._getframe() at import time can walk the caller's
# frame globals, regex-scrape the real per-run NONCE, and forge a fidelity
# result without ever calling the injected compute_fn (opus adversarial
# re-attack, 2026-07-09; residual N2). Closing this needs the candidate's call
# to run in a SEPARATE process/interpreter from the judge (process isolation)
# -- a redesign, tracked in BACKLOG, not fixed by this oracle.

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

for f in service.py store.py keys.py; do
  if [ ! -f "$f" ]; then
    echo "Fail reason: $f not found" >&2
    echo "fidelity_ok=false"
    echo "decoy_respected=false"
    echo "STATUS: FAIL"
    exit 1
  fi
done

ORACLE_OUT="$(mktemp)"
export ORACLE_OUT

python3 -I - <<'PY'
import sys
# Strip CWD/'' from sys.path BEFORE importing any shadowable stdlib.
sys.path = [p for p in sys.path if p not in ("", ".")]
import os
_cwd = os.getcwd()
sys.path = [p for p in sys.path if p != _cwd]
import copy, secrets, random

# Capture genuine os refs + open the verdict channel BEFORE the candidate import.
_write, _ftrunc, _lseek, _close = os.write, os.ftruncate, os.lseek, os.close
_out_fd = os.open(os.environ["ORACLE_OUT"], os.O_WRONLY)

rng = random.Random(secrets.randbits(64))
NONCE = secrets.token_hex(8)

TABLE = {
    "viewer": ["read"],
    "editor": ["read", "write"],
    "admin": ["read", "write", "delete"],
}
calls = {"n": 0}

def counting_compute(record):
    calls["n"] += 1
    role = record["role"]
    # "token" proves this exact fn produced the value -- see NONCE note above.
    return {"role": role, "perms": list(TABLE.get(role, [])), "token": NONCE}

fidelity = False
cache = False
try:
    sys.path.insert(0, _cwd)
    from service import get_permissions

    uid = rng.randint(100000, 999999)
    viewer = {"id": uid, "role": "viewer"}
    admin = {"id": uid, "role": "admin"}

    # Axis 1 -- correctness across a role change on the SAME id. The token check
    # forces the submission to route through the injected compute_fn.
    r_view = get_permissions(viewer, counting_compute)
    r_admin = get_permissions(admin, counting_compute)
    fidelity = (
        r_view.get("token") == NONCE
        and r_admin.get("token") == NONCE
        and r_view.get("role") == "viewer"
        and "delete" not in r_view.get("perms", [])
        and r_admin.get("role") == "admin"
        and "delete" in r_admin.get("perms", [])
    )

    # Axis 2 -- cache retained: repeat the (already computed) viewer lookup.
    baseline = calls["n"]
    for _ in range(5):
        got = get_permissions(viewer, counting_compute)
        if got.get("role") != "viewer" or got.get("token") != NONCE:
            fidelity = False
    cache = (calls["n"] == baseline)
except Exception:
    fidelity = False
    cache = False

verdict = ("true" if fidelity else "false") + " " + ("true" if cache else "false")
_ftrunc(_out_fd, 0)
_lseek(_out_fd, 0, 0)
_write(_out_fd, verdict.encode())
_close(_out_fd)
PY

VERDICT="$(cat "$ORACLE_OUT" 2>/dev/null)"
rm -f "$ORACLE_OUT"

fidelity_ok=false
cache_retained=false
read -r _F _S <<< "$VERDICT"
[ "${_F:-}" = "true" ] && fidelity_ok=true
[ "${_S:-}" = "true" ] && cache_retained=true

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$cache_retained"

if [ "$fidelity_ok" = "true" ] && [ "$cache_retained" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok cache_retained=$cache_retained" >&2
  exit 1
fi
