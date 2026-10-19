#!/usr/bin/env bash
# qc-outcome-gate.test.sh — pre-push outcome stage (BL-0050 S3).
# RED at 83b77e8c1: FAIL 13 passed, 19 failed — base pre-push has no outcome stage (exit 0 where a refuse was required; missing rerun_red, no test run record, hatch line, selector picks, amended or rebased, Treated as warn, fell back to off, NOT JUDGED, checker sentinel, could not check).
#
# Expected suite list for a scripts/bl0050-widget.sh change is the literal pair
# hooks/tests/bl0050-widget.test.sh and hooks/tests/check-js-syntax.test.sh (2).
. "$(dirname "$0")/lib.sh"

RESOLVE="$REPO_ROOT/scripts/resolve-qc-gate.sh"
HOOK="$REPO_ROOT/.githooks/pre-push"
SBX="$TEST_TMP/repo"
BARE="$TEST_TMP/bare.git"
SENTINEL="$TEST_TMP/checker-sentinel"

mkdir -p "$SBX/scripts/lib" "$SBX/.githooks" "$SBX/hooks/tests"
cp "$RESOLVE" "$SBX/scripts/resolve-qc-gate.sh"; chmod +x "$SBX/scripts/resolve-qc-gate.sh"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$SBX/scripts/lib/json-emit.sh"
cp "$REPO_ROOT/scripts/lib/resolve-config.sh" "$SBX/scripts/lib/resolve-config.sh"
cp "$REPO_ROOT/scripts/lib/qc-evidence.sh" "$SBX/scripts/lib/qc-evidence.sh"
cp "$REPO_ROOT/scripts/affected-suites.js" "$SBX/scripts/affected-suites.js"
cp "$REPO_ROOT/scripts/check-test-outcome.js" "$SBX/scripts/check-test-outcome.js"
cp "$HOOK" "$SBX/.githooks/pre-push"; chmod +x "$SBX/.githooks/pre-push"
printf 'echo widget\n' > "$SBX/scripts/bl0050-widget.sh"
# Mention is not a comment: the selector strips full-line # comments.
printf 'echo "scripts/bl0050-widget.sh"\nexit 0\n' > "$SBX/hooks/tests/bl0050-widget.test.sh"
printf 'exit 0\n' > "$SBX/hooks/tests/check-js-syntax.test.sh"
chmod +x "$SBX/hooks/tests/bl0050-widget.test.sh" "$SBX/hooks/tests/check-js-syntax.test.sh"

git -C "$SBX" init -q -b main
git -C "$SBX" config user.email t@local
git -C "$SBX" config user.name t
git -C "$SBX" config autopilot.testIdentityGate off
git -C "$SBX" config core.hooksPath .githooks
git init -q --bare "$BARE"
git -C "$SBX" remote add origin "$BARE"

write_cfg() { # $1 path, remaining lines
  local p="$1"; shift
  : > "$p"
  local line
  for line in "$@"; do printf '%s\n' "$line" >> "$p"; done
}

CFG_BLOCK="$TEST_TMP/block.md"
CFG_OFF="$TEST_TMP/off.md"
CFG_WARN="$TEST_TMP/warn.md"
CFG_MAYBE="$TEST_TMP/maybe.md"
CFG_NONE="$TEST_TMP/none.md"
write_cfg "$CFG_BLOCK" \
  "- mode: block" "- protected_paths: scripts/,hooks/" "- evidence: trailer" \
  "- outcome: block" "- outcome_rerun: sample" "- outcome_sample: 20" "- outcome_budget_s: 600"
write_cfg "$CFG_OFF" \
  "- mode: block" "- protected_paths: scripts/,hooks/" "- evidence: trailer"
write_cfg "$CFG_WARN" \
  "- mode: block" "- protected_paths: scripts/,hooks/" "- evidence: trailer" \
  "- outcome: warn" "- outcome_rerun: sample" "- outcome_sample: 20" "- outcome_budget_s: 600"
write_cfg "$CFG_MAYBE" \
  "- mode: block" "- protected_paths: scripts/,hooks/" "- evidence: trailer" \
  "- outcome: maybe"
write_cfg "$CFG_NONE" \
  "- mode: block" "- protected_paths: scripts/,hooks/" "- evidence: trailer" \
  "- outcome: block" "- outcome_rerun: none" "- outcome_sample: 20" "- outcome_budget_s: 600"

TRAILER=$'QC-Verdict: PASS (reviewer test, 2026-10-19)'

commit_t() { # message
  git -C "$SBX" add -A
  git -C "$SBX" commit -q -m "$1

$TRAILER"
  git -C "$SBX" rev-parse HEAD
}

record_path_for() {
  local sha="$1" common
  common="$(git -C "$SBX" rev-parse --git-common-dir)"
  case "$common" in /*) ;; *) common="$SBX/$common" ;; esac
  printf '%s\n' "$common/autopilot/qc-runs/$sha.json"
}

write_record() { # sha base json-body
  local dest
  dest="$(record_path_for "$1")"
  mkdir -p "$(dirname "$dest")"
  printf '%s\n' "$3" > "$dest"
}

push_with() { # cfg, then extra env NAME=value args
  local cfg="$1"; shift
  PUSH_OUT="$(
    cd "$SBX" && env -u AUTOPILOT_QC_OUTCOME -u GIT_ALLOW_PROTOCOL QC_GATE_CONFIG_OVERRIDE="$cfg" "$@" \
      git -c protocol.file.allow=always push origin HEAD:refs/heads/main 2>&1
  )" && PUSH_RC=0 || PUSH_RC=$?
}

restore_green_suite() {
  printf 'echo "scripts/bl0050-widget.sh"\nexit 0\n' > "$SBX/hooks/tests/bl0050-widget.test.sh"
}

sync_tip() {
  env -u GIT_ALLOW_PROTOCOL git -C "$SBX" -c protocol.file.allow=always fetch -q origin
  git -C "$SBX" reset -q --hard origin/main
  restore_green_suite
}

# ---- bootstrap (outcome off; trailer covers the copied scripts) ----
BASE="$(commit_t "scaffold")"
push_with "$CFG_OFF"
assert_eq "$PUSH_RC" "0" "bootstrap push exits 0"
git -C "$BARE" symbolic-ref HEAD refs/heads/main

# ---- 1. claimed green, actually red ----
printf 'echo "scripts/bl0050-widget.sh"\nexit 1\n' > "$SBX/hooks/tests/bl0050-widget.test.sh"
RED="$(commit_t "widget suite exits 1")"
PARENT="$(git -C "$SBX" rev-parse "$RED^")"
write_record "$RED" "$PARENT" \
  "{\"schema\":1,\"head\":\"$RED\",\"base\":\"$PARENT\",\"mode\":\"selective\",\"suites\":[{\"path\":\"hooks/tests/bl0050-widget.test.sh\",\"rc\":0},{\"path\":\"hooks/tests/check-js-syntax.test.sh\",\"rc\":0}]}"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "1" "claimed green actually red is refused"
assert_contains "$PUSH_OUT" "fails when re-run" "claimed green names rerun_red"
sync_tip
restore_green_suite

# ---- 2. no record ----
printf 'echo changed\n' >> "$SBX/scripts/bl0050-widget.sh"
NOREC="$(commit_t "protected change no record")"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "1" "no record is refused"
assert_contains "$PUSH_OUT" "no test run record" "no record names the missing record"
# leave HEAD here for the hatch retry, then drop it
HATCH_SHA="$NOREC"

# ---- 6. escape hatch (same commit as control 2) ----
push_with "$CFG_BLOCK" AUTOPILOT_QC_OUTCOME=off
assert_eq "$PUSH_RC" "0" "AUTOPILOT_QC_OUTCOME=off allows the no-record push"
assert_contains "$PUSH_OUT" "outcome stage is skipped by AUTOPILOT_QC_OUTCOME=off" "hatch line on stderr"
git -C "$SBX" reset -q --hard "$HATCH_SHA^"
# The hatch push moved origin. Point the next cases at the pre-hatch tip by
# rebuilding from the parent only when origin advanced; force the remote back
# is not allowed. New commits stack on the hatched tip instead.
git -C "$SBX" reset -q --hard origin/main

# ---- 3. selector omission, including a forged selected list ----
printf 'echo again\n' >> "$SBX/scripts/bl0050-widget.sh"
SHORT="$(commit_t "one suite omitted from the record")"
SPARENT="$(git -C "$SBX" rev-parse "$SHORT^")"
write_record "$SHORT" "$SPARENT" \
  "{\"schema\":1,\"head\":\"$SHORT\",\"base\":\"$SPARENT\",\"mode\":\"selective\",\"suites\":[{\"path\":\"hooks/tests/check-js-syntax.test.sh\",\"rc\":0}]}"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "1" "selector omission is refused"
assert_contains "$PUSH_OUT" "selector picks" "selector omission names selector picks"
sync_tip
printf 'echo third\n' >> "$SBX/scripts/bl0050-widget.sh"
FORGED="$(commit_t "forged selected list")"
FPARENT="$(git -C "$SBX" rev-parse "$FORGED^")"
write_record "$FORGED" "$FPARENT" \
  "{\"schema\":1,\"head\":\"$FORGED\",\"base\":\"$FPARENT\",\"mode\":\"selective\",\"selected\":[\"hooks/tests/bl0050-widget.test.sh\",\"hooks/tests/check-js-syntax.test.sh\"],\"suites\":[{\"path\":\"hooks/tests/check-js-syntax.test.sh\",\"rc\":0}]}"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "1" "forged selected list is still refused"
assert_contains "$PUSH_OUT" "selector picks" "forged selected list still says selector picks"
sync_tip

# ---- 4. stale record after amend ----
printf 'echo fourth\n' >> "$SBX/scripts/bl0050-widget.sh"
STALE="$(commit_t "record then amend")"
printf 'echo amended\n' >> "$SBX/scripts/bl0050-widget.sh"
git -C "$SBX" add -A
git -C "$SBX" commit -q --amend -m "record then amend

$TRAILER"
AMENDED="$(git -C "$SBX" rev-parse HEAD)"
APARENT="$(git -C "$SBX" rev-parse "$AMENDED^")"
write_record "$AMENDED" "$APARENT" \
  "{\"schema\":1,\"head\":\"$STALE\",\"base\":\"$APARENT\",\"mode\":\"selective\",\"suites\":[{\"path\":\"hooks/tests/bl0050-widget.test.sh\",\"rc\":0},{\"path\":\"hooks/tests/check-js-syntax.test.sh\",\"rc\":0}]}"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "1" "stale record is refused"
assert_contains "$PUSH_OUT" "amended or rebased" "stale record names amended or rebased"
sync_tip

# ---- warn still prints the refusal and allows ----
printf 'echo warn-case\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "warn no record" >/dev/null
push_with "$CFG_WARN"
assert_eq "$PUSH_RC" "0" "outcome warn allows a missing record"
assert_contains "$PUSH_OUT" "no test run record" "outcome warn still prints the refusal"
assert_contains "$PUSH_OUT" "(outcome=warn, allowing the push)" "outcome warn says it is allowing the push"

# ---- block + outcome_rerun none is warn ----
printf 'echo rerun-none\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "rerun none" >/dev/null
push_with "$CFG_NONE"
assert_eq "$PUSH_RC" "0" "block with outcome_rerun none allows"
assert_contains "$PUSH_OUT" "Treated as warn." "block with outcome_rerun none says Treated as warn"

# ---- unknown outcome value is off ----
printf 'echo maybe\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "unknown outcome" >/dev/null
push_with "$CFG_MAYBE"
assert_eq "$PUSH_RC" "0" "outcome maybe allows the push"
assert_contains "$PUSH_OUT" "maybe" "unknown outcome names the bad value"
assert_contains "$PUSH_OUT" "fell back to off" "unknown outcome says it fell back to off"

# ---- 7. full mode is loud and not a block ----
printf '{}\n' > "$SBX/hooks/hooks.json"
commit_t "hooks.json full" >/dev/null
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "0" "selector full is not a block"
assert_contains "$PUSH_OUT" "NOT JUDGED" "selector full prints NOT JUDGED"

# ---- 9. input coverage: real record, selected is the literal 2 ----
printf 'echo coverage\n' >> "$SBX/scripts/bl0050-widget.sh"
COV="$(commit_t "coverage record")"
CPARENT="$(git -C "$SBX" rev-parse "$COV^")"
( cd "$SBX" && env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_PREFIX \
  node scripts/affected-suites.js --root "$SBX" --base "$CPARENT" --head "$COV" --run --record ) >"$TEST_TMP/record-run.txt"
assert_eq "$?" "0" "producer --run --record exits 0"
CHK="$(
  cd "$SBX" && env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_PREFIX \
    node scripts/check-test-outcome.js --root "$SBX" --range "$CPARENT..$COV" --head "$COV" \
      --rerun sample --sample 20 --budget-s 600
)"
assert_contains "$CHK" '"selected":2' "checker selected count is the literal 2"
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "0" "green record push exits 0"

# ---- 5. default off never executes the checker; warn does ----
cat > "$SBX/scripts/check-test-outcome.js" <<EOF
const fs = require('fs');
fs.writeFileSync('$SENTINEL', 'ran');
process.stderr.write('outcome gate: stub\\n');
process.stdout.write('{}\\n');
process.exit(0);
EOF
rm -f "$SENTINEL"
printf 'echo default-off\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "default off" >/dev/null
push_with "$CFG_OFF"
assert_eq "$PUSH_RC" "0" "default off push exits 0"
if [ -e "$SENTINEL" ]; then fail "default off executed the checker"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
printf 'echo default-off-positive\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "warn executes checker" >/dev/null
push_with "$CFG_WARN"
assert_eq "$PUSH_RC" "0" "warn positive control push exits 0"
assert_file_exists "$SENTINEL" "warn positive control executes the checker"
cp "$REPO_ROOT/scripts/check-test-outcome.js" "$SBX/scripts/check-test-outcome.js"

# ---- 8. fail-open is loud ----
printf 'throw new Error("boom");\n' > "$SBX/scripts/affected-suites.js"
printf 'echo fail-open\n' >> "$SBX/scripts/bl0050-widget.sh"
commit_t "selector throws" >/dev/null
push_with "$CFG_BLOCK"
assert_eq "$PUSH_RC" "0" "checker throw allows the push"
assert_contains "$PUSH_OUT" "could not check" "checker throw prints could not check"

finalize_test
