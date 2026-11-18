#!/usr/bin/env bash
# runner-smoke.test.sh — hermetic tests for config/runner-pins.json,
# scripts/runner-pin-check.js, scripts/runner-smoke.js, scripts/lib/runner-pins.js,
# and scripts/systemd/runner-smoke.{service,timer}.
# Uses fake runner binaries and a fake `fleet` binary first on PATH; makes zero real model calls.

. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID

export HOME="$TEST_TMP/home"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg-run"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$AUTOPILOT_SESSION_MODE_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"

# --- 0. Shipped files, codex plugin mirrors, and systemd template contracts ---
PINS_JSON="$REPO_ROOT/config/runner-pins.json"
PIN_CHECK_JS="$REPO_ROOT/scripts/runner-pin-check.js"
SMOKE_JS="$REPO_ROOT/scripts/runner-smoke.js"
PINS_LIB_JS="$REPO_ROOT/scripts/lib/runner-pins.js"
SMOKE_SERVICE="$REPO_ROOT/scripts/systemd/runner-smoke.service"
SMOKE_TIMER="$REPO_ROOT/scripts/systemd/runner-smoke.timer"

assert_file_exists "$PINS_JSON" "config/runner-pins.json exists"
assert_file_exists "$PIN_CHECK_JS" "scripts/runner-pin-check.js exists"
assert_file_exists "$SMOKE_JS" "scripts/runner-smoke.js exists"
assert_file_exists "$PINS_LIB_JS" "scripts/lib/runner-pins.js exists"
assert_file_exists "$SMOKE_SERVICE" "scripts/systemd/runner-smoke.service exists"
assert_file_exists "$SMOKE_TIMER" "scripts/systemd/runner-smoke.timer exists"

assert_file_exists "$REPO_ROOT/platforms/codex/plugin/scripts/runner-pin-check.js" "codex mirror runner-pin-check.js"
assert_file_exists "$REPO_ROOT/platforms/codex/plugin/scripts/runner-smoke.js" "codex mirror runner-smoke.js"
assert_file_exists "$REPO_ROOT/platforms/codex/plugin/scripts/lib/runner-pins.js" "codex mirror lib/runner-pins.js"
assert_file_exists "$REPO_ROOT/platforms/codex/plugin/scripts/systemd/runner-smoke.service" "codex mirror runner-smoke.service"
assert_file_exists "$REPO_ROOT/platforms/codex/plugin/scripts/systemd/runner-smoke.timer" "codex mirror runner-smoke.timer"

cmp -s "$PIN_CHECK_JS" "$REPO_ROOT/platforms/codex/plugin/scripts/runner-pin-check.js"
assert_eq "$?" "0" "runner-pin-check.js matches codex mirror"
cmp -s "$SMOKE_JS" "$REPO_ROOT/platforms/codex/plugin/scripts/runner-smoke.js"
assert_eq "$?" "0" "runner-smoke.js matches codex mirror"
cmp -s "$PINS_LIB_JS" "$REPO_ROOT/platforms/codex/plugin/scripts/lib/runner-pins.js"
assert_eq "$?" "0" "lib/runner-pins.js matches codex mirror"

SERVICE_TEXT="$(cat "$SMOKE_SERVICE")"
TIMER_TEXT="$(cat "$SMOKE_TIMER")"
assert_contains "$SERVICE_TEXT" "node @REPO_PATH@/scripts/runner-smoke.js --notify @FLEET_ADDRESS@" "service template uses @PLACEHOLDER@ tokens"
assert_contains "$TIMER_TEXT" "OnCalendar=daily" "timer schedules daily"
assert_contains "$TIMER_TEXT" "Persistent=true" "timer sets Persistent=true"
assert_contains "$TIMER_TEXT" "RandomizedDelaySec=15m" "timer sets RandomizedDelaySec=15m"

# --- Setup fake runner binaries + fake fleet first on PATH ---
FAKE_BIN="$TEST_TMP/fake-bin"
mkdir -p "$FAKE_BIN"
export CALL_LOG="$TEST_TMP/fake-runner-calls.log"
export PROMPT_LOG="$TEST_TMP/fake-prompt-calls.log"
export FLEET_LOG="$TEST_TMP/fake-fleet-calls.log"

cat > "$FAKE_BIN/fleet" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FLEET_LOG"
exit 0
EOF
chmod +x "$FAKE_BIN/fleet"

# Pass-through bwrap shim so dispatch-author.sh's agy branch runs hermetically in any container.
cat > "$FAKE_BIN/bwrap" <<'EOF'
#!/usr/bin/env bash
workdir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ro-bind|--bind) shift 3 ;;
    --dev|--proc|--tmpfs) shift 2 ;;
    --chdir) workdir="$2"; shift 2 ;;
    --unshare-pid|--die-with-parent) shift 1 ;;
    --) shift 1; break ;;
    -*) shift 1 ;;
    *) break ;;
  esac
done
if [ -n "$workdir" ]; then
  cd "$workdir" || exit 9
fi
exec "$@"
EOF
chmod +x "$FAKE_BIN/bwrap"

# Shared helper invoked by non-codex AUTHOR-framed fakes (claude, grok, cursor-agent).
export FAKE_FRAME_HELPER="$TEST_TMP/fake-frame-reply.js"
cat > "$FAKE_FRAME_HELPER" <<'EOF'
'use strict';
const fs = require('fs');
const runner = process.argv[2];
const fileArg = process.argv[3] || '';
const prompt = fileArg ? fs.readFileSync(fileArg, 'utf8') : fs.readFileSync(0, 'utf8');
const beginMatch = prompt.match(/^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$/m);
const endMatch = prompt.match(/^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$/m);
const tokMatch = prompt.match(/PINEAPPLE-[0-9a-f]{6}/);
const reply = process.env.FAKE_BAD_RUNNER === runner
  ? 'WRONG-REPLY-NO-TOKEN'
  : (tokMatch ? tokMatch[0] : 'MISSING-PROMPT-TOKEN');
if (beginMatch && endMatch) {
  process.stdout.write(`${beginMatch[0]}\n${reply}\n${endMatch[0]}\n`);
} else {
  process.stdout.write(`${reply}\n`);
}
EOF

cat > "$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
printf 'codex %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_CODEX_VERSION:-codex-cli 0.166.0}"
  exit 0
fi
printf 'codex %s\n' "$*" >> "$PROMPT_LOG"
sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    sidecar="${args[$i]:-}"
  fi
  i=$((i + 1))
done
prompt="$(cat)"
tok="$(printf '%s' "$prompt" | grep -oE 'PINEAPPLE-[0-9a-f]{6}' | head -n1)"
if [ "${FAKE_BAD_RUNNER:-}" = "codex" ]; then
  reply="WRONG-REPLY-NO-TOKEN"
else
  reply="${tok:-MISSING-PROMPT-TOKEN}"
fi
echo "OpenAI Codex v0.166.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2
if [ -n "$sidecar" ]; then
  printf '%s\n' "$reply" > "$sidecar"
fi
printf '%s\n' "$reply"
EOF
chmod +x "$FAKE_BIN/codex"

cat > "$FAKE_BIN/agy" <<'EOF'
#!/usr/bin/env bash
printf 'agy %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_AGY_VERSION:-1.5.2}"
  exit 0
fi
printf 'agy %s\n' "$*" >> "$PROMPT_LOG"
node -e '
const fs = require("fs");
const raw = fs.readFileSync(0, "utf8");
let prompt = raw;
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t) continue;
  try {
    const ev = JSON.parse(t);
    if (ev && ev.message && typeof ev.message.content === "string") prompt = ev.message.content;
  } catch {}
}
const b = prompt.match(/^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$/m);
const e = prompt.match(/^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$/m);
const tok = prompt.match(/PINEAPPLE-[0-9a-f]{6}/);
const body = process.env.FAKE_BAD_RUNNER === "agy" ? "WRONG-REPLY-NO-TOKEN" : (tok ? tok[0] : "MISSING");
const resp = (b && e) ? `${b[0]}\n${body}\n${e[0]}` : body;
process.stdout.write(JSON.stringify({ event: "result", result: { status: "SUCCESS", response: resp } }) + "\n");
'
EOF
chmod +x "$FAKE_BIN/agy"

cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
printf 'claude %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_CLAUDE_VERSION:-2.1.325 (Claude Code)}"
  exit 0
fi
printf 'claude %s\n' "$*" >> "$PROMPT_LOG"
exec node "$FAKE_FRAME_HELPER" claude
EOF
chmod +x "$FAKE_BIN/claude"

cat > "$FAKE_BIN/grok" <<'EOF'
#!/usr/bin/env bash
printf 'grok %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_GROK_VERSION:-grok 1.0.70 (f50904eaee6c) [stable]}"
  exit 0
fi
case "$*" in
  *__autopilot_probe__*)
    echo '{"type":"error","message":"--effort/--reasoning-effort: unknown effort level '\''__autopilot_probe__'\''; use one of: xhigh, high, medium, low"}'
    exit 1
    ;;
esac
printf 'grok %s\n' "$*" >> "$PROMPT_LOG"
pfile=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1))
    pfile="${args[$i]:-}"
  fi
  i=$((i + 1))
done
exec node "$FAKE_FRAME_HELPER" grok "$pfile"
EOF
chmod +x "$FAKE_BIN/grok"

cat > "$FAKE_BIN/cursor-agent" <<'EOF'
#!/usr/bin/env bash
printf 'cursor-agent %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_CURSOR_VERSION:-2026.10.19-6bbf2c4}"
  exit 0
fi
printf 'cursor-agent %s\n' "$*" >> "$PROMPT_LOG"
exec node "$FAKE_FRAME_HELPER" cursor
EOF
chmod +x "$FAKE_BIN/cursor-agent"

cat > "$FAKE_BIN/opencode" <<'EOF'
#!/usr/bin/env bash
printf 'opencode %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "${FAKE_OPENCODE_VERSION:-1.19.5}"
  exit 0
fi
printf 'opencode %s\n' "$*" >> "$PROMPT_LOG"
node -e '
const fs = require("fs");
const prompt = fs.readFileSync(0, "utf8");
const tok = prompt.match(/PINEAPPLE-[0-9a-f]{6}/);
const reply = process.env.FAKE_BAD_RUNNER === "opencode" ? "WRONG-REPLY-NO-TOKEN" : (tok ? tok[0] : "MISSING");
process.stdout.write(JSON.stringify({ type: "text", part: { type: "text", text: reply } }) + "\n");
'
EOF
chmod +x "$FAKE_BIN/opencode"

export PATH="$FAKE_BIN:$PATH"

# Configure fake $HOME autoupdate files (never touching real $HOME or forbidden dirs)
mkdir -p "$HOME/.codex" "$HOME/.config/opencode"
printf 'check_for_update_on_startup = false\n' > "$HOME/.codex/config.toml"
printf '{"autoupdate": false}\n' > "$HOME/.config/opencode/opencode.json"

# --- 1. runner-pin-check.js: matching fake versions -> exit 0, drift false ---
PIN_JSONL_OUT="$(DISABLE_AUTOUPDATER=1 node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PIN_JSONL_RC=$?
assert_eq "$PIN_JSONL_RC" "0" "pin-check matching versions exits 0 (JSONL)"
PIN_JSONL_CHECK="$(printf '%s\n' "$PIN_JSONL_OUT" | node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (lines.length !== 8) process.exit(10);
if (lines.some((r) => r.drift !== false)) process.exit(11);
const byRunner = Object.fromEntries(lines.map((r) => [r.runner, r]));
if (byRunner.codex.autoupdate_state !== "disabled") process.exit(12);
if (byRunner.claude.autoupdate_state !== "disabled") process.exit(13);
if (byRunner.opencode.autoupdate_state !== "disabled") process.exit(14);
if (byRunner.agy.autoupdate_state !== "none-known") process.exit(15);
if (byRunner.kimi.actual !== null || byRunner.qwen.actual !== null) process.exit(16);
process.stdout.write("ok");
')"
assert_eq "$PIN_JSONL_CHECK" "ok" "pin-check JSONL emits 8 rows with drift:false and verified autoupdate_state"

PIN_DOC_OUT="$(DISABLE_AUTOUPDATER=1 node "$PIN_CHECK_JS" --json < /dev/null 2>&1)"; PIN_DOC_RC=$?
assert_eq "$PIN_DOC_RC" "0" "pin-check --json matching versions exits 0"
PIN_DOC_CHECK="$(printf '%s' "$PIN_DOC_OUT" | node -e '
const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (doc.schema !== "autopilot.runner-pins/1") process.exit(1);
if (doc.ok !== true || doc.drift !== false) process.exit(2);
if (!Array.isArray(doc.runners) || doc.runners.length !== 8) process.exit(3);
process.stdout.write("ok");
')"
assert_eq "$PIN_DOC_CHECK" "ok" "pin-check --json returns valid autopilot.runner-pins/1 document"

# --- 2. runner-pin-check.js: one fake prints a different version -> exit 1, drift true ---
PIN_DRIFT_OUT="$(FAKE_GROK_VERSION="grok 1.9.99 (unvetted) [stable]" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PIN_DRIFT_RC=$?
assert_eq "$PIN_DRIFT_RC" "1" "pin-check drifted fake version exits 1"
PIN_DRIFT_CHECK="$(printf '%s\n' "$PIN_DRIFT_OUT" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const drifted = rows.filter((r) => r.drift === true);
if (drifted.length !== 1 || drifted[0].runner !== "grok") process.exit(1);
if (drifted[0].actual !== "grok 1.9.99 (unvetted) [stable]") process.exit(2);
process.stdout.write("ok");
')"
assert_eq "$PIN_DRIFT_CHECK" "ok" "pin-check marks only drifted runner drift:true"

# --- 3. runner-smoke.js --dry-run calls no fake runner, no fleet fake, writes no receipt ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG" "$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json"
DRY_OUT="$(node "$SMOKE_JS" --dry-run --notify test/canary/ops --date 2026-11-19 < /dev/null 2>&1)"; DRY_RC=$?
assert_eq "$DRY_RC" "0" "runner-smoke --dry-run exits 0"
assert_file_absent "$CALL_LOG" "--dry-run invokes zero fake runner binaries"
assert_file_absent "$FLEET_LOG" "--dry-run invokes zero fleet calls"
assert_file_absent "$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json" "--dry-run writes no receipt"
DRY_PLAN_CHECK="$(printf '%s' "$DRY_OUT" | node -e '
const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (doc.schema !== "autopilot.runner-smoke/1" || doc.dry_run !== true) process.exit(1);
const codex = doc.runners.find((r) => r.runner === "codex");
if (!codex || codex.effort !== "high") process.exit(2);
if (doc.runners.some((r) => r.effort === "xhigh")) process.exit(3);
if (doc.runners.length !== 6) process.exit(4);
process.stdout.write("ok");
')"
assert_eq "$DRY_PLAN_CHECK" "ok" "--dry-run plan uses schema autopilot.runner-smoke/1 and codex effort high"

# --- 4. runner-smoke.js: all fakes echo PINEAPPLE token -> exit 0, receipt written, fleet NOT called ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG"
PASS_RECEIPT="$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json"
SMOKE_PASS_OUT="$(node "$SMOKE_JS" --notify test/canary/ops --date 2026-11-19 < /dev/null 2>&1)"; SMOKE_PASS_RC=$?
assert_eq "$SMOKE_PASS_RC" "0" "runner-smoke all pass exits 0"
assert_file_exists "$PASS_RECEIPT" "runner-smoke writes receipt under XDG_RUNTIME_DIR/autopilot/runner-smoke/<date>.json"
assert_file_absent "$FLEET_LOG" "runner-smoke all pass does NOT call fleet"
PASS_RECEIPT_CHECK="$(node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (doc.schema !== "autopilot.runner-smoke/1") process.exit(1);
if (doc.ok !== true || doc.pass_count !== 6 || doc.fail_count !== 0) process.exit(2);
for (const r of doc.runners) {
  if (r.pass !== true || r.result !== "pass") process.exit(3);
  if (r.rail_exit !== 0 || r.rail_classification !== "authored") process.exit(4);
  if (typeof r.version !== "string" || !r.version) process.exit(5);
  if (typeof r.wall_seconds !== "number" || r.wall_seconds < 0) process.exit(6);
}
process.stdout.write("ok");
' "$PASS_RECEIPT")"
assert_eq "$PASS_RECEIPT_CHECK" "ok" "all-pass receipt records schema, version, rail_exit, rail_classification, pass, wall_seconds"
assert_contains "$(cat "$PROMPT_LOG")" 'model_reasoning_effort="high"' "codex smoke uses reasoning effort high"
assert_not_contains "$(cat "$PROMPT_LOG")" 'model_reasoning_effort="xhigh"' "codex smoke never uses reasoning effort xhigh"

# --- 5. runner-smoke.js: one fake omits token -> exit 1, fleet called once naming that runner ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG"
FAIL_RECEIPT="$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-20.json"
SMOKE_FAIL_OUT="$(FAKE_BAD_RUNNER=grok node "$SMOKE_JS" --notify test/canary/ops --date 2026-11-20 < /dev/null 2>&1)"; SMOKE_FAIL_RC=$?
assert_eq "$SMOKE_FAIL_RC" "1" "runner-smoke exits 1 when a runner omits the token"
assert_file_exists "$FAIL_RECEIPT" "runner-smoke writes receipt on failure"
assert_file_exists "$FLEET_LOG" "runner-smoke calls fleet on failure"
FLEET_CALL_COUNT="$(wc -l < "$FLEET_LOG" | tr -d ' ')"
assert_eq "$FLEET_CALL_COUNT" "1" "fleet called exactly once on failure"
FLEET_LINE="$(cat "$FLEET_LOG")"
assert_contains "$FLEET_LINE" "send test/canary/ops " "fleet send targets configured address"
assert_contains "$FLEET_LINE" "grok" "fleet notification names failed runner grok"
assert_not_contains "$FLEET_LINE" "codex" "fleet notification omits passing runner codex"
assert_not_contains "$FLEET_LINE" "cursor" "fleet notification omits passing runner cursor"
FAIL_RECEIPT_CHECK="$(node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (doc.ok !== false || doc.pass_count !== 5 || doc.fail_count !== 1) process.exit(1);
const grok = doc.runners.find((r) => r.runner === "grok");
if (!grok || grok.pass !== false || grok.result !== "fail") process.exit(2);
process.stdout.write("ok");
' "$FAIL_RECEIPT")"
assert_eq "$FAIL_RECEIPT_CHECK" "ok" "failure receipt records grok fail and 5 passes"

# --- 6. runner-smoke.js: --only <runner> + ~/.autopilot/runner-smoke fallback when XDG_RUNTIME_DIR unset ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG"
FALLBACK_RECEIPT="$HOME/.autopilot/runner-smoke/2026-11-21.json"
ONLY_OUT="$(env -u XDG_RUNTIME_DIR node "$SMOKE_JS" --only cursor --date 2026-11-21 < /dev/null 2>&1)"; ONLY_RC=$?
assert_eq "$ONLY_RC" "0" "runner-smoke --only cursor exits 0"
assert_file_exists "$FALLBACK_RECEIPT" "runner-smoke falls back to ~/.autopilot/runner-smoke/<date>.json"
ONLY_PROMPT_COUNT="$(wc -l < "$PROMPT_LOG" | tr -d ' ')"
assert_eq "$ONLY_PROMPT_COUNT" "1" "--only cursor dispatches exactly one runner prompt"
assert_contains "$(cat "$PROMPT_LOG")" "cursor-agent" "--only cursor invokes cursor-agent only"

# --- 7. Negative controls (sed_mutant): prove gates go red when checks are weakened ---
MUT_DIR="$TEST_TMP/mutants"
mkdir -p "$MUT_DIR/scripts/lib"
cp "$PIN_CHECK_JS" "$MUT_DIR/scripts/runner-pin-check.js"
cp "$REPO_ROOT/scripts/lib/runner-binary.js" "$MUT_DIR/scripts/lib/runner-binary.js"
cp "$REPO_ROOT/scripts/lib/kimi-local-stop.js" "$MUT_DIR/scripts/lib/kimi-local-stop.js"
sed_mutant "$PINS_LIB_JS" "$MUT_DIR/scripts/lib/runner-pins.js" 's/probe\.actual !== pinned/false/'
MUT_PIN_OUT="$(FAKE_GROK_VERSION="grok 9.9.9" node "$MUT_DIR/scripts/runner-pin-check.js" --pins "$PINS_JSON" < /dev/null 2>&1)"; MUT_PIN_RC=$?
assert_eq "$MUT_PIN_RC" "0" "negative control: mutating runner-pins.js drift predicate lets drifted version slip through"

cp "$PINS_LIB_JS" "$MUT_DIR/scripts/lib/runner-pins.js"
cp "$REPO_ROOT/scripts/lib/opencode-containment.js" "$MUT_DIR/scripts/lib/opencode-containment.js"
for f in "$REPO_ROOT"/scripts/*; do
  b="$(basename "$f")"
  [ "$b" = "runner-smoke.js" ] && continue
  [ -e "$MUT_DIR/scripts/$b" ] || ln -s "$f" "$MUT_DIR/scripts/$b"
done
for f in "$REPO_ROOT"/scripts/lib/*; do
  b="$(basename "$f")"
  [ -e "$MUT_DIR/scripts/lib/$b" ] || ln -s "$f" "$MUT_DIR/scripts/lib/$b"
done
sed_mutant "$SMOKE_JS" "$MUT_DIR/scripts/runner-smoke.js" 's/answer\.includes(token)/true/'
MUT_SMOKE_OUT="$(FAKE_BAD_RUNNER=cursor node "$MUT_DIR/scripts/runner-smoke.js" --pins "$PINS_JSON" --only cursor --receipt-dir "$TEST_TMP/mut-receipts" --date 2026-11-22 < /dev/null 2>&1)"; MUT_SMOKE_RC=$?
assert_eq "$MUT_SMOKE_RC" "0" "negative control: mutating runner-smoke.js token check lets wrong answer pass"

finalize_test
