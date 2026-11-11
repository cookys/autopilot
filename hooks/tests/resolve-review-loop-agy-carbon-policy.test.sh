#!/usr/bin/env bash
# agy carbon reviewer: an unset reviewer_on_engine_unavailable becomes
# cloud-fallback whether reviewer_cloud_fallback_rung was written or filled.
# An explicit policy is kept. A non-carbon agy reviewer is unchanged.
# Fixtures pin consult_dispatch and discuss_dispatch, so Population B does not
# need a new allowlist row for this file.
. "$(dirname "$0")/lib.sh"

unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR AUTOPILOT_QUALIFICATION_OVERRIDE
export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

jget() {
  node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=d[process.argv[1]];process.stdout.write(v===undefined?"":(typeof v==="string"?v:JSON.stringify(v)));' "$1"
}

# $1 path, $2 engine, $3 runner, $4 extra reviewer lines (may be empty), $5 extra knobs
write_cfg() {
  {
    printf '%s\n' "- on_engine_unavailable: ask"
    printf '%s\n' "- consult_dispatch: off"
    printf '%s\n' "- discuss_dispatch: off"
    printf '%s\n' "- override: reviewer | until 2099-01-01 | agy carbon policy"
    printf '%s\n' "- reviewer_engine: $2"
    printf '%s\n' "- reviewer_runner: $3"
    printf '%s\n' "- reviewer_effort: high"
    [ -n "${4:-}" ] && printf '%s\n' "$4"
    [ -n "${5:-}" ] && printf '%s\n' "$5"
  } > "$1"
}

resolve_cfg() { # $1 path, $2 tag
  REVIEW_LOOP_CONFIG_OVERRIDE="$1" bash "$SCRIPT" >"$TEST_TMP/$2.out" 2>"$TEST_TMP/$2.err"
  printf '%s' "$?"
}

ARGON_RUNG='{"engine":"gemini-4-argon-high","effort":"high","runner":"agy"}'

# (a) explicit argon rung + unset policy
A="$TEST_TMP/a.md"
write_cfg "$A" gemini-4-carbon-high agy "- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
A_RC="$(resolve_cfg "$A" a)"
assert_eq "$A_RC" "0" "explicit argon rung + unset policy resolves"
A_OUT="$(cat "$TEST_TMP/a.out")"
assert_eq "$(printf '%s' "$A_OUT" | jget reviewer_on_engine_unavailable)" "cloud-fallback" \
  "unset policy becomes cloud-fallback when the argon rung is explicit"
assert_eq "$(printf '%s' "$A_OUT" | jget reviewer_cloud_fallback_rung)" "$ARGON_RUNG" \
  "explicit argon rung is kept"
assert_eq "$(printf '%s' "$A_OUT" | jget on_engine_unavailable)" "ask" \
  "global on_engine_unavailable stays ask"

# empty rung + unset policy (the case the carbon block already meant to cover)
E="$TEST_TMP/empty.md"
write_cfg "$E" gemini-4-carbon-high agy ""
E_RC="$(resolve_cfg "$E" empty)"
assert_eq "$E_RC" "0" "empty rung + unset policy resolves"
E_OUT="$(cat "$TEST_TMP/empty.out")"
assert_eq "$(printf '%s' "$E_OUT" | jget reviewer_on_engine_unavailable)" "cloud-fallback" \
  "unset policy becomes cloud-fallback when the rung is empty"
assert_eq "$(printf '%s' "$E_OUT" | jget reviewer_cloud_fallback_rung)" "$ARGON_RUNG" \
  "empty rung is filled with argon-high@agy"

# (b) explicit ask kept (global is also ask)
B="$TEST_TMP/ask.md"
write_cfg "$B" gemini-4-carbon-high agy "- reviewer_on_engine_unavailable: ask
- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
B_RC="$(resolve_cfg "$B" ask)"
assert_eq "$B_RC" "0" "explicit ask resolves"
B_OUT="$(cat "$TEST_TMP/ask.out")"
assert_eq "$(printf '%s' "$B_OUT" | jget reviewer_on_engine_unavailable)" "ask" \
  "explicit ask is kept"
assert_eq "$(printf '%s' "$B_OUT" | jget reviewer_cloud_fallback_rung)" "$ARGON_RUNG" \
  "explicit argon rung stays when policy is ask"
assert_eq "$(printf '%s' "$B_OUT" | jget on_engine_unavailable)" "ask" \
  "global ask is unchanged beside an explicit reviewer ask"

# (c) explicit fail-type policy kept. Legal reviewer values match the global
# on_engine_unavailable set (ask|solo-fallback|wait-reset|cloud-fallback).
# solo-fallback is the non-ask value that does not retreat.
C="$TEST_TMP/solo.md"
write_cfg "$C" gemini-4-carbon-high agy "- reviewer_on_engine_unavailable: solo-fallback
- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
C_RC="$(resolve_cfg "$C" solo)"
assert_eq "$C_RC" "0" "explicit solo-fallback resolves"
C_OUT="$(cat "$TEST_TMP/solo.out")"
assert_eq "$(printf '%s' "$C_OUT" | jget reviewer_on_engine_unavailable)" "solo-fallback" \
  "explicit fail-type policy solo-fallback is kept"
assert_eq "$(printf '%s' "$C_OUT" | jget reviewer_cloud_fallback_rung)" "$ARGON_RUNG" \
  "explicit argon rung stays when policy is solo-fallback"

W="$TEST_TMP/wait.md"
write_cfg "$W" gemini-4-carbon-high agy "- reviewer_on_engine_unavailable: wait-reset
- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
W_RC="$(resolve_cfg "$W" wait)"
assert_eq "$W_RC" "0" "explicit wait-reset resolves"
W_OUT="$(cat "$TEST_TMP/wait.out")"
assert_eq "$(printf '%s' "$W_OUT" | jget reviewer_on_engine_unavailable)" "wait-reset" \
  "explicit wait-reset is kept"

# garbage is not unset: it stays empty (follow the global) and is not rewritten
# to cloud-fallback.
G="$TEST_TMP/garbage.md"
write_cfg "$G" gemini-4-carbon-high agy "- reviewer_on_engine_unavailable: not-a-policy
- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
G_RC="$(resolve_cfg "$G" garbage)"
assert_eq "$G_RC" "0" "garbage reviewer policy still resolves"
G_OUT="$(cat "$TEST_TMP/garbage.out")"
assert_eq "$(printf '%s' "$G_OUT" | jget reviewer_on_engine_unavailable)" "" \
  "garbage policy is not turned into cloud-fallback"
assert_contains "$(cat "$TEST_TMP/garbage.err")" "ignoring invalid reviewer_on_engine_unavailable" \
  "garbage policy is reported"

# (d) non-carbon agy reviewer unchanged
D="$TEST_TMP/argon.md"
write_cfg "$D" gemini-4-argon-high agy ""
D_RC="$(resolve_cfg "$D" argon)"
assert_eq "$D_RC" "0" "non-carbon agy reviewer resolves"
D_OUT="$(cat "$TEST_TMP/argon.out")"
assert_eq "$(printf '%s' "$D_OUT" | jget reviewer_engine)" "gemini-4-argon-high" \
  "non-carbon agy engine is unchanged"
assert_eq "$(printf '%s' "$D_OUT" | jget reviewer_on_engine_unavailable)" "" \
  "non-carbon agy unset policy stays empty"
assert_eq "$(printf '%s' "$D_OUT" | jget reviewer_cloud_fallback_rung)" "null" \
  "non-carbon agy empty rung stays null"

D2="$TEST_TMP/argon-rung.md"
write_cfg "$D2" gemini-4-argon-high agy "- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex"
D2_RC="$(resolve_cfg "$D2" argon-rung)"
assert_eq "$D2_RC" "0" "non-carbon agy with an explicit rung resolves"
D2_OUT="$(cat "$TEST_TMP/argon-rung.out")"
assert_eq "$(printf '%s' "$D2_OUT" | jget reviewer_on_engine_unavailable)" "" \
  "non-carbon agy unset policy stays empty beside an explicit rung"
assert_eq "$(printf '%s' "$D2_OUT" | jget reviewer_cloud_fallback_rung)" \
  '{"engine":"gpt-6.1-sol","effort":"high","runner":"codex"}' \
  "non-carbon agy explicit rung is unchanged"

finalize_test
