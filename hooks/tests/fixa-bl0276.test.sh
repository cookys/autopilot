#!/usr/bin/env bash
# BL-0276: quoted open-decision path, first-line reply wording, shared autocompact buffer,
# token-discipline --check exit 3 when nothing is installed.
# RED at 50e9b5350: 3 passed, 8 failed — space path's first node arg was ".../plugin" not ".../plugin dir/scripts/open-decision.js" (guard and session-start); session-start wording was "bad"; handoff source still had literal 33000; --check exit was 1 when nothing was installed; two "not installed" lines were WARN (INFO count 0); drift left WARNINGS at 5 -> 5.
. "$(dirname "$0")/lib.sh"

GUARD_SRC="$REPO_ROOT/hooks/owner-question-guard.js"
START_SRC="$REPO_ROOT/src/hooks/handlers/session-start.js"
HAND_SRC="$REPO_ROOT/scripts/lib/compaction-handoff.js"
WIN_SRC="$REPO_ROOT/scripts/lib/autocompact-window.js"
TD_SRC="$REPO_ROOT/scripts/install-token-discipline.js"
SETUP="$REPO_ROOT/scripts/dev-setup.sh"

first_node_arg() {
  local produced="$1"
  bash -c "printf '%s\n' $produced" | sed -n '2p'
}

# --- quote: space in the plugin path ---
SPACE="$TEST_TMP/plugin dir"
mkdir -p "$SPACE/hooks" "$SPACE/scripts/lib" "$SPACE/src/hooks/handlers"
cp "$GUARD_SRC" "$SPACE/hooks/owner-question-guard.js"
cp "$REPO_ROOT/scripts/lib/config-path.js" "$SPACE/scripts/lib/config-path.js"
cp "$START_SRC" "$SPACE/src/hooks/handlers/session-start.js"
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Should I continue?"}]}}' > "$TEST_TMP/transcript.jsonl"

GUARD_REASON="$(HOME="$TEST_TMP" node -e '
const { decide } = require(process.argv[1]);
const out = decide({ transcript_path: process.argv[2] });
if (!out) process.exit(2);
process.stdout.write(out.reason);
' "$SPACE/hooks/owner-question-guard.js" "$TEST_TMP/transcript.jsonl")"
GUARD_CMD="$(printf '%s' "$GUARD_REASON" | node -e '
let s = ""; process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  const m = s.match(/node (.*?) open --question/);
  if (!m) process.exit(2);
  process.stdout.write("node " + m[1] + " open");
});
')"
GUARD_EXPECT="$SPACE/scripts/open-decision.js"
GOT="$(first_node_arg "$GUARD_CMD")"
assert_eq "$GOT" "$GUARD_EXPECT" "guard: first arg after node is the full path when the plugin path has a space"

START_TEXT="$(HOME="$TEST_TMP" node -e '
const { buildBaseContext } = require(process.argv[1]);
process.stdout.write(buildBaseContext("/tmp"));
' "$SPACE/src/hooks/handlers/session-start.js")"
START_CMD="$(printf '%s' "$START_TEXT" | node -e '
let s = ""; process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  const m = s.match(/node (.*?) open --question/);
  if (!m) process.exit(2);
  process.stdout.write("node " + m[1] + " open");
});
')"
GOT="$(first_node_arg "$START_CMD")"
assert_eq "$GOT" "$GUARD_EXPECT" "session-start: first arg after node is the full path when the plugin path has a space"

PLAIN_GUARD="$(HOME="$TEST_TMP" node -e '
const path = require("path");
const { decide } = require(process.argv[1]);
const out = decide({ transcript_path: process.argv[2] });
const abs = path.join(process.argv[3], "scripts", "open-decision.js");
const reason = out.reason;
if (!reason.includes("node " + abs + " open")) process.exit(3);
if (reason.includes("'\''" + abs + "'\''")) process.exit(4);
process.stdout.write("ok");
' "$GUARD_SRC" "$TEST_TMP/transcript.jsonl" "$REPO_ROOT")"
assert_eq "$PLAIN_GUARD" "ok" "guard: a path without spaces stays unquoted"

PLAIN_START="$(HOME="$TEST_TMP" node -e '
const path = require("path");
const { buildBaseContext } = require(process.argv[1]);
const abs = path.join(process.argv[2], "scripts", "open-decision.js");
const text = buildBaseContext("/tmp");
if (!text.includes("node " + abs + " open")) process.exit(3);
if (text.includes("'\''" + abs + "'\''")) process.exit(4);
process.stdout.write("ok");
' "$START_SRC" "$REPO_ROOT")"
assert_eq "$PLAIN_START" "ok" "session-start: a path without spaces stays unquoted"

# --- wording ---
WORD="$(HOME="$TEST_TMP" node -e '
const { buildBaseContext } = require(process.argv[1]);
const t = buildBaseContext("/tmp");
const good = t.includes("a message whose first line is [待決回覆]");
const bad = t.includes("starting with [待決回覆]");
process.stdout.write(good && !bad ? "ok" : "bad");
' "$START_SRC")"
assert_eq "$WORD" "ok" "session-start names the first line and drops the starting-with claim"

# --- shared buffer ---
BUF="$(node -e '
const fs = require("fs");
const a = require(process.argv[1]);
const c = require(process.argv[2]);
const src = fs.readFileSync(process.argv[2], "utf8");
const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
const literal = /33_000|33000/.test(code);
const msg = c.budgetWarning({
  env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000", AUTOPILOT_CONTEXT_BUDGET_T2: "80000", AUTOPILOT_CONTEXT_BUDGET_GAP: "50000" },
  home: process.argv[3],
});
const same = String(msg || "").includes(String(a.AUTOCOMPACT_BUFFER)) && !literal;
process.stdout.write(same ? "ok" : ("bad msg=" + msg + " literal=" + literal));
' "$WIN_SRC" "$HAND_SRC" "$TEST_TMP")"
assert_eq "$BUF" "ok" "budgetWarning uses AUTOCOMPACT_BUFFER and the handoff source has no 33000 literal outside comments"

# --- token discipline under this test HOME ---
TD_HOME="$TEST_TMP/td-home"
TD_CODEX="$TEST_TMP/td-codex"
mkdir -p "$TD_HOME" "$TD_CODEX"
TD_OUT="$(HOME="$TD_HOME" CODEX_HOME="$TD_CODEX" node "$TD_SRC" --check 2>&1)"; TD_EC=$?
assert_eq "$TD_EC" "3" "--check exit 3 when nothing is installed"

NODE_BIN="$TEST_TMP/node-bin"
mkdir -p "$NODE_BIN"
ln -s "$(command -v node)" "$NODE_BIN/node"
TD_PATH="$NODE_BIN:/usr/bin:/bin"
SETUP_A="$(HOME="$TD_HOME" CODEX_HOME="$TD_CODEX" PATH="$TD_PATH" bash "$SETUP" --check --harness claude 2>&1)"
WARN_A="$(printf '%s\n' "$SETUP_A" | sed -n 's/^Summary: [0-9]* failure(s), \([0-9]*\) warning(s)/\1/p')"
INFO_N="$(printf '%s\n' "$SETUP_A" | grep -c '^INFO tokens .*not installed' || true)"
WARN_TOK_MISS="$(printf '%s\n' "$SETUP_A" | grep -c '^WARN tokens .*not installed' || true)"
assert_eq "$WARN_TOK_MISS" "0" "not installed does not WARN"
if [[ "$INFO_N" -ge 1 ]]; then assert_eq "1" "1" "not installed is INFO"; else fail "not installed is INFO (got $INFO_N)"; fi

HOME="$TD_HOME" CODEX_HOME="$TD_CODEX" node "$TD_SRC" install >/dev/null
python3 - "$TD_CODEX/AGENTS.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
p.write_text(p.read_text().replace("Five rules", "Five rules HAND-EDITED", 1))
PY
TD_OUT="$(HOME="$TD_HOME" CODEX_HOME="$TD_CODEX" node "$TD_SRC" --check 2>&1)"; TD_EC=$?
assert_eq "$TD_EC" "1" "--check exit 1 when a block has drifted"
SETUP_B="$(HOME="$TD_HOME" CODEX_HOME="$TD_CODEX" PATH="$TD_PATH" bash "$SETUP" --check --harness claude 2>&1)"
WARN_B="$(printf '%s\n' "$SETUP_B" | sed -n 's/^Summary: [0-9]* failure(s), \([0-9]*\) warning(s)/\1/p')"
if [[ "$WARN_B" -gt "$WARN_A" ]]; then assert_eq "$WARN_B" "$WARN_B" "drift increases WARNINGS ($WARN_A -> $WARN_B)"; else fail "drift increases WARNINGS ($WARN_A -> $WARN_B)"; fi

HINT_HOME="$TEST_TMP/hint-home"
HINT_CODEX="$TEST_TMP/hint-codex"
mkdir -p "$HINT_HOME" "$HINT_CODEX"
cat > "$HINT_CODEX/config.toml" <<'EOF'
default_subagent_model = "cheap"
EOF
HINT_OUT="$(HOME="$HINT_HOME" CODEX_HOME="$HINT_CODEX" PATH="$TD_PATH" bash "$SETUP" --check --harness claude 2>&1)"
HINT_LINE="$(printf '%s\n' "$HINT_OUT" | grep 'hint: default_subagent_model' | head -1)"
case "$HINT_LINE" in
  WARN*) assert_eq "WARN" "WARN" "misplaced key hint is WARN while not installed" ;;
  *) fail "misplaced key hint is WARN while not installed (got: $HINT_LINE)" ;;
esac

finalize_test
