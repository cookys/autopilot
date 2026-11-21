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
printf 'evidence fixture\n' >> ev-fixture.txt
if [ -n "${AUTOPILOT_EVIDENCE_NOTES:-}" ]; then
  mkdir -p "$(dirname "$AUTOPILOT_EVIDENCE_NOTES")"
  cat > "$AUTOPILOT_EVIDENCE_NOTES" <<'NOTES'
## Tests
0 node scripts/evidence-pack.test.js

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

OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --runner grok --grok-bin "$STUB_GROK" --no-verify-tip --context-window off \
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

COMMIT_BODY="$($GIT -C "$SBX" log -1 --format=%B feat/ev-pack-stub)"
assert_contains "$COMMIT_BODY" "## Tests" "commit body contains ## Tests"
assert_contains "$COMMIT_BODY" "## Risk" "commit body contains ## Risk"

finalize_test
echo "PASS: $TEST_NAME"
