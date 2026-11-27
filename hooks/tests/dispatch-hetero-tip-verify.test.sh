#!/usr/bin/env bash
# Tip verification: the rail re-runs acceptance at the committed tip.
# A worker that claims green on a failing command must not be reported done.
. "$(dirname "$0")/lib.sh"

install_cli_sentinels
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
unset AUTOPILOT_TIP_VERIFY_REQUIRE AUTOPILOT_TIP_VERIFY_GRACE_FILE

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
PROMPT_ACC_PASS="$TEST_TMP/prompt-acc-pass.txt"
cat > "$PROMPT_ACC_PASS" <<'EOF'
edit the tree

## Acceptance
```bash
true
```
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

# Finalized manifest compact tip_verify. jget prints "" for both null and a missing key.
assert_manifest_tip() {
  local expect_tip="$1" expect_src="$2" label="$3"
  local id mf runs
  id="$(jget "$J" run_id)"
  [ -n "$id" ] || fail "$label manifest: result has no run_id"
  if [ -n "${AUTOPILOT_DISPATCH_RUNS_DIR:-}" ]; then
    runs="$AUTOPILOT_DISPATCH_RUNS_DIR"
  else
    runs="${TMPDIR:-/tmp}/autopilot-dispatch-runs"
  fi
  mf="$runs/${id}.manifest.json"
  assert_file_exists "$mf" "$label manifest exists"
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const tip = process.argv[2] === "null" ? null : process.argv[2];
    const src = process.argv[3] === "null" ? null : process.argv[3];
    // target_precommit legitimately carries its own {status,hook,rc,tail}; the check is that tip_verify never copies a command tail.
    const { target_precommit: _tp, ...rest } = m;
    const text = JSON.stringify(rest);
    function die(code, msg) { process.stderr.write(msg + "\n"); process.exit(code); }
    if (!Object.prototype.hasOwnProperty.call(m, "tip_verify")) die(1, "missing tip_verify");
    if (!Object.prototype.hasOwnProperty.call(m, "tip_verify_source")) die(2, "missing tip_verify_source");
    if (m.tip_verify !== tip) die(3, "tip_verify " + JSON.stringify(m.tip_verify));
    if (m.tip_verify_source !== src) die(4, "tip_verify_source " + JSON.stringify(m.tip_verify_source));
    if (m.tip_verify !== null && typeof m.tip_verify !== "string") die(5, "tip_verify is not a string");
    if (m.final_status === null || m.final_status === undefined) die(6, "manifest not finalized");
    if (text.indexOf("\"tail\"") !== -1) die(7, "manifest copied a command tail");
    if (text.indexOf("\"commands\"") !== -1) die(8, "manifest copied commands");
  ' "$mf" "$expect_tip" "$expect_src" || fail "$label manifest tip_verify"
}

# run_case <branch> [extra args...] — prompt is $CASE_PROMPT (default plain).
run_case() {
  local br="$1"; shift
  local prompt="${CASE_PROMPT:-$PROMPT_PLAIN}"
  EXIT=0
  OUT="$(cd "$SBX" && "$SCRIPT" --branch "$br" --prompt-file "$prompt" --agy-bin "$STUB" --runner agy --pin-reason "test fixture" "$@" 2>&1)" || EXIT=$?
  J="$(last_json "$OUT")"
}

HELP="$("$SCRIPT" --help)"
assert_contains "$HELP" "put acceptance commands in a fenced block under ## Acceptance" "help says to put acceptance commands in a fenced block under ## Acceptance"

# --- no source, grace list non-empty: committed, tip_verify no_source, stderr names this sandbox ---
SBX_NAME="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.repoName(process.argv[2] || "", process.argv[3] || ""))' \
  "$REPO_ROOT/scripts/lib/tip-verify-repo-default.js" \
  "$(git -C "$SBX" remote get-url origin 2>/dev/null || true)" \
  "$(git -C "$SBX" rev-parse --show-toplevel)")"
assert_eq "$SBX_NAME" "repo" "sandbox repo name is the toplevel basename"
NOSRC_LINE="dispatch-hetero: tip verify: ${SBX_NAME} has no default test command; add a fenced bash block under ## Test Command in .claude/quality-gate-config.md (or a fenced block under ## Acceptance in the brief); the tip is not re-verified"
rm -f "$MARKER"
run_case tv-none
assert_eq "$EXIT" "0" "no source exits 0"
assert_eq "$(jget "$J" status)" "committed" "no source status committed"
assert_eq "$(jget "$J" tip_verify)" "no_source" "no source tip_verify no_source"
assert_manifest_tip no_source null "no source"
assert_eq "$(printf '%s\n' "$OUT" | grep -F -c "$NOSRC_LINE")" "1" "no source prints the stderr line once"
assert_file_exists "$MARKER" "no source: runner stub ran"

# --- AUTOPILOT_TIP_VERIFY_REQUIRE=1 restores the old refusal ---
rm -f "$MARKER"
AUTOPILOT_TIP_VERIFY_REQUIRE=1 run_case tv-require
assert_eq "$EXIT" "2" "require=1 exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "require=1 is precondition_failed"
assert_contains "$OUT" "--verify-cmd" "require=1 names --verify-cmd"
assert_contains "$OUT" "## Acceptance" "require=1 names ## Acceptance"
assert_contains "$OUT" "## Test Command" "require=1 names ## Test Command"
assert_contains "$OUT" "--no-verify-tip" "require=1 names --no-verify-tip"
assert_eq "$(printf '%s\n' "$OUT" | grep -F -c "$NOSRC_LINE")" "0" "require=1 does not print the no_source line"
assert_file_absent "$MARKER" "require=1: runner stub never ran"

# --- empty grace list refuses with the same die_precondition text ---
EMPTY_GRACE="$TEST_TMP/grace-empty.json"
printf '%s\n' '{"repos":[]}' > "$EMPTY_GRACE"
rm -f "$MARKER"
AUTOPILOT_TIP_VERIFY_GRACE_FILE="$EMPTY_GRACE" run_case tv-grace-empty
assert_eq "$EXIT" "2" "empty grace exits 2"
assert_eq "$(jget "$J" status)" "precondition_failed" "empty grace is precondition_failed"
assert_contains "$OUT" "--verify-cmd" "empty grace names --verify-cmd"
assert_contains "$OUT" "## Acceptance" "empty grace names ## Acceptance"
assert_contains "$OUT" "## Test Command" "empty grace names ## Test Command"
assert_contains "$OUT" "--no-verify-tip" "empty grace names --no-verify-tip"
assert_eq "$(printf '%s\n' "$OUT" | grep -F -c "$NOSRC_LINE")" "0" "empty grace does not print the no_source line"
assert_file_absent "$MARKER" "empty grace: runner stub never ran"

# --- prose with inline code only: not a brief source ---
rm -f "$MARKER"
CASE_PROMPT="$PROMPT_PROSE"
run_case tv-prose
CASE_PROMPT="$PROMPT_PLAIN"
assert_eq "$EXIT" "0" "prose inline acceptance exits 0"
assert_eq "$(jget "$J" status)" "committed" "prose inline acceptance is committed"
assert_eq "$(jget "$J" tip_verify)" "no_source" "prose inline is not a brief source"
assert_neq "$(jget "$J" tip_verify.source)" "brief" "prose inline is not source brief"
assert_file_exists "$MARKER" "prose inline: runner stub ran"

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
assert_manifest_tip fail brief "hydrogen"

# --- brief Acceptance pass: committed, manifest tip_verify pass / source brief ---
CASE_PROMPT="$PROMPT_ACC_PASS"
run_case tv-brief-pass
CASE_PROMPT="$PROMPT_PLAIN"
assert_eq "$EXIT" "0" "brief pass exits 0"
assert_eq "$(jget "$J" status)" "committed" "brief pass status committed"
assert_eq "$(jget "$J" tip_verify.status)" "pass" "brief pass tip_verify.status pass"
assert_eq "$(jget "$J" tip_verify.source)" "brief" "brief pass source brief"
assert_manifest_tip pass brief "brief pass"

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
assert_eq "$EXIT" "0" "real-shape repo prose exits 0"
assert_eq "$(jget "$J" status)" "committed" "real-shape repo prose is committed"
assert_eq "$(jget "$J" tip_verify)" "no_source" "real-shape repo prose is no_source"
assert_neq "$(jget "$J" status)" "verify_failed" "real-shape repo prose is not verify_failed"
assert_neq "$(jget "$J" tip_verify.source)" "repo_config" "real-shape repo prose is not repo_config"
assert_file_exists "$MARKER" "real-shape repo prose: runner stub ran"

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
assert_manifest_tip skipped_by_flag null "skip"

# --- timeout ---
START="$(date +%s)"
run_case tv-timeout --verify-cmd 'sleep 5' --verify-timeout 1
ELAPSED=$(( $(date +%s) - START ))
assert_neq "$EXIT" "0" "timeout exits non-zero"
assert_eq "$(jget "$J" status)" "verify_failed" "timeout dispatch status verify_failed"
assert_eq "$(jget "$J" tip_verify.status)" "timeout" "timeout tip_verify.status timeout"
assert_manifest_tip timeout flag "timeout"
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
assert_eq "$(jget "$J" tip_verify.commands.0.cmd)" "node scripts/affected-suites.js --base develop --fast --run" "real quality-gate-config command"
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

# --- negative control (paste): no-source refuses unconditionally → the no_source case goes red ---
rm -f "$FARM/scripts/dispatch-hetero.sh"
rm -f "$SBX/.claude/quality-gate-config.md"
sed_mutant "$SAVED_SCRIPT" "$FARM/scripts/dispatch-hetero.sh" \
  's/if \[ "\${AUTOPILOT_TIP_VERIFY_REQUIRE:-}" = "1" \]; then/if true; then/' \
  || fail "negative control: sed did not force the no-source refusal"
chmod +x "$FARM/scripts/dispatch-hetero.sh"
BROKEN="$FARM/scripts/dispatch-hetero.sh"
grep -q 'if true; then' "$BROKEN" || fail "negative control: broken rail missing if true"
grep -q 'if \[ "${AUTOPILOT_TIP_VERIFY_REQUIRE:-}" = "1" \]; then' "$SAVED_SCRIPT" \
  || fail "negative control: original require check was modified"
SCRIPT="$BROKEN"
rm -f "$MARKER"
CASE_PROMPT="$PROMPT_PLAIN"
run_case tv-neg-nosource
SCRIPT="$SAVED_SCRIPT"
if [ "$(jget "$J" status)" = "committed" ] && [ "$(jget "$J" tip_verify)" = "no_source" ]; then
  fail "negative control: no source stayed no_source (assertion did not go red)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(jget "$J" status)" "precondition_failed" "negative control: unconditional refuse is precondition_failed"
assert_eq "$EXIT" "2" "negative control: unconditional refuse exits 2"
assert_file_absent "$MARKER" "negative control: unconditional refuse never runs the stub"

# --- negative control (paste): empty grace list takes no_source → the empty-grace case goes red ---
rm -f "$FARM/scripts/dispatch-hetero.sh"
rm -f "$SBX/.claude/quality-gate-config.md"
sed_mutant "$SAVED_SCRIPT" "$FARM/scripts/dispatch-hetero.sh" \
  's/tip_verify_refuse # empty-grace-refuse/tip_verify_no_source; return 0 # empty-grace-refuse/' \
  || fail "negative control: sed did not make the empty list take no_source"
chmod +x "$FARM/scripts/dispatch-hetero.sh"
BROKEN="$FARM/scripts/dispatch-hetero.sh"
grep -q 'tip_verify_no_source; return 0 # empty-grace-refuse' "$BROKEN" \
  || fail "negative control: broken rail missing the no_source return"
grep -q 'tip_verify_refuse # empty-grace-refuse' "$SAVED_SCRIPT" \
  || fail "negative control: original empty-grace refuse was modified"
SCRIPT="$BROKEN"
rm -f "$MARKER"
CASE_PROMPT="$PROMPT_PLAIN"
AUTOPILOT_TIP_VERIFY_GRACE_FILE="$EMPTY_GRACE" run_case tv-neg-empty-grace
SCRIPT="$SAVED_SCRIPT"
if [ "$(jget "$J" status)" = "precondition_failed" ]; then
  fail "negative control: empty grace stayed refused (assertion did not go red)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(jget "$J" status)" "committed" "negative control: empty list taking no_source is committed"
assert_eq "$(jget "$J" tip_verify)" "no_source" "negative control: empty list taking no_source records no_source"
assert_eq "$EXIT" "0" "negative control: empty list taking no_source exits 0"
assert_file_exists "$MARKER" "negative control: empty list taking no_source runs the stub"
grep -q 'tip_verify_refuse # empty-grace-refuse' "$SAVED_SCRIPT" \
  || fail "negative control: original empty-grace refuse was not restored"

finalize_test
