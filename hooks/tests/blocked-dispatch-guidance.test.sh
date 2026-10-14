#!/usr/bin/env bash
# BL-0017 (openclaw, owner-confirmed 2026-10-13): a brief that sets an l5/l6 marker and then runs a
# non-strict dispatch burns foreman budget on the refusal. Three rules, each with a deliberately bad
# case that must be caught and a clean case that must not be flagged:
#   (a) the copy-pasteable mask line is printed by `session-mode set --level l5|l6` (stderr) and is part of
#       the dispatch-author / dispatch-hetero gate refusal; all four copies are byte-identical;
#   (b) ladder stop: the same precondition_failed cause twice in a row => probe-unknown classify stops
#       (recommend none, reason repeated-refusal) instead of climbing; dispatch-consult records the cause;
#   (c) dispatch-model-guard warns (never blocks) on a brief that sets an l5/l6 marker AND names a
#       non-strict rail, appending the mask line.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_ROOT_RUN_ID 2>/dev/null || true
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"

MASK='To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)'
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base

# --- (a) parity: the four copies are the same bytes --------------------------------------------
for f in scripts/session-mode.js hooks/dispatch-model-guard.js; do
  assert_contains "$(cat "$REPO_ROOT/$f")" "$MASK" "(a) $f carries the mask line verbatim"
done
for f in scripts/dispatch-author.sh scripts/dispatch-hetero.sh; do
  # shell sources escape the dollar sign inside double quotes
  assert_contains "$(cat "$REPO_ROOT/$f")" 'To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=\$(mktemp -d)' "(a) $f carries the mask line (shell-escaped)"
done

# --- (a) session-mode set prints it for l5/l6, not for l3 ---------------------------------------
MD="$TEST_TMP/markers"; mkdir -p "$MD"
for level in l5 l6; do
  ERR="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_SESSION_ID="s-$level" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 \
    node "$REPO_ROOT/scripts/session-mode.js" set --level "$level" --size S --repo-root "$SBX" 2>&1 >/dev/null)"
  assert_contains "$ERR" "$MASK" "(a) set --level $level prints the mask line on stderr"
done
ERR="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_SESSION_ID="s-l3" AUTOPILOT_RUNS_WATCH_AUTOSTART=0 \
  node "$REPO_ROOT/scripts/session-mode.js" set --level l3 --size S --repo-root "$SBX" 2>&1 >/dev/null)"
assert_not_contains "$ERR" "AUTOPILOT_SESSION_MODE_DIR" "(a) set --level l3 does not print the mask line"

# --- (a) the gate refusal carries it, and the line really lifts the gate ------------------------
PROMPT="$TEST_TMP/p.txt"; echo "write a plan" > "$PROMPT"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$MD" AUTOPILOT_DISPATCH_MANIFEST=0 DISPATCH_QUIET=1 \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner grok --model grok-4.5 --prompt-file "$PROMPT" --bin /bin/true 2>/dev/null)"
assert_contains "$OUT" "blocks non-strict dispatch" "(a) live l5/l6 marker refuses the non-strict author dispatch"
assert_contains "$OUT" 'AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)' "(a) the refusal carries the mask line"
EMPTYD="$(mktemp -d -p "$TEST_TMP")"
OUT="$(cd "$SBX" && AUTOPILOT_SESSION_MODE_DIR="$EMPTYD" AUTOPILOT_DISPATCH_MANIFEST=0 DISPATCH_QUIET=1 \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner grok --model grok-4.5 --prompt-file "$PROMPT" --bin /bin/true 2>/dev/null)"
assert_not_contains "$OUT" "blocks non-strict dispatch" "(a) with the marker dir masked the gate no longer refuses"

# --- (b) ladder stop -----------------------------------------------------------------------------
PROBE="$REPO_ROOT/scripts/probe-unknown.js"; LEDGER="$REPO_ROOT/scripts/decision-ledger.js"
mkdir -p "$TEST_TMP/k" "$TEST_TMP/m"
PIN=(--knob auto --consult-resolved-from topology --consult-dispatch auto --budget-u1 2 --budget-u2 1 --budget-u3 1 --knowledge-dir "$TEST_TMP/k" --memory-dir "$TEST_TMP/m" --repo-root "$REPO_ROOT")
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=process.argv[1].split(".").reduce((o,k)=>o&&o[k],j);process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
LB="$TEST_TMP/ladder.jsonl"
seed() { # <work-unit>
  node "$LEDGER" append --ledger "$LB" --kind hypothesis --json '{"hypothesis_id":"'"$1"'a","text":"x","status":"refuted","work_unit":"'"$1"'"}' >/dev/null
  node "$LEDGER" append --ledger "$LB" --kind hypothesis --json '{"hypothesis_id":"'"$1"'b","text":"y","status":"refuted","work_unit":"'"$1"'"}' >/dev/null
}
rail_failed() { # <work-unit> [cause]
  local -a c=(); [ -n "${2:-}" ] && c=(--cause "$2")
  node "$PROBE" receipt --ledger "$LB" --rung U1 --unknown-type why --terms dead --signals S1 --work-unit "$1" --reason rail-failed "${c[@]}" >/dev/null
}
CAUSE='precondition_failed: active session-mode=l5 blocks non-strict dispatch'
seed same; rail_failed same "$CAUSE"; rail_failed same "$CAUSE"
OUT="$(node "$PROBE" classify --ledger "$LB" --work-unit same "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "none" "(b) same cause twice: classify does not climb"
assert_eq "$(printf '%s' "$OUT" | field reason)" "repeated-refusal" "(b) the stop names repeated-refusal"
assert_contains "$(printf '%s' "$OUT" | field stop.cause)" "blocks non-strict dispatch" "(b) the stop carries the cause"
seed diff; rail_failed diff "$CAUSE"; rail_failed diff "precondition_failed: something else"
OUT="$(node "$PROBE" classify --ledger "$LB" --work-unit diff "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "(b) two different causes: the ladder still climbs"
seed nocause; rail_failed nocause; rail_failed nocause
OUT="$(node "$PROBE" classify --ledger "$LB" --work-unit nocause "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "(b) rail-failed rows without a cause behave as before"

# dispatch-consult records the dispatcher's precondition reason as the row's cause
Q="$TEST_TMP/q.txt"; printf 'which layer owns invalidation?\n' > "$Q"
ART="$TEST_TMP/a.diff"; printf 'diff --git a/x b/x\n+line\n' > "$ART"
TOPO="$TEST_TMP/topology.json"
cat > "$TOPO" <<'JSON'
{ "schema_version": 1, "generated_at": "2026-09-07T00:00:00.000Z", "host": "test-host",
  "consult_ladder": [ { "rung": "minimax-m3/high@agy", "engine": "minimax-m3", "effort": "high", "runner": "agy", "family": "minimax", "endpoint": "", "role_source": "consult" } ] }
JSON
CFG="$TEST_TMP/auto.md"; printf -- '- consult_dispatch: auto\n' > "$CFG"
STUB="$TEST_TMP/author-refuse.sh"
cat > "$STUB" <<'EOS'
#!/usr/bin/env bash
printf '{ "runner": "agy", "model": "minimax-m3", "status": "precondition_failed", "raw_log": null, "error": "active session-mode=l5 blocks non-strict dispatch (repo=/x/y). To run a non-strict dispatch in this session, prefix that one command with: AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)", "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 2
EOS
chmod +x "$STUB"
LC="$TEST_TMP/consult-ledger.jsonl"
for _ in 1 2; do
  REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" bash "$REPO_ROOT/scripts/dispatch-consult.sh" \
    --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB" --ladder-receipt "$LC" \
    --ladder-terms dead --ladder-unknown-type why --ladder-signals S1 --ladder-work-unit cw >/dev/null 2>&1
done
CAUSES="$(node -e 'const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(r=>r.kind==="ladder");process.stdout.write(rows.map(r=>r.reason+"|"+r.cause).join("\n"))' "$LC")"
assert_eq "$CAUSES" "rail-failed|precondition_failed: active session-mode=l5 blocks non-strict dispatch
rail-failed|precondition_failed: active session-mode=l5 blocks non-strict dispatch" "(b) dispatch-consult writes the refusal cause on each rail-failed row"
node "$LEDGER" append --ledger "$LC" --kind hypothesis --json '{"hypothesis_id":"cwa","text":"x","status":"refuted","work_unit":"cw"}' >/dev/null
node "$LEDGER" append --ledger "$LC" --kind hypothesis --json '{"hypothesis_id":"cwb","text":"y","status":"refuted","work_unit":"cw"}' >/dev/null
OUT="$(node "$PROBE" classify --ledger "$LC" --work-unit cw "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field reason)" "repeated-refusal" "(b) end to end: two consult refusals stop the ladder"

# the cause is cut only at " (" or ". " -- a dot inside a token (resolved_engine.model vs .runner) is not a cut
STUB2="$TEST_TMP/author-refuse2.sh"
cat > "$STUB2" <<'EOS'
#!/usr/bin/env bash
printf '{ "runner": "agy", "model": "m", "status": "precondition_failed", "raw_log": null, "error": "%s", "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n' "$STUB_ERR"
exit 2
EOS
chmod +x "$STUB2"
LD="$TEST_TMP/consult-ledger-dot.jsonl"
consult_once() { # <err>
  STUB_ERR="$1" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_TOPOLOGY_FILE="$TOPO" bash "$REPO_ROOT/scripts/dispatch-consult.sh" \
    --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$STUB2" --ladder-receipt "$LD" \
    --ladder-terms dead --ladder-unknown-type why --ladder-signals S1 --ladder-work-unit dw >/dev/null 2>&1
}
consult_once 'resolved_engine.model is unavailable (repo=/x). hint one'
consult_once 'resolved_engine.runner is unavailable (repo=/y). hint two'
DOTC="$(node -e 'const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(r=>r.kind==="ladder");process.stdout.write(rows.map(r=>r.cause).join("|"))' "$LD")"
assert_eq "$DOTC" "precondition_failed: resolved_engine.model is unavailable|precondition_failed: resolved_engine.runner is unavailable" "(b) cause keeps dotted tokens and drops only the ' (' / '. ' tails"
node "$LEDGER" append --ledger "$LD" --kind hypothesis --json '{"hypothesis_id":"dwa","text":"x","status":"refuted","work_unit":"dw"}' >/dev/null
node "$LEDGER" append --ledger "$LD" --kind hypothesis --json '{"hypothesis_id":"dwb","text":"y","status":"refuted","work_unit":"dw"}' >/dev/null
OUT="$(node "$PROBE" classify --ledger "$LD" --work-unit dw "${PIN[@]}")"
assert_eq "$(printf '%s' "$OUT" | field recommend)" "U2" "(b) .model vs .runner refusals are different causes: the ladder still climbs"

# --- (c) dispatch-model-guard brief lint: warn, never block --------------------------------------
mkpayload() { # <prompt text, with \n escapes already JSON-encoded>
  printf '{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"Engine: sonnet\\n%s"},"hook_event_name":"PreToolUse","cwd":"%s"}' "$1" "$TEST_TMP"
}
BAD="$(mkpayload 'Run node scripts/session-mode.js set --level l5 --size S --repo-root . then bash scripts/dispatch-author.sh --runner codex --prompt-file p.txt')"
run_hook dispatch-model-guard.js "$BAD"
assert_eq "$__RUN_EXIT" 0 "(c) bad brief: hook exits 0 (advisory)"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "(c) bad brief: warning delivered as additionalContext"
assert_contains "$__RUN_STDOUT" 'AUTOPILOT_SESSION_MODE_DIR=$(mktemp -d)' "(c) bad brief: the warning carries the mask line"
assert_not_contains "$__RUN_STDOUT" 'permissionDecision' "(c) bad brief: never a deny/ask"
BAD6="$(mkpayload 'session-mode set --level l6 --size M and later dispatch-consult.sh --question-file q')"
run_hook dispatch-model-guard.js "$BAD6"
assert_contains "$__RUN_STDOUT" '"additionalContext"' "(c) l6 + dispatch-consult is flagged too"
GOOD1="$(mkpayload 'Run node scripts/session-mode.js set --level l5 --size S --repo-root . then dispatch-hetero.sh --strict-contract --contract-file c.json')"
run_hook dispatch-model-guard.js "$GOOD1"
assert_eq "$__RUN_STDOUT" "" "(c) l5 marker with only a strict/hetero dispatch is not flagged"
GOOD2="$(mkpayload 'Run bash scripts/dispatch-author.sh --runner codex --prompt-file p.txt (no marker involved)')"
run_hook dispatch-model-guard.js "$GOOD2"
assert_eq "$__RUN_STDOUT" "" "(c) a non-strict dispatch without an l5/l6 marker is not flagged"
GOOD3="$(mkpayload 'Run node scripts/session-mode.js set --level l3 --size S then dispatch-author.sh')"
run_hook dispatch-model-guard.js "$GOOD3"
assert_eq "$__RUN_STDOUT" "" "(c) an l3 marker is not flagged"

finalize_test
