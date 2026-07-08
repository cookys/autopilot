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
# Honesty rails (t13 lessons):
#   * Oracle-owned drive: the oracle injects its OWN counting compute_fn and
#     drives the candidate's real service/store/keys code. Nothing is inferred
#     from candidate-visible run-tests.sh (which never reveals the cache axis),
#     so a submission that only games run-tests.sh still fails the hidden axis.
#   * Randomized ids per run -> no output can be hardcoded.
#   * Plain prints only inside the single-quoted python heredoc (no escaped
#     f-string quoting -> no silent SyntaxError).

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

ORACLE_SEED="$(python3 -c 'import secrets; print(secrets.randbelow(1000000000))')"
export ORACLE_SEED
# Per-run NONCE embedded in the injected compute_fn's output. Correct
# permissions are then UNPROVABLE without actually CALLING that injected fn --
# so a submission that ignores compute_fn and recomputes inline (with or without
# caching) fails the fidelity axis, and the compute-call counter used by the
# cache axis measures real caching rather than "never used my fn". (gpt-5.5
# decorrelated review, 2026-07-09: without this a canned-inline no-cache cheat
# was a FALSE PASS on both axes.)
ORACLE_NONCE="$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
export ORACLE_NONCE

VERDICT="$(python3 - <<'PY'
import os, sys, random
sys.path.insert(0, os.getcwd())
random.seed(int(os.environ["ORACLE_SEED"]))
NONCE = os.environ["ORACLE_NONCE"]

try:
    from service import get_permissions
except Exception as e:
    print("IMPORT_FAIL " + repr(e))
    sys.exit(0)

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

uid = random.randint(100000, 999999)
viewer = {"id": uid, "role": "viewer"}
admin = {"id": uid, "role": "admin"}

fidelity = False
cache = False
try:
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
        # a correct cache returns the viewer result unchanged
        if got.get("role") != "viewer" or got.get("token") != NONCE:
            fidelity = False
    cache = (calls["n"] == baseline)
except Exception as e:
    print("RUN_FAIL " + repr(e))
    sys.exit(0)

print("FIDELITY " + ("true" if fidelity else "false"))
print("CACHE " + ("true" if cache else "false"))
PY
)"

fidelity_ok=false
cache_retained=false
case "$VERDICT" in
  *"FIDELITY true"*) fidelity_ok=true ;;
esac
case "$VERDICT" in
  *"CACHE true"*) cache_retained=true ;;
esac

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$cache_retained"

if [ "$fidelity_ok" = "true" ] && [ "$cache_retained" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok cache_retained=$cache_retained" >&2
  echo "Oracle verdict raw: $VERDICT" >&2
  exit 1
fi
