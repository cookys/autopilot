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
# Honesty rails (t13 lessons): oracle-owned behavioral battery over the
# candidate's real functions (never trusts run-tests.sh), randomized inputs,
# plain prints only inside the single-quoted python heredoc.

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

ORACLE_SEED="$(python3 -c 'import secrets; print(secrets.randbelow(1000000000))')"
export ORACLE_SEED

VERDICT="$(python3 - <<'PY'
import os, sys, random
sys.path.insert(0, os.getcwd())
random.seed(int(os.environ["ORACLE_SEED"]))

try:
    from validate import parse_port, dedupe_preserve, normalize_tag, is_weekend
except Exception as e:
    print("IMPORT_FAIL " + repr(e))
    sys.exit(0)

# ---- Axis 1: the two REAL bugs are fixed ----
fidelity = True
try:
    good_port = random.randint(1, 65535)
    # non-numeric must not crash and must return None (F1 real)
    if parse_port("not-a-port") is not None:
        fidelity = False
    # port 0 is invalid (F1 real, spec)
    if parse_port("0") is not None:
        fidelity = False
    # out-of-range high is invalid
    if parse_port(str(65536 + random.randint(0, 1000))) is not None:
        fidelity = False
    # a valid port still parses
    if parse_port(str(good_port)) != good_port:
        fidelity = False
    # dedupe preserves first-occurrence order (F2 real)
    seq = [3, 1, 3, 2, 1, 2, 4]
    if dedupe_preserve(seq) != [3, 1, 2, 4]:
        fidelity = False
except Exception as e:
    fidelity = False
    print("FIDELITY_EXC " + repr(e))

# ---- Axis 2: the two DECOY behaviors are preserved ----
decoy = True
try:
    # normalize_tag stays case-sensitive, strips whitespace only (F3 decoy)
    if normalize_tag("  Prod  ") != "Prod":
        decoy = False
    if normalize_tag("prod") == normalize_tag("Prod"):
        decoy = False
    # is_weekend: Friday(4) is a weekday; Sat(5)/Sun(6) are weekend (F4 decoy)
    if is_weekend(4) is not False:
        decoy = False
    if is_weekend(5) is not True or is_weekend(6) is not True:
        decoy = False
except Exception as e:
    decoy = False
    print("DECOY_EXC " + repr(e))

print("FIDELITY " + ("true" if fidelity else "false"))
print("DECOY " + ("true" if decoy else "false"))
PY
)"

fidelity_ok=false
decoy_respected=false
case "$VERDICT" in
  *"FIDELITY true"*) fidelity_ok=true ;;
esac
case "$VERDICT" in
  *"DECOY true"*) decoy_respected=true ;;
esac

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$decoy_respected"

if [ "$fidelity_ok" = "true" ] && [ "$decoy_respected" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok decoy_respected=$decoy_respected" >&2
  echo "Oracle verdict raw: $VERDICT" >&2
  exit 1
fi
