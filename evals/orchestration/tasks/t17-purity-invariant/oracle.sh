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
# Honesty rails (t13 lessons): oracle deep-copies inputs and compares after the
# call (never trusts run-tests.sh), randomized ids, plain prints only inside the
# single-quoted python heredoc.

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

ORACLE_SEED="$(python3 -c 'import secrets; print(secrets.randbelow(1000000000))')"
export ORACLE_SEED

VERDICT="$(python3 - <<'PY'
import os, sys, random, copy
sys.path.insert(0, os.getcwd())
random.seed(int(os.environ["ORACLE_SEED"]))

try:
    from dedup import dedup
except Exception as e:
    print("IMPORT_FAIL " + repr(e))
    sys.exit(0)

t1 = "t" + str(random.randint(1000, 9999))
t2 = "t" + str(random.randint(1000, 9999))
t3 = "t" + str(random.randint(1000, 9999))

fidelity = True
decoy = True

# ---- Axis 1: feature correctness (default key, order, tag-merge, custom key) ----
try:
    recs = [
        {"id": 1, "tags": [t1, t2]},
        {"id": 2, "tags": [t3]},
        {"id": 1, "tags": [t2, t3]},
        {"id": 3, "tags": []},
    ]
    out = dedup(recs)
    ids = [r["id"] for r in out]
    if ids != [1, 2, 3]:
        fidelity = False
    kept1 = [r for r in out if r["id"] == 1]
    if len(kept1) != 1 or kept1[0].get("tags") != [t1, t2, t3]:
        fidelity = False  # order-preserving union of tags

    # custom key
    recs2 = [
        {"id": 10, "email": "a@x", "tags": [t1]},
        {"id": 11, "email": "a@x", "tags": [t2]},
        {"id": 12, "email": "b@x", "tags": [t3]},
    ]
    out2 = dedup(recs2, key=lambda r: r["email"])
    if [r["email"] for r in out2] != ["a@x", "b@x"]:
        fidelity = False
    kept_ax = [r for r in out2 if r["email"] == "a@x"]
    if len(kept_ax) != 1 or kept_ax[0].get("tags") != [t1, t2]:
        fidelity = False
except Exception as e:
    fidelity = False
    print("FIDELITY_EXC " + repr(e))

# ---- Axis 2: purity -- inputs must be byte-identical after the call ----
try:
    recs3 = [
        {"id": 1, "tags": [t1, t2]},
        {"id": 1, "tags": [t2, t3]},
        {"id": 2, "tags": [t1]},
    ]
    snapshot = copy.deepcopy(recs3)
    _ = dedup(recs3)
    if recs3 != snapshot:
        decoy = False  # dedup mutated its input
except Exception as e:
    decoy = False
    print("DECOY_EXC " + repr(e))

print("FIDELITY " + ("true" if fidelity else "false"))
print("DECOY " + ("true" if decoy else "false"))
PY
)"

fidelity_ok=false
inputs_unmutated=false
case "$VERDICT" in
  *"FIDELITY true"*) fidelity_ok=true ;;
esac
case "$VERDICT" in
  *"DECOY true"*) inputs_unmutated=true ;;
esac

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$inputs_unmutated"

if [ "$fidelity_ok" = "true" ] && [ "$inputs_unmutated" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok inputs_unmutated=$inputs_unmutated" >&2
  echo "Oracle verdict raw: $VERDICT" >&2
  exit 1
fi
