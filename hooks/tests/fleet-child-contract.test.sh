#!/usr/bin/env bash
# BL-0251 -- a claude child a rail launches declares itself to fleet: child_session_mint (scripts/lib/repo-identity.sh)
# exports FLEET_LIFETIME=ephemeral (always, an inherited durable is overridden), FLEET_PARENT (the launching CC session
# id when no FLEET_PARENT is inherited) and FLEET_ROLE (review-seat for dispatch-review, hand for author/hetero).
# Seams: a stub claude that dumps its environment; no fleet binary is ever called and no fleet message is sent.
# RED at 7d6c745be: 1 passed, 19 failed (stub claude env has FLEET_LIFETIME/FLEET_PARENT/FLEET_ROLE all empty for author, review, hetero; durable stays durable; mint unit prints "||").
# RED at 322d0f3f8 (run-skill-opt addition): 55 passed, 1 failed -- the claude -p child argv under run-skill-opt had no --strict-mcp-config (no PATH wrapper).
# RED (second commit, base 499b0ce4f): 26 passed, 12 failed (hetero cc-shim, probe cc-shim and claude-native lacked --strict-mcp-config; probe lacked FLEET_*; qualification-review-provider claude child had no FLEET_*).
# RED (third pass, base 3b7d283b0): 39 passed, 15 failed (probe-todo-tools-pin, run-eval-batch, probe-skill-frontmatter-portability lacked --strict-mcp-config and FLEET_*; run-skill-opt run_loop env had no FLEET_*). profile-context-isolation.test.sh also red at 3b7d283b0: child claude env "||" instead of ephemeral|profile-parent-1|profile-run.
. "$(dirname "$0")/lib.sh"
export AUTOPILOT_TEST_ALLOW_HETERO_SEAMS=1
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-fcc-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1 AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9/v1" AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID \
  AUTOPILOT_CHILD_SESSION_ID AUTOPILOT_SESSION_MODE_DIR FLEET_LIFETIME FLEET_PARENT FLEET_ROLE \
  GIT_CONFIG_COUNT GIT_ALLOW_PROTOCOL 2>/dev/null || true

AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX/.claude"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
SBX="$(cd "$SBX" && pwd -P)"
P="pppppppp-1111-2222-3333-444444444444"
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"
DIFF="$TEST_TMP/d.diff"; printf '+x\n' > "$DIFF"
DUMPS="$TEST_TMP/dumps"; mkdir -p "$DUMPS"
BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "claude 9.9.9 (test stub)"; exit 0; fi
env | LC_ALL=C sort > "${STUB_DUMP:?}"
printf '%s\n' "$@" > "${STUB_DUMP}.argv"
[ -t 0 ] || timeout 2 cat >/dev/null 2>&1 || true
echo "ok"
exit 0
EOS
chmod +x "$BINDIR/claude"

# run_rail <tag> <extra env assignment> <cmd...>: launcher is session P; dump = the stub claude's environment
run_rail() {
  local tag="$1" extra="$2"; shift 2
  E_DUMP="$DUMPS/$tag.env"; rm -f "$E_DUMP"
  mkdir -p "$TEST_TMP/m-$tag" "$TEST_TMP/r-$tag"
  ( cd "$SBX" && timeout 120 env -u REPO_ROOT -u CONSUMING_REPO_ROOT "$extra" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/r-$tag" \
      AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/m-$tag" STUB_DUMP="$E_DUMP" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
      "$@" >"$E_DUMP.out" 2>&1 ) || true
}
dv() { grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; }
# check <label> <role> <dump>
check() {
  local label="$1" role="$2" d="$3"
  if [ ! -f "$d" ]; then fail "$label: the stub claude never ran (not_run): $(tail -c 300 "$d.out" 2>/dev/null | tr '\n' ' ')"; return; fi
  assert_contains "$(cat "$d.argv" 2>/dev/null)" "--strict-mcp-config" "$label: claude argv carries --strict-mcp-config"
  eq "ephemeral" "$(dv "$d" FLEET_LIFETIME)" "$label: FLEET_LIFETIME == ephemeral"
  eq "$P" "$(dv "$d" FLEET_PARENT)" "$label: FLEET_PARENT == the launching session"
  eq "$role" "$(dv "$d" FLEET_ROLE)" "$label: FLEET_ROLE == $role"
}

run_rail author-native X_UNUSED=1 "$AUTHOR" --runner claude-native --model claude-haiku --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check "author claude-native" hand "$E_DUMP"
run_rail author-ccshim X_UNUSED=1 "$AUTHOR" --runner cc-shim --model MiniMax-M3 --prompt-file "$PROMPT" --bin "$BINDIR/claude" --timeout 60s
check "author cc-shim" hand "$E_DUMP"
run_rail review-native X_UNUSED=1 "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review claude-native" review-seat "$E_DUMP"
run_rail review-ccshim X_UNUSED=1 "$REVIEW" --runner cc-shim --model MiniMax-M3 --endpoint TESTEP --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review cc-shim" review-seat "$E_DUMP"
run_rail hetero X_UNUSED=1 bash "$HETERO" --runner cc-shim --model MiniMax-M3 --effort high --branch feat/fcc-h --prompt-file "$PROMPT" --run-id fcc-h
check "hetero cc-shim" hand "$E_DUMP"
# probe-engine-capability.sh: both claude branches (BL-0251: strict MCP + mint)
for runner in cc-shim claude-native; do
  d="$DUMPS/probe-$runner.env"; rm -f "$d" "$d.argv"
  ( cd "$SBX" && timeout 90 env STUB_DUMP="$d" PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
      ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=t bash "$REPO_ROOT/scripts/probe-engine-capability.sh" \
      quota --runner "$runner" --model m-test --role reviewer --store "$TEST_TMP/probe-store-$runner" --live-spend >"$d.out" 2>&1 ) || true
  check "probe $runner" probe "$d"
done
# qualification-review-provider.js (QRP_CLI_KIND=claude): eval-run children
d="$DUMPS/qrp.env"; rm -f "$d" "$d.argv"
printf '{"type":"result","is_error":false,"result":"{\\"findings\\":[]}","modelUsage":{"claude-sonnet-5-5":{}}}' > "$TEST_TMP/qrp.json"
cat > "$TEST_TMP/qrp-stub" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
env | LC_ALL=C sort > "${STUB_DUMP:?}"; printf '%s\n' "$@" > "${STUB_DUMP}.argv"
cat "$STUB_OUT"
EOS
chmod +x "$TEST_TMP/qrp-stub"
STUB_DUMP="$d" STUB_OUT="$TEST_TMP/qrp.json" QRP_CLI_BIN="$TEST_TMP/qrp-stub" QRP_TRANSPORT=cli QRP_CLI_KIND=claude QRP_PROVIDER=t \
  QRP_MODEL=claude-sonnet-5-5 CLAUDE_CODE_SESSION_ID="$P" node "$REPO_ROOT/scripts/qualification-review-provider.js" \
  <<<'{"role":"reviewer","payload":{"format":"case_content","content":"diff --git a/f b/f\n+x\n"}}' >"$d.out" 2>&1 || true
check "qualification-review-provider claude" eval-run "$d"

# --- third pass: audit gaps found by independent verification (cv4) ---
# probe-todo-tools-pin.js: spawnSync claude -p inherits env; must add strict MCP + the fleet contract (role probe)
d="$DUMPS/todo-pin.env"; rm -f "$d" "$d.argv"
( cd "$SBX" && STUB_DUMP="$d" CLAUDE_CODE_SESSION_ID="$P" node "$REPO_ROOT/scripts/probe-todo-tools-pin.js" --claude-bin "$BINDIR/claude" --timeout-seconds 30 >"$d.out" 2>&1 ) || true
check "probe-todo-tools-pin" probe "$d"
# run-eval-batch.sh: the claude wrapper that every run_eval.py query goes through
d="$DUMPS/eval-batch.env"; rm -f "$d" "$d.argv"
cat > "$TEST_TMP/eval-runner" <<'EOS'
#!/usr/bin/env bash
claude -p "query" --model m
EOS
chmod +x "$TEST_TMP/eval-runner"
( cd "$SBX" && STUB_DUMP="$d" PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" RUN_EVAL_CMD="$TEST_TMP/eval-runner" TMPDIR="$TEST_TMP" \
    bash "$REPO_ROOT/scripts/run-eval-batch.sh" --selftest >"$d.out" 2>&1 ) || true
check "run-eval-batch" eval-run "$d"
# probe-skill-frontmatter-portability.sh: the claude --bare -p exec (bare skips hooks/settings, NOT MCP)
d="$DUMPS/psf.env"; rm -f "$d" "$d.argv"
( cd "$SBX" && STUB_DUMP="$d" PATH="$BINDIR:$PATH" CLAUDE_CODE_SESSION_ID="$P" \
    bash "$REPO_ROOT/scripts/probe-skill-frontmatter-portability.sh" --check --output "$TEST_TMP/psf-receipt.json" >"$d.out" 2>&1 ) || true
assert_contains "$(cat "$d.argv" 2>/dev/null)" "--bare" "probe-skill-frontmatter: the dump is the claude --bare exec"
check "probe-skill-frontmatter-portability" probe "$d"
# run-skill-opt.sh: the external run_loop (not in this repo) starts bare `claude -p` children from PATH; the script's PATH wrapper must append --strict-mcp-config
hopt="$TEST_TMP/hopt"; mkdir -p "$hopt/ap/scripts/lib" "$hopt/ap/skills/xs" "$hopt/ap/skill-creator-workspace/evals" "$hopt/home/.claude" "$hopt/bin" \
  "$hopt/home/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
cp "$REPO_ROOT/scripts/run-skill-opt.sh" "$hopt/ap/scripts/"; cp "$REPO_ROOT/scripts/lib/repo-identity.sh" "$hopt/ap/scripts/lib/"
echo '{}' > "$hopt/ap/skill-creator-workspace/evals/xs-evals.json"
printf '{"claudeAiOauth":{"accessToken":"tok","expiresAt":99999999999999}}' > "$hopt/home/.claude/.credentials.json"
REAL_PY="$(command -v python3)"
cat > "$hopt/bin/python3" <<EOS
#!/usr/bin/env bash
if [ "\${1:-}" = "-c" ] && case "\${2:-}" in *run_loop*) true;; *) false;; esac; then env | LC_ALL=C sort > "\${STUB_DUMP:?}"; claude -p q --model m >/dev/null 2>&1 || true; exit 0; fi
exec "$REAL_PY" "\$@"
EOS
chmod +x "$hopt/bin/python3"
# the claude that run_eval.py would find on PATH (behind the script's wrapper): records the argv it finally receives
cat > "$hopt/bin/claude" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${STUB_DUMP:?}.cargv"
exit 0
EOS
chmod +x "$hopt/bin/claude"
d="$DUMPS/skill-opt.env"; rm -f "$d" "$d.cargv"
( cd "$SBX" && HOME="$hopt/home" STUB_DUMP="$d" PATH="$hopt/bin:$PATH" CLAUDE_CODE_SESSION_ID="$P" bash "$hopt/ap/scripts/run-skill-opt.sh" xs >"$d.out" 2>&1 ) || true
if [ ! -f "$d" ]; then fail "run-skill-opt: run_loop stub never ran: $(tail -c 300 "$d.out" | tr '\n' ' ')"; else
  eq "ephemeral" "$(dv "$d" FLEET_LIFETIME)" "run-skill-opt: FLEET_LIFETIME == ephemeral"
  eq "$P" "$(dv "$d" FLEET_PARENT)" "run-skill-opt: FLEET_PARENT == the launching session"
  eq "eval-run" "$(dv "$d" FLEET_ROLE)" "run-skill-opt: FLEET_ROLE == eval-run"
  # the claude -p that run_loop's run_eval.py spawns (stand-in: the stub python runs `claude -p q --model m`) gets strict MCP appended
  assert_contains "$(cat "$d.cargv" 2>/dev/null)" "--strict-mcp-config" "run-skill-opt: the claude -p child argv carries --strict-mcp-config"
  assert_contains "$(cat "$d.cargv" 2>/dev/null)" "--model" "run-skill-opt: the original claude argv is preserved"
fi

# run-skill-opt wrapper self-exclusion: a TMPDIR with a trailing slash must not make the wrapper find itself (infinite exec; timeout 10 turns that into red)
# RED at cb1f9dbd9: 56 passed, 1 failed -- trailing-slash TMPDIR: the wrapper exec'd itself until the timeout
d="$DUMPS/skill-opt-slash.env"; rm -f "$d" "$d.cargv"
mkdir -p "$TEST_TMP/slash-tmp"
( cd "$SBX" && HOME="$hopt/home" STUB_DUMP="$d" PATH="$hopt/bin:$PATH" CLAUDE_CODE_SESSION_ID="$P" TMPDIR="$TEST_TMP/slash-tmp/" timeout 10 bash "$hopt/ap/scripts/run-skill-opt.sh" xs >"$d.out" 2>&1 < /dev/null ) || true
assert_contains "$(cat "$d.cargv" 2>/dev/null)" "--strict-mcp-config" "run-skill-opt: trailing-slash TMPDIR still reaches the real claude (no self-exec)"

# an inherited durable lifetime never survives: a child is never promoted to durable
run_rail review-durable FLEET_LIFETIME=durable "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
check "review with inherited FLEET_LIFETIME=durable" review-seat "$E_DUMP"
# an inherited FLEET_PARENT (a fleet address) wins over the CC session id
run_rail review-parent FLEET_PARENT=ns/courier/member "$REVIEW" --runner claude-native --model claude-haiku --diff-file "$DIFF" --bin "$BINDIR/claude"
eq "ns/courier/member" "$(dv "$E_DUMP" FLEET_PARENT)" "inherited FLEET_PARENT is kept"

# the mint function itself: role argument, default role, idempotence
out="$(env -u FLEET_ROLE -u FLEET_PARENT -u FLEET_LIFETIME CLAUDE_CODE_SESSION_ID="$P" bash -c '. "$1"; child_session_mint; echo "$FLEET_LIFETIME|$FLEET_PARENT|$FLEET_ROLE"; child_session_mint x; echo "$FLEET_ROLE"' _ "$REPO_ROOT/scripts/lib/repo-identity.sh")"
eq "ephemeral|$P|child"$'\n'"x" "$out" "child_session_mint: defaults and role argument"

finalize_test
