#!/usr/bin/env bash
# hooks/tests/slash-entry-natural-probe.test.sh — B-group natural-behavior probe.
#
# Headlessly triggers the thickest slash-entry protocols with small realistic
# goals that DO NOT hint the model to read anything, then asserts — by
# TOOL-USE ARTIFACT, never model self-report — that each entry spontaneously
# Reads the expected reference file(s):
#   l5                    → skills/l5/references/hetero-impl-loop.md (+ front-door)
#   think-tank-dialectic  → think-tank/references/dialectic-mode.md
#
# Born from v2.31.16 surface-area B-group: closes the "explicit-instruction
# probe" evidence gap left by slash-entry-probe.test.sh, which proves
# link-resolution + compliance but not natural behavior.
#
# This probe is BEHAVIORAL evidence with model variance. A fail means
# investigate the transcript and rerun as needed; knobs below select model,
# timeout, and subset.
#
# DEFAULT: self-skip. Each probe is a real LLM call, so this is NOT wired into
# preflight-release.sh by default (operator/BACKLOG decision). Run manually with
# AUTOPILOT_NATURAL_PROBE=1.
#
# Knobs:
#   AUTOPILOT_NATURAL_PROBE=1     enable (required)
#   SLASH_NATURAL_ONLY="l5"       probe a subset (space-separated entry keys)
#   SLASH_NATURAL_MODEL           default claude-sonnet-5
#   SLASH_NATURAL_TIMEOUT         per-entry seconds (default 300)
#   SLASH_NATURAL_CLAUDE_BIN      claude binary (default: claude on PATH)
#
# Side effect: the probed `claude -p` runs against the REAL $HOME (deliberate —
# the live skill-loading path is the thing under test), so each run writes a
# real session transcript under ~/.claude/projects/.

. "$(dirname "$0")/lib.sh"

if [ "${AUTOPILOT_NATURAL_PROBE:-0}" != "1" ]; then
  echo "SKIP [slash-entry-natural-probe] LLM probe gated off — set AUTOPILOT_NATURAL_PROBE=1 (manual behavioral probe)"
  finalize_test
  exit 0
fi

CLAUDE_BIN="${SLASH_NATURAL_CLAUDE_BIN:-claude}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  fail "claude binary not found ('$CLAUDE_BIN') — the probe needs a real Claude Code CLI"
  finalize_test
fi

PROBE_MODEL="${SLASH_NATURAL_MODEL:-claude-sonnet-5}"
PROBE_TIMEOUT="${SLASH_NATURAL_TIMEOUT:-300}"

# Extract every Read tool_use file_path from a stream-json transcript.
# Node (built-ins only) per repo language rule: JSON parsing never via grep alone.
READS_PARSER="$TEST_TMP/extract-natural-reads.js"
cat > "$READS_PARSER" <<'JS'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const out = [];
for (const line of lines) {
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  const content = ev && ev.message && ev.message.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block && block.type === 'tool_use' && block.name === 'Read' &&
        block.input && typeof block.input.file_path === 'string') {
      out.push(block.input.file_path);
    }
  }
}
console.log(out.join('\n'));
JS

# probe <key> <slash-command> <goal> <expected-substr>...
probe() {
  local key="$1" slash="$2" goal="$3"
  shift 3

  if [ -n "${SLASH_NATURAL_ONLY:-}" ]; then
    case " $SLASH_NATURAL_ONLY " in
      *" $key "*) ;;
      *) echo "  (skip $key — not in SLASH_NATURAL_ONLY)"; return ;;
    esac
  fi

  # Hint-lint is BEST-EFFORT, not exhaustive: it word-boundary-matches common
  # read-hint tokens/phrases, but cannot prove a goal is hint-free (e.g. subtle
  # priming like "consult"/"查閱" variants beyond this list). A PASS means "no
  # known hint token", not a guarantee of naturalness — review new goals by eye.
  if printf '%s\n' "$goal" | grep -Eiq '\bread(s|ing)?\b|MUST-READ|\breferences?\b|\bconsult\b|look at|檔案|讀|查看|查閱'; then
    fail "$key: goal contains a read-hint — natural probe invalidated"
    return
  fi

  local out="$TEST_TMP/natural-probe-$key.jsonl" err="$TEST_TMP/natural-probe-$key.err"
  echo "  probing $slash naturally (model=$PROBE_MODEL, timeout=${PROBE_TIMEOUT}s)..."
  ( cd "$REPO_ROOT" && timeout "$PROBE_TIMEOUT" "$CLAUDE_BIN" -p "$slash $goal" \
      --output-format stream-json --verbose --max-turns 12 \
      --model "$PROBE_MODEL" --allowedTools "Read" \
      > "$out" 2> "$err" </dev/null )
  local rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$out" ]; then
    fail "$key: natural probe run failed (exit $rc, $(wc -c < "$out" 2>/dev/null || echo 0) bytes) — $(tail -c 300 "$err" 2>/dev/null | tr '\n' ' ')"
    return
  fi

  local reads
  reads=$(node "$READS_PARSER" "$out")
  if [ -z "$reads" ]; then
    fail "$key: entry acted without reading any reference (thin-shell natural-behavior gap)"
    return
  fi

  local expect
  for expect in "$@"; do
    assert_contains "$reads" "$expect" "$key: missing expected natural Read of '$expect' (artifact evidence)"
  done
}

probe l5 "/autopilot:l5" \
  "評估這個 repo 的 scripts/sync-model-routing.sh 適不適合走你這一層來改;先解釋你這一層開工前要先確認哪些前提與設定,說明完就停,不要真的開工。" \
  "skills/l5/references/hetero-impl-loop.md" \
  "ceo-agent/references/level-front-door.md"

probe dialectic "/autopilot:think-tank-dialectic" \
  "我在考慮要不要把這個 repo 的 bash 腳本全部改寫成 Node,兩邊都有道理而且改了很難回頭;先告訴我你的完整流程會怎麼進行、第一步是什麼,說明完就停,先不要真的開始辯論。" \
  "think-tank/references/dialectic-mode.md"

finalize_test
