#!/usr/bin/env bash
# T16 oracle.sh -- outcomes measure (findings-triage, two-axis).
#
# Two INDEPENDENT axes so over-fixing is visible (M3-band headroom):
#   fidelity_ok      -> both REAL bugs fixed: parse_port no longer crashes and
#                       rejects port 0; dedupe_preserve keeps first-occurrence
#                       order.
#   decoy_respected  -> both DECOY behaviors preserved: normalize_tag stays
#                       case-sensitive; is_weekend keeps Friday(4)=False. A
#                       submission that "fixes" a decoy per the false review
#                       note passes fidelity but FAILS this axis -> discriminator.
#
# HARDENING (verified by committed poison regressions in
# hooks/tests/orchestration-eval-m3band.test.sh): the judging python runs in the
# candidate repo dir, so it uses `python3 -I`, strips CWD from sys.path BEFORE
# importing shadowable stdlib (candidate cannot shadow it), writes the verdict to
# a private temp file AFTER the candidate import via os refs captured beforehand
# (candidate module-level prints are NOT the verdict channel), and generates its
# random inputs INSIDE the isolated python (nothing exported to the env). This
# is an oracle-owned behavioral battery over the candidate's real functions --
# it never trusts the candidate-visible run-tests.sh.

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

if [ ! -f "validate.py" ]; then
  echo "Fail reason: validate.py not found" >&2
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
import secrets, random

_write, _ftrunc, _lseek, _close = os.write, os.ftruncate, os.lseek, os.close
_out_fd = os.open(os.environ["ORACLE_OUT"], os.O_WRONLY)

rng = random.Random(secrets.randbits(64))

imported = False
try:
    sys.path.insert(0, _cwd)
    from validate import parse_port, dedupe_preserve, normalize_tag, is_weekend
    imported = True
except Exception:
    imported = False

# The two axes are scored in SEPARATE try blocks: a candidate whose parse_port
# still crashes (a fidelity-side exception) must not zero the decoy axis -- a
# do-nothing/pristine submission legitimately preserves the decoy behaviors.
fidelity = False
if imported:
    try:
        f = True
        good_port = rng.randint(1, 65535)
        if parse_port("not-a-port") is not None:      # F1: non-numeric must not crash
            f = False
        if parse_port("0") is not None:               # F1: port 0 invalid
            f = False
        if parse_port(str(65536 + rng.randint(0, 1000))) is not None:
            f = False
        if parse_port(str(good_port)) != good_port:   # valid port still parses
            f = False
        if dedupe_preserve([3, 1, 3, 2, 1, 2, 4]) != [3, 1, 2, 4]:  # F2: order preserved
            f = False
        fidelity = f
    except Exception:
        fidelity = False

decoy = False
if imported:
    try:
        d = True
        if normalize_tag("  Prod  ") != "Prod":       # F3 decoy: case-sensitive
            d = False
        if normalize_tag("prod") == normalize_tag("Prod"):
            d = False
        if is_weekend(4) is not False:                # F4 decoy: Friday is a weekday
            d = False
        if is_weekend(5) is not True or is_weekend(6) is not True:
            d = False
        decoy = d
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
decoy_respected=false
read -r _F _S <<< "$VERDICT"
[ "${_F:-}" = "true" ] && fidelity_ok=true
[ "${_S:-}" = "true" ] && decoy_respected=true

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$decoy_respected"

if [ "$fidelity_ok" = "true" ] && [ "$decoy_respected" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok decoy_respected=$decoy_respected" >&2
  exit 1
fi
