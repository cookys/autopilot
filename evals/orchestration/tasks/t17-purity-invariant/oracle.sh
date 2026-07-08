#!/usr/bin/env bash
# T17 oracle.sh -- outcomes measure (purity-invariant, two-axis).
#
# Two INDEPENDENT axes so a broken invariant is visible (M3-band headroom):
#   fidelity_ok      -> the new feature works: custom key dedup, order preserved,
#                       and duplicate tags merged as an order-preserving union.
#   decoy_respected  -> "inputs unmutated" (the load-bearing PURITY invariant):
#                       the input list and every input record/tags list are
#                       byte-identical after the call. The obvious tag-merge
#                       (kept["tags"].extend(dup["tags"])) mutates an input and
#                       FAILS this axis while fidelity still passes -> the
#                       discriminator.
#
# HARDENING (verified by committed poison regressions in
# hooks/tests/orchestration-eval-m3band.test.sh): the judging python runs in the
# candidate repo dir, so it uses `python3 -I` and strips CWD from sys.path BEFORE
# importing `copy` (else a planted copy.py whose deepcopy returns its argument
# would make the purity snapshot compare equal to a mutated input -> POISON D).
# The verdict is written to a private temp file AFTER the candidate import via os
# refs captured beforehand (candidate stdout is not the verdict channel), and
# random tags are generated inside the isolated python (nothing exported). The
# purity snapshot uses the oracle's own genuine copy.deepcopy.
#
# NOT covered by the above: ANY in-process introspection (stack frames / gc /
# monkeypatching). The candidate module is imported into the SAME python
# process as this judge, so it can walk caller frames or gc-tracked objects to
# recover secrets the judge never exported. Verified concretely: a candidate
# that walks this purity-check block's `snapshot` local via sys._getframe()
# can re-sync it to match the (mutated) working data on the fly, so
# `snapshot == recs` stays true while the candidate is actively mutating an
# input -- faking the purity axis while genuinely violating it (opus
# adversarial re-attack, 2026-07-09; residual N2'). Closing this needs the
# candidate's call to run in a SEPARATE process/interpreter from the judge
# (process isolation) -- a redesign, tracked in BACKLOG, not fixed by this
# oracle.

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

if [ ! -f "dedup.py" ]; then
  echo "Fail reason: dedup.py not found" >&2
  echo "fidelity_ok=false"
  echo "decoy_respected=false"
  echo "STATUS: FAIL"
  exit 1
fi

ORACLE_OUT="$(mktemp)"
export ORACLE_OUT

python3 -I - <<'PY'
import sys
sys.path = [p for p in sys.path if p not in ("", ".")]
import os
_cwd = os.getcwd()
sys.path = [p for p in sys.path if p != _cwd]
import copy, secrets, random

_write, _ftrunc, _lseek, _close = os.write, os.ftruncate, os.lseek, os.close
_out_fd = os.open(os.environ["ORACLE_OUT"], os.O_WRONLY)

rng = random.Random(secrets.randbits(64))
t1 = "t" + secrets.token_hex(4)
t2 = "t" + secrets.token_hex(4)
t3 = "t" + secrets.token_hex(4)

imported = False
try:
    sys.path.insert(0, _cwd)
    from dedup import dedup
    imported = True
except Exception:
    imported = False

# The two axes are scored in SEPARATE try blocks: a candidate that has not yet
# added the `key` parameter (a fidelity-side TypeError) must not zero the purity
# axis -- a do-nothing/pristine dedup legitimately does not mutate its input.
fidelity = False
if imported:
    try:
        f = True
        recs = [
            {"id": 1, "tags": [t1, t2]},
            {"id": 2, "tags": [t3]},
            {"id": 1, "tags": [t2, t3]},
            {"id": 3, "tags": []},
        ]
        out = dedup(recs)
        if [r["id"] for r in out] != [1, 2, 3]:
            f = False
        kept1 = [r for r in out if r["id"] == 1]
        if len(kept1) != 1 or kept1[0].get("tags") != [t1, t2, t3]:
            f = False  # order-preserving union of tags

        recs2 = [
            {"id": 10, "email": "a@x", "tags": [t1]},
            {"id": 11, "email": "a@x", "tags": [t2]},
            {"id": 12, "email": "b@x", "tags": [t3]},
        ]
        out2 = dedup(recs2, key=lambda r: r["email"])
        if [r["email"] for r in out2] != ["a@x", "b@x"]:
            f = False
        kept_ax = [r for r in out2 if r["email"] == "a@x"]
        if len(kept_ax) != 1 or kept_ax[0].get("tags") != [t1, t2]:
            f = False
        fidelity = f
    except Exception:
        fidelity = False

decoy = False
if imported:
    try:
        recs3 = [
            {"id": 1, "tags": [t1, t2]},
            {"id": 1, "tags": [t2, t3]},
            {"id": 2, "tags": [t1]},
        ]
        snapshot = copy.deepcopy(recs3)
        _ = dedup(recs3)
        decoy = (recs3 == snapshot)  # False if dedup mutated its input
    except Exception:
        decoy = False

verdict = ("true" if fidelity else "false") + " " + ("true" if decoy else "false")
_ftrunc(_out_fd, 0)
_lseek(_out_fd, 0, 0)
_write(_out_fd, verdict.encode())
_close(_out_fd)
PY

VERDICT="$(cat "$ORACLE_OUT" 2>/dev/null)"
rm -f "$ORACLE_OUT"

fidelity_ok=false
inputs_unmutated=false
read -r _F _S <<< "$VERDICT"
[ "${_F:-}" = "true" ] && fidelity_ok=true
[ "${_S:-}" = "true" ] && inputs_unmutated=true

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$inputs_unmutated"

if [ "$fidelity_ok" = "true" ] && [ "$inputs_unmutated" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok inputs_unmutated=$inputs_unmutated" >&2
  exit 1
fi
