#!/usr/bin/env bash
# hooks/tests/slash-entry-probe.test.sh — B1/B2 thin-shell behavioral probe (release gate).
#
# Headlessly triggers ALL FIVE thin-shelled slash entries (/l3 /l4 /l5 /l6
# /think-tank-dialectic) and asserts — by TOOL-USE ARTIFACT, never model
# self-report — that each entry actually Reads its MUST-READ reference(s):
#   l3, l4              → ceo-agent/references/level-front-door.md
#   l5                  → l5/references/hetero-impl-loop.md  (+ front-door)
#   l6                  → l6/references/full-dispatch-pipeline.md (+ front-door)
#   think-tank-dialectic → think-tank/references/dialectic-mode.md
#
# Born from docs/plans/2026-07-04-surface-area-reduction.md B1 acceptance
# (gpt-R1-G2: the probe must be a RE-RUNNABLE release gate, not a one-off
# transcript). Evidence = `--output-format stream-json` Read tool_use inputs
# parsed mechanically (artifact-not-self-report).
#
# DEFAULT: self-skip. Each probe is a real LLM call (5 total) — cost + wall
# clock make it a RELEASE-time gate, not a suite/pre-commit gate (plan: "納入
# preflight-release.sh, release 時跑"). preflight-release.sh runs it with
# AUTOPILOT_SLASH_PROBE=1.
#
# Knobs:
#   AUTOPILOT_SLASH_PROBE=1   enable (required)
#   SLASH_PROBE_ONLY="l5 l6"  probe a subset (space-separated entry keys)
#   SLASH_PROBE_MODEL         default claude-sonnet-5 (probe needs instruction-
#                             following; haiku-class flakes the gate)
#   SLASH_PROBE_TIMEOUT       per-entry seconds (default 300)
#   SLASH_PROBE_CLAUDE_BIN    claude binary (default: claude on PATH)

. "$(dirname "$0")/lib.sh"

if [ "${AUTOPILOT_SLASH_PROBE:-0}" != "1" ]; then
  echo "SKIP [slash-entry-probe] LLM probe gated off — set AUTOPILOT_SLASH_PROBE=1 (runs at release via preflight-release.sh)"
  finalize_test
  exit 0
fi

CLAUDE_BIN="${SLASH_PROBE_CLAUDE_BIN:-claude}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  fail "claude binary not found ('$CLAUDE_BIN') — the probe needs a real Claude Code CLI"
  finalize_test
fi

PROBE_MODEL="${SLASH_PROBE_MODEL:-claude-sonnet-5}"
PROBE_TIMEOUT="${SLASH_PROBE_TIMEOUT:-300}"

# Extract every Read tool_use file_path from a stream-json transcript.
# Node (built-ins only) per repo language rule: JSON parsing never via grep alone.
READS_PARSER="$TEST_TMP/extract-reads.js"
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

PROBE_INSTRUCTIONS="WIRING-PROBE (do not execute any goal): this is an automated skill-wiring probe. Load your skill, then use the Read tool to read EVERY file your skill body marks MUST-READ (follow the links). Do NOT invoke ceo-agent startup, do NOT create tasks or branches, do NOT run any command, do NOT write anything. After reading, reply exactly PROBE-COMPLETE and stop."

# probe <key> <slash-command> <expected-substr>...
probe() {
  local key="$1" slash="$2"; shift 2
  if [ -n "${SLASH_PROBE_ONLY:-}" ]; then
    case " $SLASH_PROBE_ONLY " in
      *" $key "*) ;;
      *) echo "  (skip $key — not in SLASH_PROBE_ONLY)"; return ;;
    esac
  fi
  local out="$TEST_TMP/probe-$key.jsonl" err="$TEST_TMP/probe-$key.err"
  echo "  probing $slash (model=$PROBE_MODEL, timeout=${PROBE_TIMEOUT}s)..."
  ( cd "$REPO_ROOT" && timeout "$PROBE_TIMEOUT" "$CLAUDE_BIN" -p "$slash $PROBE_INSTRUCTIONS" \
      --output-format stream-json --verbose --max-turns 12 \
      --model "$PROBE_MODEL" --allowedTools "Read" \
      > "$out" 2> "$err" </dev/null )
  local rc=$?
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    fail "$key: probe run failed (exit $rc, $(wc -c < "$out" 2>/dev/null || echo 0) bytes) — $(tail -c 300 "$err" 2>/dev/null | tr '\n' ' ')"
    return
  fi
  local reads
  reads=$(node "$READS_PARSER" "$out")
  if [ -z "$reads" ]; then
    fail "$key: no Read tool_use in transcript — entry did not read any reference (thin-shell wiring broken?)"
    return
  fi
  local expect
  for expect in "$@"; do
    assert_contains "$reads" "$expect" "$key: expected Read of '$expect' (artifact evidence)"
  done
}

probe l3 "/autopilot:l3" \
  "ceo-agent/references/level-front-door.md"
probe l4 "/autopilot:l4" \
  "ceo-agent/references/level-front-door.md"
probe l5 "/autopilot:l5" \
  "skills/l5/references/hetero-impl-loop.md" \
  "ceo-agent/references/level-front-door.md"
probe l6 "/autopilot:l6" \
  "skills/l6/references/full-dispatch-pipeline.md" \
  "ceo-agent/references/level-front-door.md"
probe dialectic "/autopilot:think-tank-dialectic" \
  "think-tank/references/dialectic-mode.md"
probe hetero-review "/autopilot:hetero-review" \
  "skills/hetero-review/references/plan-loop.md" \
  "skills/hetero-review/references/code-loop.md"

finalize_test

