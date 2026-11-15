#!/usr/bin/env bash
# Tip verification: the rail re-runs acceptance at the committed tip.
# A worker that claims green on a failing command must not be reported done.
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
unset GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL
for _git_cfg_i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  unset "GIT_CONFIG_KEY_${_git_cfg_i}" "GIT_CONFIG_VALUE_${_git_cfg_i}"
done
unset _git_cfg_i

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export DISPATCH_QUIET=1
export AUTOPILOT_GROK_EFFORT_PROBE=0
mkdir -p "$TEST_TMP/engine-capability"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
EMPTY_SESSION_MODE_DIR="$TEST_TMP/session-mode-empty"
mkdir -p "$EMPTY_SESSION_MODE_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$EMPTY_SESSION_MODE_DIR"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

AGY_FIXTURE_HELPER="$TEST_TMP/emit-agy-envelope"
cat > "$AGY_FIXTURE_HELPER" <<'EOF'
#!/usr/bin/env bash
response="${1:-self-report: DONE}"
RESPONSE="$response" node -e '
  process.stdout.write(JSON.stringify({
    conversation_id: "fixture",
    duration_seconds: 1,
    num_turns: 1,
    response: process.env.RESPONSE,
    status: "SUCCESS",
    usage: { cache_read_tokens: 0, input_tokens: 1, output_tokens: 1, thinking_tokens: 0, total_tokens: 2 }
  }));
'
EOF
chmod +x "$AGY_FIXTURE_HELPER"
export AGY_FIXTURE_HELPER

MARKER="$TEST_TMP/stub-ran"
STUB="$TEST_TMP/agy-commit"
cat > "$STUB" <<EOF
#!/usr/bin/env bash
echo ran > "$MARKER"
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: tip"
"\$AGY_FIXTURE_HELPER" "self-report: all green"
exit 0
EOF
chmod +x "$STUB"
make_agy_stub_versioned "$STUB"

PROMPT_PLAIN="$TEST_TMP/prompt-plain.txt"
printf 'edit the tree\n' > "$PROMPT_PLAIN"
PROMPT_ACC="$TEST_TMP/prompt-acc.txt"
cat > "$PROMPT_ACC" <<'EOF'
edit the tree

## Acceptance
`tip_verify.status` is not a command.

```bash
bash -c 'exit 3'
```

## Notes
done
EOF
PROMPT_PROSE="$TEST_TMP/prompt-prose.txt"
cat > "$PROMPT_PROSE" <<'EOF'
edit the tree

## Acceptance
Run `false`, then `bash scripts/sync-all.sh` and `--check; echo $?`.
EOF
PROMPT_PH="$TEST_TMP/prompt-ph.txt"
cat > "$PROMPT_PH" <<'EOF'
edit the tree

## Acceptance
```bash
bash <f> < /dev/null
```
EOF

last_json() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
jget() {
  printf '%s' "$1" | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let o;
  try { o = JSON.parse(s); } catch (e) { process.stdout.write(""); return; }
  let c = o;
  for (const k of process.argv[1].split(".")) {
    if (c === null || c === undefined) { c = ""; break; }
    c = c[k];
  }
  if (c === undefined || c === null) process.stdout.write("");
  else if (typeof c === "object") process.stdout.write(JSON.stringify(c));
  else process.stdout.write(String(c));
});
' "$2"
}

# run_case <branch> [extra args...] — prompt is $CASE_PROMPT (default plain).
run_case() {
  local br="$1"; shift
  local prompt="${CASE_PROMPT:-$PROMPT_PLAIN}"
  EXIT=0
  OUT="$(cd "$SBX" && "$SCRIPT" --branch "$br" --prompt-file "$prompt" --agy-bin "$STUB" "$@" 2>&1)" || EXIT=$?
  J="$(last_json "$OUT")"
}

HELP="$("$SCRIPT" --help)"
assert_contains "$HELP" "put acceptance commands in a fenced block under ## Acceptance" "help says to put acceptance commands in a fenced block under ## Acceptance"

# --- no source: refuse before the implementation stub runs ---
rm -f "$MARKER"
run_case tv-none
assert_eq "$EXIT" "2" "no source exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "no source is precondition_failed"
assert_contains "$OUT" "--verify-cmd" "no source names --verify-cmd"
assert_contains "$OUT" "## Acceptance" "no source names ## Acceptance"
assert_contains "$OUT" "## Test Command" "no source names ## Test Command"
assert_contains "$OUT" "--no-verify-tip" "no source names --no-verify-tip"
assert_file_absent "$MARKER" "no source: runner stub never ran"

# --- prose with inline code only: not a brief source ---
rm -f "$MARKER"
CASE_PROMPT="$PROMPT_PROSE"
run_case tv-prose
CASE_PROMPT="$PROMPT_PLAIN"
assert_eq "$EXIT" "2" "prose inline acceptance exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "prose inline acceptance is not a brief source"
assert_neq "$(jget "$J" tip_verify.source)" "brief" "prose inline is not source brief"
assert_file_absent "$MARKER" "prose inline: runner stub never ran"

# --- flag true: success, tip_verify pass, commit is the branch tip ---
run_case tv-true --verify-cmd true
assert_eq "$EXIT" "0" "true exits 0"
assert_eq "$(jget "$J" status)" "committed" "true status committed (success)"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "true tip_verify.status pass"
TIP="$(git -C "$SBX" rev-parse refs/heads/tv-true)"
assert_eq "$(jget "$J" commit)" "$TIP" "true commit is the branch tip"
assert_eq "$(jget "$J" tip_verify.commit)" "$TIP" "true tip_verify.commit is the branch tip"
assert_eq "$(jget "$J" tip_verify.source)" "flag" "true source flag"
assert_file_exists "$MARKER" "true: runner stub ran"

# --- flag false: verify_failed, non-zero exit, rc 1 ---
run_case tv-false --verify-cmd false
assert_neq "$EXIT" "0" "false exits non-zero"
assert_eq "$EXIT" "3" "false exits 3"
assert_eq "$(jget "$J" status)" "verify_failed" "false status verify_failed"
assert_eq "$(jget "$J" tip_verify.status)" "fail" "false tip_verify.status fail"
assert_eq "$(jget "$J" tip_verify.commands.0.rc)" "1" "false records rc 1"
FALSE_TIP="$(git -C "$SBX" rev-parse refs/heads/tv-false)"
assert_eq "$(jget "$J" tip_verify.commit)" "$FALSE_TIP" "false commit stays on the branch"

# --- hydrogen: worker commits and claims green; brief command exits 3 ---
CASE_PROMPT="$PROMPT_ACC"
run_case tv-hydrogen
CASE_PROMPT="$PROMPT_PLAIN"
assert_neq "$EXIT" "0" "hydrogen exits non-zero"
assert_eq "$(jget "$J" status)" "verify_failed" "hydrogen status verify_failed"
assert_eq "$(jget "$J" tip_verify.source)" "brief" "hydrogen source brief"
assert_eq "$(jget "$J" tip_verify.commands.0.cmd)" "bash -c 'exit 3'" "hydrogen command text"
assert_eq "$(jget "$J" tip_verify.commands.0.rc)" "3" "hydrogen records rc 3"
assert_eq "$(jget "$J" tip_verify.commands.1.cmd)" "" "non-command span is not a command"

# --- this repo's real ## Test Command shape: prose + numbered inline code is not a command ---
rm -f "$MARKER"
mkdir -p "$SBX/.claude"
cat > "$SBX/.claude/quality-gate-config.md" <<'EOF'
## Test Command

Test step: select first, then run (from the repository root).

1. Run `node scripts/affected-suites.js --base <target-branch> --head HEAD --json`.
2. `mode: "selective"`: run every path in `suites` (it already includes `always_run`) and every path in `extra_runners`, and nothing else is required. `mode: "full"`: run `bash hooks/tests/run.sh` (the whole suite) plus every `extra_runners` entry, because run.sh does not run those.
3. An empty `suites` list is a pass only when every changed file is prose (selective, no `full_reasons`). An empty list from a non-prose change, or any `full` mode, is never a pass.
4. Release preflight is always the whole suite (`bash hooks/tests/run.sh` plus `extra_runners`), whatever the selector says.

`bash hooks/tests/run.sh` runs the L1 unit suite (`node --test hooks/*.test.js`) plus all L2 integration tests under `hooks/tests/*.test.sh`.
EOF
run_case tv-repo-prose
assert_eq "$EXIT" "2" "real-shape repo prose exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "real-shape repo prose is precondition_failed"
assert_neq "$(jget "$J" status)" "verify_failed" "real-shape repo prose is not verify_failed"
assert_neq "$(jget "$J" tip_verify.source)" "repo_config" "real-shape repo prose is not repo_config"
assert_file_absent "$MARKER" "real-shape repo prose: runner stub never ran"

# --- repo config Test Command, no flag, no Acceptance ---
mkdir -p "$SBX/.claude"
cat > "$SBX/.claude/quality-gate-config.md" <<'EOF'
# repo default
## Test Command
# not this
Test step: select first, then run (from the repository root).
```bash
true
```

## Later
false
EOF
run_case tv-repo
assert_eq "$EXIT" "0" "repo_config exits 0"
assert_eq "$(jget "$J" status)" "committed" "repo_config status committed"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "repo_config pass"
assert_eq "$(jget "$J" tip_verify.source)" "repo_config" "repo_config source"

# --- whole line that is one inline span is a repo_config command ---
cat > "$SBX/.claude/quality-gate-config.md" <<'EOF'
## Test Command

`true`
EOF
run_case tv-repo-inline
assert_eq "$EXIT" "0" "whole-line inline repo_config exits 0"
assert_eq "$(jget "$J" tip_verify.source)" "repo_config" "whole-line inline source repo_config"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "whole-line inline repo_config pass"

# --- fenced <f> is a precondition before the runner, even when repo_config would pass ---
rm -f "$MARKER"
CASE_PROMPT="$PROMPT_PH"
run_case tv-ph
CASE_PROMPT="$PROMPT_PLAIN"
assert_eq "$EXIT" "2" "placeholder fence exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "placeholder fence is precondition_failed"
assert_contains "$OUT" "<f>" "placeholder fence names the line"
assert_contains "$OUT" "bash <f> < /dev/null" "placeholder fence quotes the line"
assert_file_absent "$MARKER" "placeholder fence: runner stub never ran"

# --- explicit skip ---
run_case tv-skip --no-verify-tip
assert_eq "$EXIT" "0" "skip exits 0"
assert_eq "$(jget "$J" status)" "committed" "skip status committed"
assert_eq "$(jget "$J" tip_verify)" "skipped_by_flag" "skip records skipped_by_flag"

# --- timeout ---
START="$(date +%s)"
run_case tv-timeout --verify-cmd 'sleep 5' --verify-timeout 1
ELAPSED=$(( $(date +%s) - START ))
assert_neq "$EXIT" "0" "timeout exits non-zero"
assert_eq "$(jget "$J" status)" "verify_failed" "timeout dispatch status verify_failed"
assert_eq "$(jget "$J" tip_verify.status)" "timeout" "timeout tip_verify.status timeout"
[ "$ELAPSED" -lt 30 ] || fail "timeout case took ${ELAPSED}s (timeout did not fire)"
[ "$ELAPSED" -lt 30 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))

# --- untracked and modified files left by verify are not a failure (test caches) ---
run_case tv-cache --verify-cmd 'echo more >> ok.txt; echo cache > tip-cache.tmp'
assert_eq "$EXIT" "0" "cache file exits 0"
assert_eq "$(jget "$J" status)" "committed" "untracked and modified files left by verify are not a failure"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "cache file tip_verify pass"

# --- a verify command that commits moves the tip and must not be reported committed ---
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t
git -C "$SBX" config commit.gpgsign false
MOVE_CMD='git commit --allow-empty -m x'
run_case tv-move --verify-cmd "$MOVE_CMD"
assert_eq "$EXIT" "3" "commit --allow-empty during verify exits 3"
assert_eq "$(jget "$J" status)" "verify_failed" "commit --allow-empty during verify is verify_failed"
assert_eq "$(jget "$J" tip_verify.status)" "fail" "moved tip is tip_verify fail"
assert_eq "$(jget "$J" tip_verify.commands.0.rc)" "1" "moved tip records rc 1"
assert_contains "$(jget "$J" tip_verify.commands.0.cmd)" "git commit --allow-empty -m x" "moved tip names the command"
MOVE_OLD="$(jget "$J" tip_verify.commit)"
MOVE_NEW="$(git -C "$SBX" rev-parse refs/heads/tv-move)"
assert_neq "$MOVE_OLD" "$MOVE_NEW" "moved tip: branch ref left the committed sha"
MOVE_TAIL="$(jget "$J" tip_verify.commands.0.tail)"
assert_contains "$MOVE_TAIL" "expected=$MOVE_OLD" "moved tip tail names the expected sha"
assert_contains "$MOVE_TAIL" "head=$MOVE_NEW" "moved tip tail names the new HEAD sha"
assert_contains "$MOVE_TAIL" "branch=$MOVE_NEW" "moved tip tail names the new branch sha"
assert_contains "$MOVE_TAIL" "git commit --allow-empty -m x" "moved tip tail names the command"
assert_eq "$(jget "$J" commit)" "$MOVE_OLD" "reported commit stays the pre-verify sha"

# --- ~3 MiB of stdout on a zero exit is a pass (default 1 MiB maxBuffer would ENOBUFS) ---
run_case tv-big --verify-cmd 'node -e "process.stdout.write((\"x\".repeat(80)+String.fromCharCode(10)).repeat(40000))"'
assert_eq "$EXIT" "0" "~3 MiB verify stdout exits 0"
assert_eq "$(jget "$J" status)" "committed" "~3 MiB verify stdout is committed"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "~3 MiB verify stdout tip_verify pass"
assert_eq "$(jget "$J" tip_verify.commands.0.rc)" "0" "~3 MiB verify stdout records rc 0"

# --- this repo's real quality-gate-config.md: fenced default, source repo_config ---
rm -f "$SBX/.claude/quality-gate-config.md"
ln -s "$REPO_ROOT/.claude/quality-gate-config.md" "$SBX/.claude/quality-gate-config.md"
CASE_PROMPT="$PROMPT_PLAIN"
run_case tv-real-repo-config
assert_eq "$(jget "$J" tip_verify.source)" "repo_config" "real quality-gate-config source repo_config"
assert_eq "$(jget "$J" tip_verify.commands.0.cmd)" "node scripts/affected-suites.js --base develop --run" "real quality-gate-config command"
assert_eq "$(jget "$J" tip_verify.commands.1.cmd)" "" "real quality-gate-config is one command"

# --- negative control: ignore a failing rc → the false case goes wrongly green ---
FARM="$TEST_TMP/farm-tip"
rm -rf "$FARM"
mkdir -p "$FARM"
for e in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]*; do
  [ -e "$e" ] || continue
  [ "$(basename "$e")" = .git ] && continue
  ln -s "$e" "$FARM/$(basename "$e")"
done
real="$(readlink -f "$FARM/scripts")"
rm "$FARM/scripts"
mkdir "$FARM/scripts"
for e in "$real"/* "$real"/.[!.]*; do
  [ -e "$e" ] || continue
  ln -s "$e" "$FARM/scripts/$(basename "$e")"
done
rm "$FARM/scripts/dispatch-hetero.sh"
sed_mutant "$SCRIPT" "$FARM/scripts/dispatch-hetero.sh" \
  's/if \[ "\$tip_verify_rc" -ne 0 \]; then/if false; then/' \
  || fail "negative control: sed did not change the gate"
chmod +x "$FARM/scripts/dispatch-hetero.sh"
BROKEN="$FARM/scripts/dispatch-hetero.sh"
grep -q 'if false; then' "$BROKEN" || fail "negative control: broken rail missing if false"
grep -q 'if \[ "\$tip_verify_rc" -ne 0 \]; then' "$SCRIPT" \
  || fail "negative control: original gate was modified"
SAVED_SCRIPT="$SCRIPT"
SCRIPT="$BROKEN"
run_case tv-neg --verify-cmd false
SCRIPT="$SAVED_SCRIPT"
if [ "$(jget "$J" status)" = "verify_failed" ]; then
  fail "negative control: false case stayed verify_failed (assertion did not go red)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(jget "$J" status)" "committed" "negative control: ignoring rc reports committed"
assert_eq "$EXIT" "0" "negative control: ignoring rc exits 0"
assert_eq "$(jget "$J" tip_verify.status)" "fail" "negative control: command rc still recorded as fail"

# --- negative control: remove the tip re-check → the empty commit is wrongly committed ---
rm -f "$FARM/scripts/dispatch-hetero.sh"
sed_mutant "$SCRIPT" "$FARM/scripts/dispatch-hetero.sh" \
  's/if (headNow !== commit || branchNow !== commit)/if (false)/' \
  || fail "negative control: sed did not remove the tip gate"
chmod +x "$FARM/scripts/dispatch-hetero.sh"
BROKEN="$FARM/scripts/dispatch-hetero.sh"
grep -q 'if (false)' "$BROKEN" || fail "negative control: broken rail missing if (false)"
grep -q 'if (headNow !== commit || branchNow !== commit)' "$SCRIPT" \
  || fail "negative control: original tip gate was modified"
SCRIPT="$BROKEN"
run_case tv-neg-move --verify-cmd "$MOVE_CMD"
SCRIPT="$SAVED_SCRIPT"
if [ "$(jget "$J" status)" = "verify_failed" ]; then
  fail "negative control: empty commit stayed verify_failed (tip gate assertion did not go red)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(jget "$J" status)" "committed" "negative control: without the tip gate an empty commit is committed"
assert_eq "$EXIT" "0" "negative control: without the tip gate an empty commit exits 0"

finalize_test
