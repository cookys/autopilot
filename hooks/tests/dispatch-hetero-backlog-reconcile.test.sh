#!/usr/bin/env bash
# dispatch-hetero refuses a hand commit that edits project/backlog/BACKLOG.md in a repo
# with a hippo store when check-backlog-entries.js --hippo --reconcile is non-zero.
# A repo without .hippo/repo.toml keeps the previous accept path. A store edit that
# leaves reconcile green is accepted. Fake runner only.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip dispatch-hetero-backlog-reconcile
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
export HIPPO_BIN

HETERO_SH="$REPO_ROOT/scripts/dispatch-hetero.sh"
PR="$REPO_ROOT/scripts/project-record.js"
BL=project/backlog/BACKLOG.md

CAP_DIR="$TEST_TMP/cap"
SM_DIR="$TEST_TMP/sm"
LIVE_DIR="$TEST_TMP/live"
mkdir -p "$CAP_DIR" "$SM_DIR" "$LIVE_DIR"
chmod 700 "$LIVE_DIR"
PROMPT="$TEST_TMP/prompt.txt"
printf 'edit backlog\n' > "$PROMPT"
ENV_BIN="$TEST_TMP/agy-envelope"
cat > "$ENV_BIN" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({
  conversation_id: "bl-reconcile-fixture",
  duration_seconds: 1,
  num_turns: 1,
  response: "done",
  status: "SUCCESS",
  usage: { cache_read_tokens: 0, input_tokens: 10, output_tokens: 5, thinking_tokens: 0, total_tokens: 15 }
}))'
EOF
chmod +x "$ENV_BIN"

seed_backlog() {
  local repo="$1"
  mkdir -p "$repo/project/backlog" "$repo/.claude"
  printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$repo/$BL"
  cat > "$repo/.claude/project-lifecycle-config.md" <<'EOF'
## Project Paths

- Backlog: `project/backlog/BACKLOG.md`
EOF
  git -C "$repo" add -A >/dev/null
  git -C "$repo" commit -q -m "base backlog" || fail "base backlog $repo"
  git -C "$repo" branch -M develop
}

# name mode  (mode = fail | nostore | pass)
write_stub() {
  local dest="$1" mode="$2"
  case "$mode" in
    fail|nostore)
      cat > "$dest" <<EOF
#!/usr/bin/env bash
printf '### hand row\n- **Id**: BL-0001\n- **Status**: open\n' >> $BL
git -c core.hooksPath=/dev/null add $BL
git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -q --no-verify -m "chore: direct backlog edit"
"$ENV_BIN"
EOF
      ;;
    pass)
      cat > "$dest" <<EOF
#!/usr/bin/env bash
node "$PR" backlog new --title "Reconcile green row" --trigger "when asked" --trigger-type ready --effort S \\
  --origin self --source "self 2026-11-21" --problem "Problem via writer." --impact "Impact via writer." >/dev/null
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -q --no-verify -m "chore: backlog via writer"
"$ENV_BIN"
EOF
      ;;
  esac
  chmod +x "$dest"
  make_agy_stub_versioned "$dest"
}

run_case() { # repo branch stub
  (
    cd "$1" || exit 99
    unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
      AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
      AUTOPILOT_DISPATCH_DEPTH
    ENGINE_CAPABILITY_DIR="$CAP_DIR" \
    AUTOPILOT_SESSION_MODE_DIR="$SM_DIR" \
    AUTOPILOT_LIVE_DIR="$LIVE_DIR" \
    AUTOPILOT_DISPATCH_USAGE=off \
    AUTOPILOT_CODEFORGE_COLLECT=off \
      bash "$HETERO_SH" --no-verify-tip --runner agy --pin-reason "test fixture" \
        --branch "$2" --prompt-file "$PROMPT" --agy-bin "$3" < /dev/null
  )
}

json_field() {
  printf '%s' "$1" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const k=process.argv[1]; const v=d[k]; process.stdout.write(v==null?"":String(v));' "$2"
}

# 1. store present, hand edits BACKLOG.md, reconcile fails -> refused
R_FAIL="$(hs_mkrepo reconcile-fail store)"
seed_backlog "$R_FAIL"
STUB_FAIL="$TEST_TMP/agy-fail"
write_stub "$STUB_FAIL" fail
OUT_FAIL="$(run_case "$R_FAIL" fix/reconcile-fail "$STUB_FAIL" 2>"$TEST_TMP/fail.err")"; RC_FAIL=$?
assert_eq "$RC_FAIL" 1 "store + failing reconcile exits 1"
assert_eq "$(json_field "$OUT_FAIL" status)" "boundary_rejected" "store + failing reconcile status is not success"
REASON_FAIL="$(json_field "$OUT_FAIL" boundary_reason)"
assert_contains "$REASON_FAIL" "project/backlog/BACKLOG.md" "refusal names project/backlog/BACKLOG.md"
assert_contains "$REASON_FAIL" "node scripts/project-record.js backlog" "refusal names project-record.js backlog"
WT_FAIL="$(json_field "$OUT_FAIL" worktree)"
[ -n "$WT_FAIL" ] && git -C "$R_FAIL" worktree remove --force "$WT_FAIL" >/dev/null 2>&1 || true

# 2. same edit, no store -> accepted
R_NONE="$(hs_mkrepo reconcile-nostore)"
seed_backlog "$R_NONE"
STUB_NONE="$TEST_TMP/agy-nostore"
write_stub "$STUB_NONE" nostore
OUT_NONE="$(run_case "$R_NONE" fix/reconcile-nostore "$STUB_NONE" 2>"$TEST_TMP/nostore.err")"; RC_NONE=$?
assert_eq "$RC_NONE" 0 "no-store BACKLOG.md edit is accepted ($OUT_NONE)"
assert_eq "$(json_field "$OUT_NONE" status)" "committed" "no-store edit status is committed"

# 3. store present, hand writes through project-record, reconcile passes -> accepted
R_PASS="$(hs_mkrepo reconcile-pass store)"
seed_backlog "$R_PASS"
STUB_PASS="$TEST_TMP/agy-pass"
write_stub "$STUB_PASS" pass
OUT_PASS="$(run_case "$R_PASS" fix/reconcile-pass "$STUB_PASS" 2>"$TEST_TMP/pass.err")"; RC_PASS=$?
assert_eq "$RC_PASS" 0 "reconcile-green BACKLOG.md edit is accepted ($OUT_PASS)"
assert_eq "$(json_field "$OUT_PASS" status)" "committed" "reconcile-green status is committed"

finalize_test
