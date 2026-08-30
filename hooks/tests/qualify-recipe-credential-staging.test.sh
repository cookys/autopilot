#!/usr/bin/env bash
# hooks/tests/qualify-recipe-credential-staging.test.sh
#
# Why this exists: on 2026-08-30 (D7 pooled re-administration) the kimi and
# grok qualification seats returned 240/240 provider_process_failed each
# (~1600s wasted) because every recipe run.sh under
# docs/plans/evidence/*/administration/*/run.sh seeded staged credentials
# with `if [ ! -f <staged> ]` — an absence-only guard. A staging copy from
# 2026-08-29 survived while the live OAuth material had rotated, so the
# staged credential was never refreshed.
# (docs/BACKLOG.md "Qualification recipes seed staged credentials only when
# the staged file is absent — rotating OAuth runners reuse stale material")
#
# Fix: scripts/lib/qualify-stage-credentials.sh — credential/token files are
# reseeded by sha256 stamp comparison (mismatch => reseed), and `plan` mode
# refuses (non-zero exit, "staged credential drift: <file>") instead of
# silently proceeding on drift. Identity/config files (installation ids,
# device ids) keep the original absence-only behavior via
# qualify_stage_identity.
#
# This test exercises the lib directly against a temp HOME (no real
# credentials ever touched), then asserts every one of the 14 recipe run.sh
# files sources the lib and carries no leftover absence-only guard on a
# credential file, and that all copies of a given seat's staging block stay
# byte-identical (drift-between-copies guard).

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/qualify-stage-credentials.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

if [ ! -f "$LIB" ]; then
  bad "missing $LIB"
  printf '\nqualify-recipe-credential-staging: %d passed, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi
# shellcheck disable=SC1090
source "$LIB"
ok "sourced $LIB"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/qualify-stage-cred-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

REAL="$WORK/real-source.json"
STAGED="$WORK/staged/token.json"
mkdir -p "$(dirname "$STAGED")"

# ---------------------------------------------------------- (1) fresh seed
echo '{"token":"v1"}' >"$REAL"
if qualify_stage_credential "$STAGED" "$REAL" execute; then
  if [ -f "$STAGED" ] && [ -f "$STAGED.source.sha256" ] \
     && [ "$(cat "$STAGED")" = "$(cat "$REAL")" ] \
     && [ "$(cat "$STAGED.source.sha256")" = "$(sha256sum "$REAL" | cut -d' ' -f1)" ]; then
    ok "fresh seed: staged file + stamp created, content matches source"
  else
    bad "fresh seed: staged file or stamp missing/mismatched"
  fi
else
  bad "fresh seed: qualify_stage_credential returned nonzero"
fi

# ---------------------------------------------------- (2) rotated source
FIRST_MTIME_MARKER="$WORK/marker-after-seed1"
touch "$FIRST_MTIME_MARKER"
sleep 1
echo '{"token":"v2-rotated"}' >"$REAL"
if qualify_stage_credential "$STAGED" "$REAL" execute; then
  if [ "$(cat "$STAGED")" = "$(cat "$REAL")" ] \
     && [ "$(cat "$STAGED.source.sha256")" = "$(sha256sum "$REAL" | cut -d' ' -f1)" ]; then
    ok "rotated source: reseeded, content + stamp now match the rotated source"
  else
    bad "rotated source: staged file was NOT reseeded (this is exactly the D7 bug)"
  fi
else
  bad "rotated source: qualify_stage_credential returned nonzero"
fi

# --------------------------------------------------- (3) unchanged source
STAMP_SHA_BEFORE="$(cat "$STAGED.source.sha256")"
STAGED_MTIME_BEFORE="$(stat -c '%Y' "$STAGED" 2>/dev/null || stat -f '%m' "$STAGED")"
sleep 1
if qualify_stage_credential "$STAGED" "$REAL" execute; then
  STAGED_MTIME_AFTER="$(stat -c '%Y' "$STAGED" 2>/dev/null || stat -f '%m' "$STAGED")"
  if [ "$STAGED_MTIME_AFTER" = "$STAGED_MTIME_BEFORE" ] \
     && [ "$(cat "$STAGED.source.sha256")" = "$STAMP_SHA_BEFORE" ]; then
    ok "unchanged source: staged file NOT re-copied (mtime + stamp untouched)"
  else
    bad "unchanged source: staged file was re-copied even though the source didn't change"
  fi
else
  bad "unchanged source: qualify_stage_credential returned nonzero"
fi

# --------------------------------------------------- (4) plan-mode drift
echo '{"token":"v3-rotated-again"}' >"$REAL"
PLAN_OUT="$(qualify_stage_credential "$STAGED" "$REAL" plan 2>&1)"
PLAN_RC=$?
if [ "$PLAN_RC" -ne 0 ] && printf '%s' "$PLAN_OUT" | grep -q "staged credential drift: $STAGED"; then
  ok "plan mode: refuses on drift (rc=$PLAN_RC, named message present)"
else
  bad "plan mode: did not refuse on drift (rc=$PLAN_RC, output: $PLAN_OUT)"
fi
# plan mode must never have written despite the drift
if [ "$(cat "$STAGED.source.sha256")" = "$(sha256sum "$WORK/real-source.json" 2>/dev/null | cut -d' ' -f1)" ] 2>/dev/null; then
  : # fallthrough handled below by direct compare
fi
STAMP_AFTER_PLAN="$(cat "$STAGED.source.sha256")"
if [ "$STAMP_AFTER_PLAN" != "$(sha256sum "$REAL" | cut -d' ' -f1)" ]; then
  ok "plan mode: did not silently reseed the drifted credential"
else
  bad "plan mode: silently reseeded despite refusing (stamp got updated)"
fi

# plan mode with no drift (matching stamp) must pass cleanly
qualify_stage_credential "$STAGED" "$REAL" execute >/dev/null 2>&1 || true
if qualify_stage_credential "$STAGED" "$REAL" plan; then
  ok "plan mode: no drift => clean pass"
else
  bad "plan mode: refused even though staged matches live (false positive)"
fi

# ------------------------------------ (4b) plan-mode: legacy unstamped staged copy
# qc 2026-08-31 (gpt-5.6-sol 🟠 verified): a staged credential with no stamp
# must be treated as drift in plan mode, not silently passed.
rm -f "$STAGED.source.sha256"
PLAN_OUT="$(qualify_stage_credential "$STAGED" "$REAL" plan 2>&1)"
PLAN_RC=$?
if [ "$PLAN_RC" -ne 0 ] && printf '%s' "$PLAN_OUT" | grep -q "staged credential drift: $STAGED"; then
  ok "plan mode: unstamped legacy staged copy => refused as drift"
else
  bad "plan mode: unstamped legacy staged copy passed (rc=$PLAN_RC, output: $PLAN_OUT)"
fi
if [ ! -f "$STAGED.source.sha256" ]; then
  ok "plan mode: did not stamp the unstamped copy"
else
  bad "plan mode: wrote a stamp for an unverified copy"
fi
qualify_stage_credential "$STAGED" "$REAL" execute >/dev/null 2>&1 || true
if [ -f "$STAGED.source.sha256" ] && qualify_stage_credential "$STAGED" "$REAL" plan; then
  ok "execute mode: reseeds + stamps the legacy copy, plan then passes"
else
  bad "execute mode: did not repair the unstamped legacy copy"
fi

# -------------------------------------------------- identity (absence-only)
IDSTAGED="$WORK/staged/identity.txt"
IDREAL="$WORK/identity-real.txt"
echo "id-v1" >"$IDREAL"
qualify_stage_identity "$IDSTAGED" "$IDREAL"
echo "id-v2-rotated" >"$IDREAL"
qualify_stage_identity "$IDSTAGED" "$IDREAL"
if [ "$(cat "$IDSTAGED")" = "id-v1" ]; then
  ok "identity file: absence-only behavior preserved (not reseeded on change)"
else
  bad "identity file: unexpectedly reseeded — absence-only contract broken"
fi

# ============================================================ recipe audit
# Every recipe under docs/plans/evidence/*/administration/*/run.sh that ever
# staged a credential must now source the shared lib and carry no
# absence-only guard on a credential file.
RECIPE_DIR="$ROOT/docs/plans/evidence"
mapfile -t RECIPES < <(grep -rl 'STAGING_HOME\|STAGING_DIR\|STAGING_AGY_DIR\|STAGING_AUTH_DIR\|STAGING_KIMI_DIR' \
  "$RECIPE_DIR"/*/administration/*/run.sh 2>/dev/null | sort)

if [ "${#RECIPES[@]}" -eq 0 ]; then
  bad "no recipe run.sh files found under $RECIPE_DIR/*/administration/*/ — audit path is wrong"
else
  ok "found ${#RECIPES[@]} recipe run.sh files with a staging block"
fi

LEGACY_HIT=0
for r in "${RECIPES[@]}"; do
  if grep -q 'if \[ ! -f "\$STAGING_[A-Z_]*/\$f"[^]]*\]; then$' "$r" \
     && ! grep -q 'qualify_stage_credential\|qualify_stage_identity' "$r"; then
    LEGACY_HIT=1
    bad "legacy absence-only credential guard still present, no shared lib sourced: $r"
  fi
done
[ "$LEGACY_HIT" -eq 0 ] && ok "no recipe has an un-migrated absence-only credential guard"

SOURCED=0
for r in "${RECIPES[@]}"; do
  if grep -q 'source ".*qualify-stage-credentials\.sh"' "$r"; then
    SOURCED=$((SOURCED+1))
  else
    bad "recipe does not source scripts/lib/qualify-stage-credentials.sh: $r"
  fi
done
if [ "$SOURCED" -eq "${#RECIPES[@]}" ] && [ "${#RECIPES[@]}" -gt 0 ]; then
  ok "all ${#RECIPES[@]} recipes source scripts/lib/qualify-stage-credentials.sh"
fi

# -------------------------------------------- drift-between-copies guard
# Group recipes by seat basename (the part after the date dir) and require
# the staging block (between the STAGING_* var block and the QRP_CLI_HOME
# export) to be byte-identical across every date-copy of the same seat —
# so a future hand-edit to one copy can't silently diverge from its twin.
declare -A SEAT_TO_FILES=()
for r in "${RECIPES[@]}"; do
  seat="$(basename "$(dirname "$r")")"
  SEAT_TO_FILES["$seat"]="${SEAT_TO_FILES["$seat"]:-}${SEAT_TO_FILES["$seat"]:+ }$r"
done

extract_staging_block() {
  # everything from the first STAGING_* assignment line through the
  # `export QRP_CLI_HOME=` / `export CLAUDE_CONFIG_DIR=` line, inclusive.
  awk '
    /^STAGING_(HOME|DIR|AGY_DIR|AUTH_DIR|KIMI_DIR|ROOT)=/ { capture=1 }
    capture { print }
    capture && /^export (QRP_CLI_HOME|CLAUDE_CONFIG_DIR)=/ { exit }
  ' "$1"
}

DRIFT=0
for seat in "${!SEAT_TO_FILES[@]}"; do
  files=(${SEAT_TO_FILES["$seat"]})
  [ "${#files[@]}" -lt 2 ] && continue
  ref_block="$(extract_staging_block "${files[0]}")"
  for f in "${files[@]:1}"; do
    this_block="$(extract_staging_block "$f")"
    if [ "$this_block" != "$ref_block" ]; then
      DRIFT=1
      bad "staging block diverges between copies of seat '$seat': ${files[0]} vs $f"
    fi
  done
done
[ "$DRIFT" -eq 0 ] && ok "staging block is byte-identical across every date-copy of each seat"

printf '\nqualify-recipe-credential-staging: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
