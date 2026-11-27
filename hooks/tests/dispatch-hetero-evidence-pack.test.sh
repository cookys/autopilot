#!/usr/bin/env bash
unset AUTOPILOT_TOKEN_SEAT
# Evidence pack integration test for dispatch-hetero.sh (stub grok runner).
. "$(dirname "$0")/lib.sh"

TEST_NAME="dispatch-hetero-evidence-pack"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
$GIT -C "$SBX" init -q
$GIT -C "$SBX" commit -q --allow-empty -m base

STUB_GROK="$TEST_TMP/grok"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2 ;;
esac
if [ "${1:-}" = "--version" ]; then echo "grok-cli 0.2.111 (test stub)"; exit 0; fi
if [ -n "${STUB_PROMPT_CAPTURE:-}" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--prompt-file" ]; then cp "$2" "$STUB_PROMPT_CAPTURE"; break; fi
    shift
  done
fi
printf 'evidence fixture\n' >> ev-fixture.txt
git add ev-fixture.txt
git commit -q -m "stub: edit ev-fixture.txt"
if [ "${STUB_WRITE_NOTES:-1}" = "1" ]; then
  NOTES_PATH="$(git rev-parse --git-path evidence-notes.md)"
  mkdir -p "$(dirname "$NOTES_PATH")"
  cat > "$NOTES_PATH" <<'NOTES'
## Tests
0 node scripts/evidence-pack.test.js
0 bash hooks/tests/dispatch-hetero-evidence-pack.test.sh

## Risk
low
Stub test change only.
NOTES
fi
EOF
chmod +x "$STUB_GROK"

PROMPT="$TEST_TMP/prompt.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nSize: S\nRole: implementer\nedit ev-fixture.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs"
mkdir -p "$RUNS"

CAPTURED_PROMPT="$TEST_TMP/captured-prompt.txt"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  STUB_PROMPT_CAPTURE="$CAPTURED_PROMPT" STUB_WRITE_NOTES=1 \
  "$SCRIPT" --runner grok --pin-reason "test fixture" --grok-bin "$STUB_GROK" --no-verify-tip --context-window off \
  --branch "feat/ev-pack-stub" --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/err")"
EXIT=$?

assert_eq "0" "$EXIT" "dispatch-hetero with stub grok exits 0"

EP_PATH="$(node -e '
  const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
  const raw = lines.find((l) => l.trim().startsWith("{"));
  const o = raw ? JSON.parse(raw) : {};
  process.stdout.write(o.evidence_pack || "");
' "$OUT")"
assert_file_exists "$EP_PATH" "result JSON has evidence_pack pointing to existing file"

EP_CHECK="$(node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const out = [
    String(p.tests_green),
    String(p.risk && p.risk.level),
    String(p.mergeable),
    String(p.claude_usage && p.claude_usage.claude_tokens)
  ].join("|");
  process.stdout.write(out);
' "$EP_PATH")"
assert_eq "$EP_CHECK" "true|low|true|0" "pack has tests_green=true, risk.level=low, mergeable=true, claude_tokens=0"

COMMITTED_FILES="$($GIT -C "$SBX" show --name-only --format= feat/ev-pack-stub)"
assert_not_contains "$COMMITTED_FILES" "evidence-notes.md" "notes file is not in the commit"

CAPTURED_CONTENT="$(cat "$CAPTURED_PROMPT")"
assert_contains "$CAPTURED_CONTENT" "evidence-notes.md" "prompt received by fake runner contains notes path"

# Case 2: fake runner writes no notes -> mergeable=false with tests_not_green and risk_missing
OUT2="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  STUB_WRITE_NOTES=0 \
  "$SCRIPT" --runner grok --pin-reason "test fixture" --grok-bin "$STUB_GROK" --no-verify-tip --context-window off \
  --branch "feat/ev-pack-no-notes" --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/err2")"
EXIT2=$?
assert_eq "0" "$EXIT2" "dispatch-hetero with no notes exits 0"

EP_PATH2="$(node -e '
  const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
  const raw = lines.find((l) => l.trim().startsWith("{"));
  const o = raw ? JSON.parse(raw) : {};
  process.stdout.write(o.evidence_pack || "");
' "$OUT2")"
assert_file_exists "$EP_PATH2" "case 2 result JSON has evidence_pack"

EP_CHECK2="$(node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const blockers = Array.isArray(p.mergeable_reasons) ? p.mergeable_reasons.join(",") : "";
  process.stdout.write(String(p.mergeable) + "|" + blockers);
' "$EP_PATH2")"
assert_contains "$EP_CHECK2" "false|" "case 2 mergeable is false"
assert_contains "$EP_CHECK2" "tests_not_green" "case 2 has tests_not_green blocker"
assert_contains "$EP_CHECK2" "risk_missing" "case 2 has risk_missing blocker"

finalize_test
echo "PASS: $TEST_NAME"
