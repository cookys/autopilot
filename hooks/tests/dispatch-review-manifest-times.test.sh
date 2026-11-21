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

run_timed_review() { # <runner-bin> <run-id>
  (cd "$REPO" && AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 \
    "$SCRIPT" --runner codex --model gpt-5.5 --diff-file "$DIFF" \
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

finalize_test
