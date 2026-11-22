#!/usr/bin/env bash
export AUTOPILOT_KIMI_LOCAL_ALLOW=1  # Test-only: this suite uses fake Kimi binaries.
export AUTOPILOT_TEST_CN_GATE_OFF=1  # cn-model gate: sentinel dispatch tests carry no Size/Role/Scope
# dispatch-hetero --runner kimi integration test (v2.36.x, kimi-implementer-rail).
#
# The kimi rail is grok/opencode-shaped (EDIT-ONLY directive prepended,
# wrapper commits, verdict from git artifacts) EXCEPT for prompt transport: kimi 0.41.0
# takes the prompt ONLY as one -p argv string (no --prompt-file, no STDIN — Stage-0 spike
# 2026-09-11, docs/plans/_archive/2026/09/2026-09-11-kimi-implementer-rail.md §0), so a pre-spend argv-byte
# gate sends oversized prompts through temporary part files. `-p` cannot combine with --auto/-y — no such flags are
# passed. Only the binary is stubbed; the real dispatch-hetero.sh runs.
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$RUNS_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS_DIR"
export DISPATCH_QUIET=1
ARGV_LOG="$TEST_TMP/argv.log"

# Stub kimi: records argv (the -p value included, since kimi takes it as one argv string),
# honors process cwd (no --dir/--cwd flag on this rail), writes a file (committed path).
mkdir -p "$TEST_TMP/bin"
export PATH="$TEST_TMP/bin:$PATH"
STUB_OK="$TEST_TMP/bin/kimi"
cat > "$STUB_OK" <<__EOF1
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$ARGV_LOG"
python3 - "$ARGV_LOG" "$TEST_TMP" "\$@" <<'PYFAKE'
import pathlib, re, sys
args = sys.argv[3:]
prompt = args[args.index('-p') + 1]
paths = re.findall(r'(/[^ ,]+/autopilot-hetero-prompt\.part-\d+)', prompt)
if paths:
    pathlib.Path(sys.argv[2], 'parts-dir').write_text(str(pathlib.Path(paths[0]).parent))
    pathlib.Path(sys.argv[2], 'reassembled').write_bytes(b''.join(pathlib.Path(p).read_bytes() for p in paths))
PYFAKE
[ "\${FAKE_KIMI_FAIL:-0}" = 0 ] || exit 1
echo kimi-edited > ki_out.txt
printf 'done\n'
__EOF1
chmod +x "$STUB_OK"

# Stub kimi: no edit, exit 0 (no_op).
STUB_NOOP="$TEST_TMP/kimi-noop"
cat > "$STUB_NOOP" <<'__EOF2'
#!/usr/bin/env bash
printf 'nothing to do\n'
__EOF2
chmod +x "$STUB_NOOP"

# Stub kimi: exits non-zero.
STUB_FAIL="$TEST_TMP/kimi-fail"
cat > "$STUB_FAIL" <<'__EOF3'
#!/usr/bin/env bash
echo "provider error" >&2
exit 1
__EOF3
chmod +x "$STUB_FAIL"

# 1) committed path
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --branch feat/kimi-ok --prompt-file "$PROMPT" --kimi-bin "$STUB_OK" --context-window off 2>&1)"
RC=$?
assert_eq "0" "$RC" "kimi committed path exit 0"
assert_contains "$OUT" '"status": "committed"' "kimi committed status"
assert_contains "$OUT" '"runner": "kimi"' "kimi runner in final JSON"
assert_contains "$OUT" '"model": "kimi-code/k3"' "model id passed through verbatim"
OUT_JSON="$(printf '%s\n' "$OUT" | grep '^{ "status"' | tail -1)"
assert_contains "$OUT_JSON" '"files_changed": 1' "one file committed by the wrapper"
# argv contract: -m <model> -p <combined-prompt-string> --output-format text
ARGV="$(cat "$ARGV_LOG")"
assert_contains "$ARGV" '-m kimi-code/k3' "argv carries -m <model>"
assert_contains "$ARGV" '--output-format text' "argv carries --output-format text"
assert_not_contains "$ARGV" '--auto' "argv never carries --auto (cannot combine with -p)"
assert_not_contains "$ARGV" ' -y ' "argv never carries -y (cannot combine with -p)"
# prompt travels as ONE argv string with the EDIT-ONLY directive prepended, task text intact
assert_contains "$ARGV" 'HARNESS DIRECTIVE' "argv -p string carries the EDIT-ONLY directive"
assert_contains "$ARGV" 'Do NOT
git commit' "directive forbids committing"
assert_contains "$ARGV" 'update repo file' "argv -p string carries the task text"
# the commit landed on the branch, HEAD of the caller repo untouched
assert_eq "base" "$(git -C "$SBX" log -1 --format=%s)" "caller HEAD untouched"
assert_eq "kimi-edited" "$(git -C "$SBX" show feat/kimi-ok:ki_out.txt)" "edited file is on the dispatch branch"
RUN_ID="$(printf '%s' "$OUT_JSON" | sed -n 's/.*"run_id": "\([^"]*\)".*/\1/p')"
assert_file_exists "$RUNS_DIR/$RUN_ID.manifest.json" "kimi run manifest written"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"runner": "kimi"' "manifest runner provenance"
assert_contains "$(cat "$RUNS_DIR/$RUN_ID.manifest.json")" '"log_format": "plain"' "manifest log_format plain (kimi stream-json has no usage today)"

# 2) no_op path
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --branch feat/kimi-noop --prompt-file "$PROMPT" --kimi-bin "$STUB_NOOP" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "no_op"' "no edit → no_op"
assert_contains "$OUT" '"runner": "kimi"' "no_op keeps runner provenance"

# 3) failure path
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --branch feat/kimi-fail --prompt-file "$PROMPT" --kimi-bin "$STUB_FAIL" --context-window off 2>&1)"
RC=$?
# same classification every rail gives a nonzero exit with no commit: question_suspected
assert_contains "$OUT" '"status": "question_suspected"' "nonzero exit + no edit → question_suspected (worktree kept)"
assert_not_contains "$OUT" '"status": "committed"' "failure path is not committed"
[ "$RC" -ne 0 ] && assert_eq ok ok "failure path exits nonzero" || fail "failure path exited 0"

# 4) Large payload is carried in ordered part files, then removed on either exit.
BIG_PROMPT="$TEST_TMP/kimi-big-prompt.txt"
python3 - "$BIG_PROMPT" <<'PYBIG'
import pathlib, sys
pathlib.Path(sys.argv[1]).write_bytes((b'UNIQUE-PROMPT-CONTENT-' * 10000)[:200000])
PYBIG
for outcome in success failure; do
  rm -f "$ARGV_LOG" "$TEST_TMP/parts-dir" "$TEST_TMP/reassembled"
  failure=0; [ "$outcome" = success ] || failure=1
  OUT="$(cd "$SBX" && FAKE_KIMI_FAIL="$failure" "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --branch "feat/kimi-big-$outcome" --prompt-file "$BIG_PROMPT" --kimi-bin "$STUB_OK" --context-window off 2>&1)"
  RC=$?
  if [ "$outcome" = success ]; then
    assert_eq "$RC" 0 'large prompt accepted'
    assert_contains "$OUT" '"status": "committed"' 'large prompt committed'
  else
    [ "$RC" -ne 0 ] && assert_eq ok ok 'fake failure exits nonzero' || fail 'fake failure exited 0'
  fi
  assert_file_exists "$ARGV_LOG" "$outcome: fake ran"
  assert_file_exists "$TEST_TMP/parts-dir" "$outcome: pointer names parts"
  if [ -f "$ARGV_LOG" ]; then
    assert_not_contains "$(cat "$ARGV_LOG")" 'UNIQUE-PROMPT-CONTENT' "$outcome: argv excludes prompt"
    [ "$(wc -c < "$ARGV_LOG")" -lt 4096 ] && assert_eq ok ok "$outcome: argv is short" || fail "$outcome: argv too long"
  fi
  if [ -f "$TEST_TMP/reassembled" ]; then
    python3 - "$TEST_TMP/reassembled" "$BIG_PROMPT" <<'PYCHECK'
import pathlib, sys
combined, original = (pathlib.Path(p).read_bytes() for p in sys.argv[1:])
assert combined.startswith(b'=== HARNESS DIRECTIVE') and combined.count(original) == 1
PYCHECK
    assert_eq "$?" 0 "$outcome: parts reproduce prompt bytes in order"
  else
    fail "$outcome: no reassembled prompt"
  fi
  if [ -f "$TEST_TMP/parts-dir" ]; then
    [ ! -e "$(cat "$TEST_TMP/parts-dir")" ] && assert_eq ok ok "$outcome: parts directory removed" || fail "$outcome: parts directory remains"
  fi
done

# 4b) effort reaches kimi as KIMI_MODEL_THINKING_EFFORT (the CLI has no effort flag; without
# the variable it runs config.toml's default_effort, so a "high" seat silently ran "max").
ENV_LOG="$TEST_TMP/kimi-env.log"
STUB_ENV="$TEST_TMP/kimi-env"
cat > "$STUB_ENV" <<__EOFE
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$ARGV_LOG"
if [ "\${KIMI_MODEL_THINKING_EFFORT+set}" = set ]; then printf 'SET:%s\n' "\$KIMI_MODEL_THINKING_EFFORT" > "$ENV_LOG"; else printf 'UNSET\n' > "$ENV_LOG"; fi
echo kimi-edited > ki_out.txt
__EOFE
chmod +x "$STUB_ENV"
for e in low high max; do
  rm -f "$ENV_LOG"
  OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --effort "$e" --branch "feat/kimi-eff-$e" --prompt-file "$PROMPT" --kimi-bin "$STUB_ENV" --context-window off 2>&1)"
  assert_eq "SET:$e" "$(cat "$ENV_LOG" 2>/dev/null)" "kimi --effort $e reaches the CLI as KIMI_MODEL_THINKING_EFFORT=$e"
  assert_not_contains "$(cat "$ARGV_LOG")" "--effort" "kimi effort travels in the env, not argv"
done
rm -f "$ENV_LOG"
OUT="$(cd "$SBX" && KIMI_MODEL_THINKING_EFFORT=max "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --effort default --branch feat/kimi-eff-default --prompt-file "$PROMPT" --kimi-bin "$STUB_ENV" --context-window off 2>&1)"
assert_eq "UNSET" "$(cat "$ENV_LOG" 2>/dev/null)" "kimi --effort default sends no effort variable (an ambient one is scrubbed)"
rm -f "$ENV_LOG"
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --branch feat/kimi-eff-unset --prompt-file "$PROMPT" --kimi-bin "$STUB_ENV" --context-window off 2>&1)"
assert_eq "UNSET" "$(cat "$ENV_LOG" 2>/dev/null)" "kimi without an explicit --effort sends no effort variable (the xhigh script default is not a seat decision)"
for e in medium xhigh; do
  rm -f "$ENV_LOG"
  OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/k3 --effort "$e" --branch "feat/kimi-eff-bad-$e" --prompt-file "$PROMPT" --kimi-bin "$STUB_ENV" --context-window off 2>&1)"
  RC=$?
  assert_eq "2" "$RC" "kimi --effort $e fails closed (kimi supports low|high|max only)"
  assert_contains "$OUT" '"status": "precondition_failed"' "kimi --effort $e reports precondition_failed"
  assert_contains "$OUT" 'low|high|max' "kimi --effort $e refusal names the accepted values"
  assert_file_absent "$ENV_LOG" "kimi --effort $e: the CLI was never spawned"
done

# 5) preconditions: missing binary; auto never selects kimi; --model required; runner enum names kimi
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner kimi --model kimi-code/x --branch feat/kimi-nobin --prompt-file "$PROMPT" --kimi-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_contains "$OUT" '"status": "precondition_failed"' "missing kimi binary fails closed"
assert_contains "$OUT" 'kimi binary not found' "missing binary names the fix"
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner auto --model kimi-code/k3 --branch feat/kimi-auto --prompt-file "$PROMPT" --agy-bin "$TEST_TMP/does-not-exist" --context-window off 2>&1)"
assert_not_contains "$OUT" '"runner": "kimi"' "auto never routes a provider/alias id to kimi"
OUT="$(cd "$SBX" && "$SCRIPT" --no-verify-tip --runner bogus --model x --branch feat/kimi-enum --prompt-file "$PROMPT" 2>&1)"
assert_contains "$OUT" 'opencode|kimi' "runner enum error names kimi"

finalize_test
