#!/usr/bin/env bash
# Pin reviewer manifest start timestamps across exit-time rewrites.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"

if [ -n "${DISPATCH_REVIEW_SCRIPT_OVERRIDE:-}" ]; then
  SCRIPT="$DISPATCH_REVIEW_SCRIPT_OVERRIDE"
fi

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t
git -C "$REPO" config user.name t
printf 'x\n' > "$REPO/a.txt"
git -C "$REPO" add -A
git -C "$REPO" commit -qm fixture

export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
chmod 700 "$AUTOPILOT_DISPATCH_RUNS_DIR"

TIMED_VERDICT="$TEST_TMP/timed-verdict"
cat > "$TIMED_VERDICT" <<'EOF'
#!/usr/bin/env bash
sleep 2
exec "$STUB_VERDICT" "$@"
EOF
chmod +x "$TIMED_VERDICT"

TIMED_ABORT="$TEST_TMP/timed-abort"
cat > "$TIMED_ABORT" <<'EOF'
#!/usr/bin/env bash
sleep 2
exit 23
EOF
chmod +x "$TIMED_ABORT"

run_timed_review() { # <runner-bin> <run-id> [script]
  (cd "$REPO" && AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    "${3:-$SCRIPT}" --runner codex --model gpt-5.5 --diff-file "$DIFF" \
    --bin "$1" --run-id "$2" >/dev/null 2>&1)
}

assert_manifest_times() { # <run-id>
  local manifest="$AUTOPILOT_DISPATCH_RUNS_DIR/$1.manifest.json"
  node - "$manifest" <<'NODE'
const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const start = Date.parse(m.started_at);
const end = Date.parse(m.ended_at);
if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('timestamps must parse');
if (start >= end) throw new Error(`started_at ${m.started_at} must precede ended_at ${m.ended_at}`);
if (Math.floor(start / 1000) !== m.started_epoch) throw new Error('started_at must match started_epoch');
if (m.ended_epoch - m.started_epoch < 2) throw new Error('run must span at least two seconds');
NODE
  assert_eq "0" "$?" "$1 manifest timestamps preserve the start and exceed two seconds"
}

run_timed_review "$TIMED_VERDICT" rv-timed-success
assert_manifest_times rv-timed-success

run_timed_review "$TIMED_ABORT" rv-timed-abort
assert_manifest_times rv-timed-abort

# Freeze the dispatch's clock so a zero-delay runner deterministically ends in
# the same whole second in which it started.
FIXED_BIN="$TEST_TMP/fixed-bin"
mkdir -p "$FIXED_BIN"
cat > "$FIXED_BIN/date" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  '-u +%Y-%m-%dT%H:%M:%SZ') printf '2026-11-21T00:00:00Z\n' ;;
  '-u +%s %Y-%m-%dT%H:%M:%SZ') printf '1795228800 2026-11-21T00:00:00Z\n' ;;
  '+%s') printf '1795228800\n' ;;
  *) exec /usr/bin/date "$@" ;;
esac
EOF
chmod +x "$FIXED_BIN/date"
FAST_VERDICT="$TEST_TMP/fast-verdict"
cat > "$FAST_VERDICT" <<'EOF'
#!/usr/bin/env bash
exec "$STUB_VERDICT" "$@"
EOF
chmod +x "$FAST_VERDICT"
run_zero_delay_review() { # <script> <run-id>
  (cd "$REPO" && PATH="$FIXED_BIN:$PATH" AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    "$1" --runner codex --model gpt-5.5 --diff-file "$DIFF" \
    --bin "$FAST_VERDICT" --run-id "$2" >/dev/null 2>&1)
}
run_zero_delay_review "${ZERO_DELAY_REVIEW_SCRIPT:-$SCRIPT}" rv-zero-delay
node - "$AUTOPILOT_DISPATCH_RUNS_DIR/rv-zero-delay.manifest.json" <<'NODE'
const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!(Date.parse(m.ended_at) > Date.parse(m.started_at))) {
  throw new Error(`started_at ${m.started_at} must precede ended_at ${m.ended_at}`);
}
NODE
assert_eq "0" "$?" "zero-delay reviewer manifest ends after it starts"

finalize_test
