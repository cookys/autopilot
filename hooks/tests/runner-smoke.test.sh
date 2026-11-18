#!/usr/bin/env bash
# runner-smoke.test.sh — hermetic tests for config/runner-pins.json (v2),
# host-local runner-vetted.json overlay, scripts/runner-pin-check.js,
# scripts/runner-smoke.js, scripts/lib/runner-pins.js, and
# scripts/systemd/runner-smoke.{service,timer}.
# Uses fake runner binaries and a fake `fleet` binary first on PATH; makes zero real model calls
# and never touches the real ~/.autopilot/runner-vetted.json.

. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID

export HOME="$TEST_TMP/home"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg-run"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/runner-vetted.json"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$AUTOPILOT_SESSION_MODE_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"

# --- 0. Shipped files, codex plugin mirrors, v2 schema, and systemd template contracts ---
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

SHIPPED_PINS_CHECK="$(node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (doc.schema !== "autopilot.runner-pins/2") process.exit(1);
for (const [name, entry] of Object.entries(doc.runners)) {
  if (!Array.isArray(entry.vetted)) process.exit(2);
  if ("installed" in entry || "version" in entry) process.exit(3);
  if (!entry.bin || !Array.isArray(entry.version_cmd) || !entry.autoupdate || !entry.source) process.exit(4);
}
process.stdout.write("ok");
' "$PINS_JSON")"
assert_eq "$SHIPPED_PINS_CHECK" "ok" "shipped config/runner-pins.json uses schema autopilot.runner-pins/2 with vetted arrays and no v1 installed/version fields"

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
  printf '%s\n' "${FAKE_AGY_VERSION:-1.5.11}"
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
  printf '%s\n' "${FAKE_CLAUDE_VERSION:-2.1.327 (Claude Code)}"
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
  printf '%s\n' "${FAKE_GROK_VERSION:-grok 1.0.77 (50ca579fa996) [stable]}"
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
  printf '%s\n' "${FAKE_CURSOR_VERSION:-2026.11.17-f532c45}"
  exit 0
fi
printf 'cursor-agent %s\n' "$*" >> "$PROMPT_LOG"
exec node "$FAKE_FRAME_HELPER" cursor
EOF
chmod +x "$FAKE_BIN/cursor-agent"

FAKE_OC_BIN="$TEST_TMP/fake-oc-bin"
mkdir -p "$FAKE_OC_BIN"
cat > "$FAKE_OC_BIN/opencode" <<'EOF'
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
chmod +x "$FAKE_OC_BIN/opencode"

# Scrub any host-installed absent runners (kimi, qwen, opencode) from inherited PATH dirs.
export AUTOPILOT_RUNNER_HOME_FALLBACK=off
CLEAN_PATH="$(node -e '
const fs = require("fs");
const path = require("path");
const absent = new Set(["kimi", "qwen", "opencode"]);
const tmpRoot = process.argv[1];
const out = [process.argv[2]];
let idx = 0;
for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
  const hasAbsent = [...absent].some((b) => {
    try { fs.accessSync(path.join(dir, b), fs.constants.X_OK); return true; } catch { return false; }
  });
  if (!hasAbsent) {
    out.push(dir);
    continue;
  }
  const shadow = path.join(tmpRoot, `path-shadow-${idx++}`);
  fs.mkdirSync(shadow, { recursive: true });
  for (const ent of fs.readdirSync(dir)) {
    if (absent.has(ent)) continue;
    try { fs.symlinkSync(path.join(dir, ent), path.join(shadow, ent)); } catch {}
  }
  out.push(shadow);
}
process.stdout.write(out.join(path.delimiter));
' "$TEST_TMP" "$FAKE_BIN")"
export PATH="$CLEAN_PATH"

# Configure fake $HOME autoupdate files (never touching real $HOME or forbidden dirs)
mkdir -p "$HOME/.codex" "$HOME/.config/opencode"
printf 'check_for_update_on_startup = false\n' > "$HOME/.codex/config.toml"
printf '{"autoupdate": false}\n' > "$HOME/.config/opencode/opencode.json"

FIXTURE_OC_PINS="$TEST_TMP/fixture-oc-pins.json"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
doc.runners.codex.autoupdate = {
  kind: "config",
  file: ".codex/config.toml",
  key: "check_for_update_on_startup",
  value: false,
  source: "fixture-toml-autoupdate-test",
};
doc.runners.opencode = {
  ...doc.runners.opencode,
  vetted: ["1.19.5"],
  autoupdate: {
    kind: "config",
    file: ".config/opencode/opencode.json",
    key: "autoupdate",
    value: false,
    env: "OPENCODE_DISABLE_AUTOUPDATE",
    env_value: "true",
    source: "fixture-json-autoupdate-test",
  },
};
fs.writeFileSync(process.argv[2], JSON.stringify(doc, null, 2) + "\n");
' "$PINS_JSON" "$FIXTURE_OC_PINS"

# --- 0b. Legacy v1 table is refused with a clear migration message ---
V1_PINS="$TEST_TMP/legacy-v1-pins.json"
cat > "$V1_PINS" <<'EOF'
{
  "schema": "autopilot.runner-pins/1",
  "runners": {
    "agy": {
      "bin": "agy",
      "installed": true,
      "version": "1.5.11",
      "version_cmd": ["agy", "--version"],
      "autoupdate": "none-known",
      "vetted_at": "2026-11-19",
      "vetted_by": "in-service 2026-11-19"
    }
  }
}
EOF
V1_CHECK_OUT="$(node "$PIN_CHECK_JS" --pins "$V1_PINS" < /dev/null 2>&1)"; V1_CHECK_RC=$?
assert_eq "$V1_CHECK_RC" "2" "pin-check refuses legacy v1 table with exit 2"
assert_contains "$V1_CHECK_OUT" "autopilot.runner-pins/1" "v1 refusal names autopilot.runner-pins/1"
assert_contains "$V1_CHECK_OUT" "autopilot.runner-pins/2" "v1 refusal names migration target autopilot.runner-pins/2"
assert_contains "$V1_CHECK_OUT" "no longer supported" "v1 refusal states v1 is no longer supported"

V1_SMOKE_OUT="$(node "$SMOKE_JS" --pins "$V1_PINS" --dry-run < /dev/null 2>&1)"; V1_SMOKE_RC=$?
assert_eq "$V1_SMOKE_RC" "2" "runner-smoke refuses legacy v1 table with exit 2"
assert_contains "$V1_SMOKE_OUT" "autopilot.runner-pins/2" "runner-smoke v1 refusal names autopilot.runner-pins/2"

# --- 0c. Absent runners (absent from PATH + version_cmd fails to spawn) -> status absent, drift false, exit 0 ---
NODE_EXE="$(command -v node)"
ABSENT_PATH_DIR="$TEST_TMP/absent-only-bin"
mkdir -p "$ABSENT_PATH_DIR"
printf '#!/nonexistent/interpreter-for-spawn-failure\n' > "$ABSENT_PATH_DIR/codex"
chmod +x "$ABSENT_PATH_DIR/codex"
ALL_ABSENT_OUT="$(PATH="$ABSENT_PATH_DIR" "$NODE_EXE" "$PIN_CHECK_JS" < /dev/null 2>&1)"; ALL_ABSENT_RC=$?
assert_eq "$ALL_ABSENT_RC" "0" "pin-check with all runners absent or failing to spawn exits 0"
ALL_ABSENT_CHECK="$(printf '%s\n' "$ALL_ABSENT_OUT" | "$NODE_EXE" -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (rows.length !== 8) process.exit(1);
for (const r of rows) {
  if (r.status !== "absent" || r.drift !== false || r.vetted_source !== null || r.actual !== null) process.exit(2);
}
process.stdout.write("ok");
')"
assert_eq "$ALL_ABSENT_CHECK" "ok" "absent from PATH and spawn-failed version_cmd both report status=absent, drift=false, vetted_source=null"

# --- 1. runner-pin-check.js: installed fakes in table.vetted -> vetted/table; absent -> absent/null ---
rm -f "$AUTOPILOT_RUNNER_VETTED_FILE"
PIN_JSONL_OUT="$(DISABLE_AUTOUPDATER=1 node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PIN_JSONL_RC=$?
assert_eq "$PIN_JSONL_RC" "0" "pin-check matching table.vetted versions exits 0 (JSONL)"
PIN_JSONL_CHECK="$(printf '%s\n' "$PIN_JSONL_OUT" | node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (lines.length !== 8) process.exit(10);
if (lines.some((r) => r.drift !== false)) process.exit(11);
const byRunner = Object.fromEntries(lines.map((r) => [r.runner, r]));
for (const inst of ["codex", "agy", "claude", "grok", "cursor"]) {
  if (byRunner[inst].status !== "vetted" || byRunner[inst].vetted_source !== "table") process.exit(17);
}
for (const abs of ["kimi", "qwen", "opencode"]) {
  if (byRunner[abs].status !== "absent" || byRunner[abs].vetted_source !== null || byRunner[abs].actual !== null) process.exit(16);
}
if (byRunner.codex.autoupdate_state !== "none-known") process.exit(12);
if (byRunner.claude.autoupdate_state !== "disabled") process.exit(13);
if (byRunner.opencode.autoupdate_state !== "none-known") process.exit(14);
if (byRunner.agy.autoupdate_state !== "none-known") process.exit(15);
process.stdout.write("ok");
')"
assert_eq "$PIN_JSONL_CHECK" "ok" "pin-check JSONL emits 8 rows with vetted/table for installed and absent/null for missing"

PIN_DOC_OUT="$(DISABLE_AUTOUPDATER=1 node "$PIN_CHECK_JS" --json < /dev/null 2>&1)"; PIN_DOC_RC=$?
assert_eq "$PIN_DOC_RC" "0" "pin-check --json matching versions exits 0"
PIN_DOC_CHECK="$(printf '%s' "$PIN_DOC_OUT" | node -e '
const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (doc.schema !== "autopilot.runner-pins/2") process.exit(1);
if (doc.ok !== true || doc.drift !== false) process.exit(2);
if (!Array.isArray(doc.runners) || doc.runners.length !== 8) process.exit(3);
process.stdout.write("ok");
')"
assert_eq "$PIN_DOC_CHECK" "ok" "pin-check --json returns valid autopilot.runner-pins/2 document"

# --- 1a. Version only in host overlay -> vetted/overlay; version in both -> vetted/table ---
SEEDED_OVERLAY="$TEST_TMP/seeded-overlay.json"
cat > "$SEEDED_OVERLAY" <<'EOF'
{
  "schema": "autopilot.runner-vetted/1",
  "runners": {
    "grok": [
      {
        "version": "grok 1.0.89 (fleet-seat) [stable]",
        "receipt_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "vetted_at": "2026-11-19T01:00:00Z"
      }
    ],
    "codex": [
      {
        "version": "codex-cli 0.166.0",
        "receipt_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "vetted_at": "2026-11-19T01:00:00Z"
      }
    ]
  }
}
EOF
PIN_OVERLAY_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$SEEDED_OVERLAY" FAKE_GROK_VERSION="grok 1.0.89 (fleet-seat) [stable]" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PIN_OVERLAY_RC=$?
assert_eq "$PIN_OVERLAY_RC" "0" "pin-check with overlay-vetted version exits 0"
PIN_OVERLAY_CHECK="$(printf '%s\n' "$PIN_OVERLAY_OUT" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byRunner = Object.fromEntries(rows.map((r) => [r.runner, r]));
if (byRunner.grok.status !== "vetted" || byRunner.grok.vetted_source !== "overlay" || byRunner.grok.drift !== false) process.exit(1);
if (byRunner.codex.status !== "vetted" || byRunner.codex.vetted_source !== "table" || byRunner.codex.drift !== false) process.exit(2);
process.stdout.write("ok");
')"
assert_eq "$PIN_OVERLAY_CHECK" "ok" "version only in overlay reports vetted/overlay while version in table reports vetted/table"

# --- 1b. config autoupdate inspection + unvetted empty-list runner + opencode containment smoke ---
PIN_CFG_OUT="$(DISABLE_AUTOUPDATER=1 PATH="$FAKE_OC_BIN:$PATH" node "$PIN_CHECK_JS" --pins "$FIXTURE_OC_PINS" < /dev/null 2>&1)"; PIN_CFG_RC=$?
assert_eq "$PIN_CFG_RC" "0" "pin-check fixture config autoupdate exits 0"
PIN_CFG_CHECK="$(printf '%s\n' "$PIN_CFG_OUT" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byRunner = Object.fromEntries(rows.map((r) => [r.runner, r]));
if (byRunner.codex.autoupdate_state !== "disabled") process.exit(1);
if (byRunner.claude.autoupdate_state !== "disabled") process.exit(2);
if (byRunner.opencode.autoupdate_state !== "disabled") process.exit(3);
if (byRunner.opencode.status !== "vetted" || byRunner.opencode.vetted_source !== "table") process.exit(4);
process.stdout.write("ok");
')"
assert_eq "$PIN_CFG_CHECK" "ok" "pin-check inspects TOML and JSON config autoupdate files"

UNPINNED_OUT="$(PATH="$FAKE_OC_BIN:$PATH" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; UNPINNED_RC=$?
assert_eq "$UNPINNED_RC" "1" "pin-check flags installed runner with empty vetted set and no overlay entry as unvetted"

OC_SMOKE_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/oc-vetted.json" PATH="$FAKE_OC_BIN:$PATH" node "$SMOKE_JS" --pins "$FIXTURE_OC_PINS" --only opencode --date 2026-11-18 < /dev/null 2>&1)"; OC_SMOKE_RC=$?
assert_eq "$OC_SMOKE_RC" "0" "runner-smoke exercises opencode-containment wrapper via fixture pins"

# --- 2. runner-pin-check.js: installed fake at unknown version -> unvetted, drift true, exit 1 ---
PIN_DRIFT_OUT="$(FAKE_GROK_VERSION="grok 1.9.99 (unvetted) [stable]" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PIN_DRIFT_RC=$?
assert_eq "$PIN_DRIFT_RC" "1" "pin-check unknown fake version exits 1"
PIN_DRIFT_CHECK="$(printf '%s\n' "$PIN_DRIFT_OUT" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const drifted = rows.filter((r) => r.drift === true);
if (drifted.length !== 1 || drifted[0].runner !== "grok") process.exit(1);
if (drifted[0].status !== "unvetted" || drifted[0].vetted_source !== null) process.exit(2);
if (drifted[0].actual !== "grok 1.9.99 (unvetted) [stable]") process.exit(3);
process.stdout.write("ok");
')"
assert_eq "$PIN_DRIFT_CHECK" "ok" "pin-check marks unknown version status=unvetted, drift=true, vetted_source=null"

# --- 3. runner-smoke.js --dry-run calls no fake runner, no fleet fake, writes no receipt and no overlay ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG" "$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json" "$AUTOPILOT_RUNNER_VETTED_FILE"
DRY_OUT="$(node "$SMOKE_JS" --dry-run --notify test/canary/ops --date 2026-11-19 < /dev/null 2>&1)"; DRY_RC=$?
assert_eq "$DRY_RC" "0" "runner-smoke --dry-run exits 0"
assert_file_absent "$CALL_LOG" "--dry-run invokes zero fake runner binaries"
assert_file_absent "$FLEET_LOG" "--dry-run invokes zero fleet calls"
assert_file_absent "$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json" "--dry-run writes no receipt"
assert_file_absent "$AUTOPILOT_RUNNER_VETTED_FILE" "--dry-run writes no runner-vetted overlay"
DRY_PLAN_CHECK="$(printf '%s' "$DRY_OUT" | node -e '
const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (doc.schema !== "autopilot.runner-smoke/1" || doc.dry_run !== true) process.exit(1);
const codex = doc.runners.find((r) => r.runner === "codex");
if (!codex || codex.effort !== "high") process.exit(2);
if (codex.model !== "gpt-6.2-sol") process.exit(5);
const agy = doc.runners.find((r) => r.runner === "agy");
if (!agy || agy.model !== "gemini-4-hydrogen-high") process.exit(6);
if (doc.runners.some((r) => /fable|astra|carbon|argon/i.test(r.model))) process.exit(7);
if (doc.runners.some((r) => r.effort === "xhigh")) process.exit(3);
if (doc.runners.length !== 5) process.exit(4);
process.stdout.write("ok");
')"
assert_eq "$DRY_PLAN_CHECK" "ok" "--dry-run plan uses schema autopilot.runner-smoke/1, cheap models (gpt-6.2-sol, gemini-4-hydrogen-high), and codex effort high"

# --- 3b. runner-smoke.js default receipt filename uses host local date, not UTC date ---
FAKE_CLOCK_JS="$TEST_TMP/fake-clock.js"
cat > "$FAKE_CLOCK_JS" <<'EOF'
'use strict';
const RealDate = Date;
const FIXED_MS = RealDate.parse('2026-11-18T19:45:00Z');
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_MS);
    else super(...args);
  }
  static now() { return FIXED_MS; }
}
global.Date = MockDate;
EOF
LOCAL_DATE_OUT="$(NODE_OPTIONS="--require $FAKE_CLOCK_JS" TZ=Asia/Taipei node "$SMOKE_JS" --dry-run < /dev/null 2>&1)"; LOCAL_DATE_RC=$?
assert_eq "$LOCAL_DATE_RC" "0" "runner-smoke --dry-run with TZ=Asia/Taipei exits 0"
LOCAL_DATE_CHECK="$(printf '%s' "$LOCAL_DATE_OUT" | node -e '
const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (doc.date !== "2026-11-19") process.exit(1);
if (!doc.receipt_path.endsWith("/2026-11-19.json")) process.exit(2);
process.stdout.write("ok");
')"
assert_eq "$LOCAL_DATE_CHECK" "ok" "runner-smoke default receipt filename uses local date (2026-11-19 in +08:00 vs 2026-11-18Z)"

# --- 3c. runner-smoke.js refuses expensive smoke models (fable|astra|carbon|argon) with exit 2 ---
EXPENSIVE_PINS="$TEST_TMP/expensive-smoke-pins.json"
node -e '
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
doc.runners.agy.smoke_model = "gemini-4-carbon-low";
fs.writeFileSync(process.argv[2], JSON.stringify(doc, null, 2) + "\n");
' "$PINS_JSON" "$EXPENSIVE_PINS"

rm -f "$CALL_LOG"
rm -f "$PROMPT_LOG"
rm -f "$FLEET_LOG"
EXPENSIVE_DRY_OUT="$(node "$SMOKE_JS" --pins "$EXPENSIVE_PINS" --only agy --dry-run < /dev/null 2>&1)"; EXPENSIVE_DRY_RC=$?
assert_eq "$EXPENSIVE_DRY_RC" "2" "runner-smoke --dry-run refuses smoke_model gemini-4-carbon-low with exit 2"
assert_contains "$EXPENSIVE_DRY_OUT" "gemini-4-carbon-low" "dry-run refusal names rejected smoke_model"
assert_file_absent "$CALL_LOG" "refused expensive smoke_model invokes zero fake runner binaries (--dry-run)"

rm -f "$CALL_LOG"
rm -f "$PROMPT_LOG"
rm -f "$FLEET_LOG"
EXPENSIVE_RUN_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/exp-vetted.json" node "$SMOKE_JS" --pins "$EXPENSIVE_PINS" --only agy --receipt-dir "$TEST_TMP/exp-receipts" --date 2026-11-24 < /dev/null 2>&1)"; EXPENSIVE_RUN_RC=$?
assert_eq "$EXPENSIVE_RUN_RC" "2" "runner-smoke run refuses smoke_model gemini-4-carbon-low with exit 2"
assert_contains "$EXPENSIVE_RUN_OUT" "gemini-4-carbon-low" "run refusal names rejected smoke_model"
assert_file_absent "$CALL_LOG" "refused expensive smoke_model never calls runner binary"
assert_file_absent "$PROMPT_LOG" "refused expensive smoke_model never dispatches runner prompt"
assert_file_absent "$TEST_TMP/exp-receipts/2026-11-24.json" "refused expensive smoke_model writes no receipt"
assert_file_absent "$TEST_TMP/exp-vetted.json" "refused expensive smoke_model writes no vetted overlay"

# --- 4. runner-smoke.js PASS writes overlay entry with receipt sha256; running twice does not duplicate ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG" "$AUTOPILOT_RUNNER_VETTED_FILE"
PRE_SMOKE_PIN_OUT="$(FAKE_CODEX_VERSION="codex-cli 0.170.0" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; PRE_SMOKE_PIN_RC=$?
assert_eq "$PRE_SMOKE_PIN_RC" "1" "codex 0.170.0 is unvetted before smoke PASS"

PASS_RECEIPT="$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-19.json"
SMOKE_PASS_OUT="$(FAKE_CODEX_VERSION="codex-cli 0.170.0" node "$SMOKE_JS" --notify test/canary/ops --date 2026-11-19 < /dev/null 2>&1)"; SMOKE_PASS_RC=$?
assert_eq "$SMOKE_PASS_RC" "0" "runner-smoke all pass exits 0"
assert_file_exists "$PASS_RECEIPT" "runner-smoke writes receipt under XDG_RUNTIME_DIR/autopilot/runner-smoke/<date>.json"
assert_file_exists "$AUTOPILOT_RUNNER_VETTED_FILE" "runner-smoke PASS writes host-local runner-vetted overlay"
assert_file_absent "$FLEET_LOG" "runner-smoke all pass does NOT call fleet"
PASS_RECEIPT_CHECK="$(node -e '
const crypto = require("crypto");
const fs = require("fs");
const receiptBytes = fs.readFileSync(process.argv[1], "utf8");
const expectedSha = crypto.createHash("sha256").update(receiptBytes, "utf8").digest("hex");
const doc = JSON.parse(receiptBytes);
if (doc.schema !== "autopilot.runner-smoke/1") process.exit(1);
if (doc.ok !== true || doc.pass_count !== 5 || doc.fail_count !== 0) process.exit(2);
for (const r of doc.runners) {
  if (r.pass !== true || r.result !== "pass") process.exit(3);
  if (r.rail_exit !== 0 || r.rail_classification !== "authored") process.exit(4);
  if (typeof r.version !== "string" || !r.version) process.exit(5);
  if (typeof r.wall_seconds !== "number" || r.wall_seconds < 0) process.exit(6);
}
const vetted = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (vetted.schema !== "autopilot.runner-vetted/1") process.exit(7);
if (!Array.isArray(vetted.runners.codex) || vetted.runners.codex.length !== 1) process.exit(8);
const codexEntry = vetted.runners.codex[0];
if (codexEntry.version !== "codex-cli 0.170.0") process.exit(9);
if (codexEntry.receipt_sha256 !== expectedSha) process.exit(10);
if (codexEntry.vetted_at !== doc.finished_at) process.exit(11);
for (const abs of ["kimi", "qwen", "opencode"]) {
  if (vetted.runners[abs]) process.exit(12);
}
process.stdout.write(expectedSha);
' "$PASS_RECEIPT" "$AUTOPILOT_RUNNER_VETTED_FILE")"
assert_eq "${#PASS_RECEIPT_CHECK}" "64" "all-pass receipt and overlay record matching 64-hex receipt_sha256 and vetted_at"
assert_contains "$(cat "$PROMPT_LOG")" 'model_reasoning_effort="high"' "codex smoke uses reasoning effort high"
assert_not_contains "$(cat "$PROMPT_LOG")" 'model_reasoning_effort="xhigh"' "codex smoke never uses reasoning effort xhigh"

POST_SMOKE_PIN_OUT="$(FAKE_CODEX_VERSION="codex-cli 0.170.0" node "$PIN_CHECK_JS" < /dev/null 2>&1)"; POST_SMOKE_PIN_RC=$?
assert_eq "$POST_SMOKE_PIN_RC" "0" "codex 0.170.0 passes pin-check via host overlay after smoke PASS"
POST_SMOKE_SRC="$(printf '%s\n' "$POST_SMOKE_PIN_OUT" | node -e '
const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const codex = rows.find((r) => r.runner === "codex");
process.stdout.write(`${codex.status}/${codex.vetted_source}/${codex.drift}`);
')"
assert_eq "$POST_SMOKE_SRC" "vetted/overlay/false" "pin-check reports vetted/overlay/false after smoke PASS"

SMOKE_PASS2_OUT="$(FAKE_CODEX_VERSION="codex-cli 0.170.0" node "$SMOKE_JS" --date 2026-11-20 < /dev/null 2>&1)"; SMOKE_PASS2_RC=$?
assert_eq "$SMOKE_PASS2_RC" "0" "second smoke PASS exits 0"
DEDUP_CHECK="$(node -e '
const fs = require("fs");
const vetted = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const r of ["codex", "agy", "claude", "grok", "cursor"]) {
  if (!Array.isArray(vetted.runners[r]) || vetted.runners[r].length !== 1) process.exit(1);
}
if (vetted.runners.codex[0].receipt_sha256 !== process.argv[2]) process.exit(2);
process.stdout.write("ok");
' "$AUTOPILOT_RUNNER_VETTED_FILE" "$PASS_RECEIPT_CHECK")"
assert_eq "$DEDUP_CHECK" "ok" "running smoke PASS twice is idempotent and does not duplicate overlay entries"

# --- 5. runner-smoke.js FAIL never writes failed runner to overlay + calls fleet once ---
FAIL_ONLY_OVERLAY="$TEST_TMP/fail-only-vetted.json"
rm -f "$FAIL_ONLY_OVERLAY"
FAIL_ONLY_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$FAIL_ONLY_OVERLAY" FAKE_BAD_RUNNER=grok FAKE_GROK_VERSION="grok 1.0.88 (bad)" node "$SMOKE_JS" --only grok --date 2026-11-20 < /dev/null 2>&1)"; FAIL_ONLY_RC=$?
assert_eq "$FAIL_ONLY_RC" "1" "runner-smoke --only grok exits 1 on failure"
assert_file_absent "$FAIL_ONLY_OVERLAY" "smoke FAIL never creates or writes runner-vetted overlay"

rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG"
PARTIAL_OVERLAY="$TEST_TMP/partial-fail-vetted.json"
FAIL_RECEIPT="$XDG_RUNTIME_DIR/autopilot/runner-smoke/2026-11-20.json"
SMOKE_FAIL_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$PARTIAL_OVERLAY" FAKE_BAD_RUNNER=grok FAKE_GROK_VERSION="grok 1.0.88 (bad)" node "$SMOKE_JS" --notify test/canary/ops --date 2026-11-20 < /dev/null 2>&1)"; SMOKE_FAIL_RC=$?
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
if (doc.ok !== false || doc.pass_count !== 4 || doc.fail_count !== 1) process.exit(1);
const grok = doc.runners.find((r) => r.runner === "grok");
if (!grok || grok.pass !== false || grok.result !== "fail") process.exit(2);
const ov = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (ov.runners.grok) process.exit(3);
process.stdout.write("ok");
' "$FAIL_RECEIPT" "$PARTIAL_OVERLAY")"
assert_eq "$FAIL_RECEIPT_CHECK" "ok" "failure receipt records grok fail and never writes failed grok into overlay"

# --- 6. runner-smoke.js: --only <runner> + ~/.autopilot/{runner-smoke,runner-vetted.json} default fallbacks ---
rm -f "$CALL_LOG" "$PROMPT_LOG" "$FLEET_LOG" "$HOME/.autopilot/runner-vetted.json"
FALLBACK_RECEIPT="$HOME/.autopilot/runner-smoke/2026-11-21.json"
ONLY_OUT="$(env -u XDG_RUNTIME_DIR -u AUTOPILOT_RUNNER_VETTED_FILE node "$SMOKE_JS" --only cursor --date 2026-11-21 < /dev/null 2>&1)"; ONLY_RC=$?
assert_eq "$ONLY_RC" "0" "runner-smoke --only cursor exits 0"
assert_file_exists "$FALLBACK_RECEIPT" "runner-smoke falls back to ~/.autopilot/runner-smoke/<date>.json"
assert_file_exists "$HOME/.autopilot/runner-vetted.json" "runner-smoke falls back to ~/.autopilot/runner-vetted.json when AUTOPILOT_RUNNER_VETTED_FILE unset"
ONLY_PROMPT_COUNT="$(wc -l < "$PROMPT_LOG" | tr -d ' ')"
assert_eq "$ONLY_PROMPT_COUNT" "1" "--only cursor dispatches exactly one runner prompt"
assert_contains "$(cat "$PROMPT_LOG")" "cursor-agent" "--only cursor invokes cursor-agent only"

# --- 6b. runner-pin-check.js --suggest-table unions two overlays (read-only) ---
OV_ONE="$TEST_TMP/suggest-ov-1.json"
OV_TWO="$TEST_TMP/suggest-ov-2.json"
cat > "$OV_ONE" <<'EOF'
{
  "schema": "autopilot.runner-vetted/1",
  "runners": {
    "codex": [
      { "version": "codex-cli 0.166.0", "receipt_sha256": "1111111111111111111111111111111111111111111111111111111111111111", "vetted_at": "2026-11-19T01:00:00Z" },
      { "version": "codex-cli 0.168.0", "receipt_sha256": "2222222222222222222222222222222222222222222222222222222222222222", "vetted_at": "2026-11-19T02:00:00Z" }
    ],
    "grok": [
      { "version": "grok 1.0.70 (seat-a) [stable]", "receipt_sha256": "3333333333333333333333333333333333333333333333333333333333333333", "vetted_at": "2026-11-19T01:00:00Z" }
    ],
    "claude": [
      { "version": "2.1.325 (Claude Code)", "receipt_sha256": "4444444444444444444444444444444444444444444444444444444444444444", "vetted_at": "2026-11-19T01:00:00Z" }
    ]
  }
}
EOF
cat > "$OV_TWO" <<'EOF'
{
  "schema": "autopilot.runner-vetted/1",
  "runners": {
    "codex": [
      { "version": "codex-cli 0.170.0", "receipt_sha256": "5555555555555555555555555555555555555555555555555555555555555555", "vetted_at": "2026-11-19T03:00:00Z" },
      { "version": "codex-cli 0.168.0", "receipt_sha256": "6666666666666666666666666666666666666666666666666666666666666666", "vetted_at": "2026-11-19T03:00:00Z" }
    ],
    "grok": [
      { "version": "grok 1.0.89 (seat-b) [stable]", "receipt_sha256": "7777777777777777777777777777777777777777777777777777777777777777", "vetted_at": "2026-11-19T03:00:00Z" }
    ],
    "claude": [
      { "version": "2.1.327 (Claude Code)", "receipt_sha256": "8888888888888888888888888888888888888888888888888888888888888888", "vetted_at": "2026-11-19T03:00:00Z" }
    ]
  }
}
EOF
PINS_SUM_BEFORE="$(cksum < "$PINS_JSON")"
OV1_SUM_BEFORE="$(cksum < "$OV_ONE")"
OV2_SUM_BEFORE="$(cksum < "$OV_TWO")"
SUGGEST_OUT="$(node "$PIN_CHECK_JS" --suggest-table "$OV_ONE" "$OV_TWO" < /dev/null 2>&1)"; SUGGEST_RC=$?
assert_eq "$SUGGEST_RC" "0" "runner-pin-check --suggest-table exits 0"
assert_eq "$(cksum < "$PINS_JSON")" "$PINS_SUM_BEFORE" "--suggest-table leaves config/runner-pins.json untouched"
assert_eq "$(cksum < "$OV_ONE")" "$OV1_SUM_BEFORE" "--suggest-table leaves first overlay untouched"
assert_eq "$(cksum < "$OV_TWO")" "$OV2_SUM_BEFORE" "--suggest-table leaves second overlay untouched"
SUGGEST_CHECK="$(printf '%s' "$SUGGEST_OUT" | node -e '
const { validatePinTable } = require(process.argv[1]);
const doc = validatePinTable(JSON.parse(require("fs").readFileSync(0, "utf8")));
if (doc.schema !== "autopilot.runner-pins/2") process.exit(1);
if (JSON.stringify(doc.runners.codex.vetted) !== JSON.stringify(["codex-cli 0.166.0", "codex-cli 0.168.0", "codex-cli 0.170.0"])) process.exit(2);
if (JSON.stringify(doc.runners.grok.vetted) !== JSON.stringify(["grok 1.0.70 (seat-a) [stable]", "grok 1.0.89 (seat-b) [stable]"])) process.exit(3);
if (JSON.stringify(doc.runners.claude.vetted) !== JSON.stringify(["2.1.325 (Claude Code)", "2.1.327 (Claude Code)"])) process.exit(4);
if (JSON.stringify(doc.runners.kimi.vetted) !== JSON.stringify([])) process.exit(5);
if (doc.runners.claude.autoupdate.env !== "DISABLE_AUTOUPDATER") process.exit(6);
process.stdout.write("ok");
' "$PINS_LIB_JS")"
assert_eq "$SUGGEST_CHECK" "ok" "--suggest-table produces valid v2 table unioning deduplicated vetted versions across overlays"

# --- 7. Negative controls (sed_mutant): prove gates go red when checks are weakened ---
MUT_DIR="$TEST_TMP/mutants"
mkdir -p "$MUT_DIR/scripts/lib"
cp "$PIN_CHECK_JS" "$MUT_DIR/scripts/runner-pin-check.js"
cp "$REPO_ROOT/scripts/lib/runner-binary.js" "$MUT_DIR/scripts/lib/runner-binary.js"
cp "$REPO_ROOT/scripts/lib/kimi-local-stop.js" "$MUT_DIR/scripts/lib/kimi-local-stop.js"
sed_mutant "$PINS_LIB_JS" "$MUT_DIR/scripts/lib/runner-pins.js" "s/status === 'unvetted'/false/"
MUT_PIN_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/no-vetted.json" FAKE_GROK_VERSION="grok 9.9.9" node "$MUT_DIR/scripts/runner-pin-check.js" --pins "$PINS_JSON" < /dev/null 2>&1)"; MUT_PIN_RC=$?
assert_eq "$MUT_PIN_RC" "0" "negative control: mutating runner-pins.js drift predicate lets unvetted version slip through"

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
MUT_SMOKE_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/mut-vetted.json" FAKE_BAD_RUNNER=cursor node "$MUT_DIR/scripts/runner-smoke.js" --pins "$PINS_JSON" --only cursor --receipt-dir "$TEST_TMP/mut-receipts" --date 2026-11-22 < /dev/null 2>&1)"; MUT_SMOKE_RC=$?
assert_eq "$MUT_SMOKE_RC" "0" "negative control: mutating runner-smoke.js token check lets wrong answer pass"

sed_mutant "$SMOKE_JS" "$MUT_DIR/scripts/runner-smoke-utc.js" 's/localDateString()/new Date().toISOString().slice(0, 10)/'
MUT_UTC_DATE="$(NODE_OPTIONS="--require $FAKE_CLOCK_JS" TZ=Asia/Taipei node "$MUT_DIR/scripts/runner-smoke-utc.js" --pins "$PINS_JSON" --dry-run < /dev/null | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).date)')"
assert_eq "$MUT_UTC_DATE" "2026-11-18" "negative control: reverting localDateString() to UTC date mis-stamps +08:00 receipt as 2026-11-18"

sed_mutant "$SMOKE_JS" "$MUT_DIR/scripts/runner-smoke-badvet.js" 's/r\.pass === true/true/'
MUT_BAD_VET="$TEST_TMP/mut-bad-vetted.json"
rm -f "$MUT_BAD_VET"
MUT_BADVET_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$MUT_BAD_VET" FAKE_BAD_RUNNER=cursor node "$MUT_DIR/scripts/runner-smoke-badvet.js" --pins "$PINS_JSON" --only cursor --receipt-dir "$TEST_TMP/mut-receipts2" --date 2026-11-23 < /dev/null 2>&1)"; MUT_BADVET_RC=$?
assert_eq "$MUT_BADVET_RC" "1" "negative control: bad-vetted mutant still exits 1 on smoke failure"
assert_file_exists "$MUT_BAD_VET" "negative control: mutating r.pass === true writes failed version into overlay"

sed_mutant "$SMOKE_JS" "$MUT_DIR/scripts/runner-smoke-no-model-guard.js" 's/EXPENSIVE_SMOKE_MODEL_RE\.test(model)/false/'
rm -f "$CALL_LOG"
rm -f "$PROMPT_LOG"
MUT_NO_GUARD_OUT="$(AUTOPILOT_RUNNER_VETTED_FILE="$TEST_TMP/mut-no-guard-vetted.json" node "$MUT_DIR/scripts/runner-smoke-no-model-guard.js" --pins "$EXPENSIVE_PINS" --only agy --receipt-dir "$TEST_TMP/mut-no-guard-receipts" --date 2026-11-24 < /dev/null 2>&1)"; MUT_NO_GUARD_RC=$?
assert_eq "$MUT_NO_GUARD_RC" "0" "negative control: removing expensive-model guard lets gemini-4-carbon-low run and exit 0"
assert_file_exists "$CALL_LOG" "negative control: removing expensive-model guard invokes fake agy runner"

finalize_test
