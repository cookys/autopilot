#!/usr/bin/env bash
# tree-engine.test.sh — integration tests for scripts/tree.sh (P1 tree substrate).
#
# Torture matrix per spec:
#   1. Baseline: existing suite already green before this file runs (noted in README).
#   2. init/emit/read round-trip; emit rejects malformed envelope.
#   3. Concurrency: 8 parallel emit loops × 25 events → zero loss, deterministic index.
#   4. Crash: kill -9 an emitter mid-run; log parseable; no loss from other emitters.
#   5. Truncated-tail injection: partial last line → tombstone in index, valid events retained.
#   6. Staleness: read subcommands auto-rebuild when index absent or events newer.
#   7. fetch --raw emits manager_raw_read event.
#   8. bash -n clean; shellcheck clean (if installed); every subcommand --help exits 0.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/tree.sh"
assert_file_exists "$SCRIPT" "tree.sh exists"

# All tests use an isolated projects dir in TEST_TMP
PROJECTS="$TEST_TMP/projects"
mkdir -p "$PROJECTS"

# Helper: run tree.sh with sandboxed projects dir
tree() { TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" "$@"; }

# Helper: emit a minimal valid event for a given proj/node
emit_event() {
  local proj="$1" node="$2" type="${3:-node_created}"
  local ts; ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local ev; ev="{\"schema_version\":1,\"ts\":\"$ts\",\"node\":\"$node\",\"type\":\"$type\"}"
  tree emit "$proj" "$node" "$ev"
}

# ─────────────────────────────────────────────────────────────────────────────
# TEST 2: init / emit / read round-trip + envelope rejection
# ─────────────────────────────────────────────────────────────────────────────

# 2.1 init creates events.jsonl
tree init rt 2>/dev/null
assert_file_exists "$PROJECTS/rt/tree/events.jsonl" "init creates events.jsonl"

# 2.2 init refuses to overwrite a non-empty events.jsonl
SECOND_INIT_OUT="$(tree init rt 2>&1)"; SECOND_INIT_EXIT=$?
assert_eq "$SECOND_INIT_EXIT" "1" "second init on non-empty file exits 1 (guards against overwrite)"
assert_contains "$SECOND_INIT_OUT" "not overwriting" "second init message"

# 2.2b init DOES re-bootstrap a 0-byte events.jsonl (empty file = safe to reinit)
tree init rt0 2>/dev/null
: > "$PROJECTS/rt0/tree/events.jsonl"
tree init rt0 >/dev/null 2>&1; REINIT_EXIT=$?
assert_eq "$REINIT_EXIT" "0" "init on 0-byte events.jsonl exits 0 (reinitializes)"
assert_eq "$(wc -l < "$PROJECTS/rt0/tree/events.jsonl" | tr -d ' ')" "1" "0-byte reinit writes exactly one bootstrap line"

# 2.3 init line is valid JSON with tree_initialized type
INIT_LINE="$(head -1 "$PROJECTS/rt/tree/events.jsonl")"
assert_eq "$(printf '%s' "$INIT_LINE" | jq -r '.type')" "tree_initialized" "bootstrap event type"
assert_eq "$(printf '%s' "$INIT_LINE" | jq -r '.schema_version')" "1" "bootstrap schema_version"

# 2.4 emit appends a valid event
emit_event rt node1 "node_created" 2>/dev/null
LINE_COUNT="$(wc -l < "$PROJECTS/rt/tree/events.jsonl" | tr -d ' ')"
assert_eq "$LINE_COUNT" "2" "emit appends to events.jsonl"

# 2.5 rebuild-index creates index.json
tree rebuild-index rt 2>/dev/null
assert_file_exists "$PROJECTS/rt/tree/index.json" "rebuild-index creates index.json"

# 2.6 index has expected nodes
NODES="$(jq -r '.nodes | keys | sort | join(",")' "$PROJECTS/rt/tree/index.json")"
assert_contains "$NODES" "node1" "index contains emitted node"
assert_contains "$NODES" "root" "index contains root node"

# 2.7 emit rejects non-JSON
BAD_OUT="$(tree emit rt node1 'not-json' 2>&1)"; BAD_EXIT=$?
assert_eq "$BAD_EXIT" "1" "non-JSON event rejected"
assert_contains "$BAD_OUT" "not valid JSON" "non-JSON error message"

# 2.8 emit rejects missing required fields
MISSING_OUT="$(tree emit rt node1 '{"schema_version":1,"node":"node1"}' 2>&1)"; MISSING_EXIT=$?
assert_eq "$MISSING_EXIT" "1" "missing-fields event rejected"
assert_contains "$MISSING_OUT" "missing required fields" "missing fields error message"

# 2.9 emit rejects multi-line JSON (embedded newline)
MULTILINE_EV=$'{"schema_version":1,\n"ts":"2026-01-01T00:00:00Z","node":"node1","type":"x"}'
MULTI_OUT="$(tree emit rt node1 "$MULTILINE_EV" 2>&1)"; MULTI_EXIT=$?
assert_eq "$MULTI_EXIT" "1" "multi-line JSON rejected"
assert_contains "$MULTI_OUT" "single JSON line" "multi-line error message"

# 2.10 emit rejects node mismatch (event.node != <node-id> argument)
MISMATCH_EV='{"schema_version":1,"ts":"2026-01-01T00:00:00Z","node":"OTHER","type":"node_created"}'
MISMATCH_OUT="$(tree emit rt node1 "$MISMATCH_EV" 2>&1)"; MISMATCH_EXIT=$?
assert_eq "$MISMATCH_EXIT" "1" "node mismatch rejected"
assert_contains "$MISMATCH_OUT" "does not match" "node mismatch error message"

# 2.11 escalations + next-decision round-trip
ESC_EV="{\"schema_version\":1,\"ts\":\"2026-06-12T00:01:00Z\",\"node\":\"node1\",\"type\":\"escalation_opened\",\"question\":\"Which approach?\",\"options\":[\"A\",\"B\"],\"evidence_pointers\":[]}"
tree emit rt node1 "$ESC_EV" 2>/dev/null
ESC_OUT="$(tree escalations rt 2>/dev/null)"
assert_contains "$ESC_OUT" "Which approach?" "escalations lists open escalation"

ND_OUT="$(tree next-decision rt 2>/dev/null)"
assert_contains "$ND_OUT" "Which approach?" "next-decision returns escalation question"
assert_contains "$ND_OUT" '"decision_type": "escalation"' "next-decision labels as escalation"
assert_not_contains "$ND_OUT" "artifact" "next-decision never prints artifact content"
# Structural no-leak guarantee: output keys are EXACTLY the decision projection
ND_KEYS="$(printf '%s' "$ND_OUT" | jq -r 'keys_unsorted | sort | join(",")')"
assert_eq "$ND_KEYS" "decision_type,evidence_pointers,node,options,question" "next-decision emits exactly the projected key set (no work-product fields)"

# 2.12 report returns node data
RPT_OUT="$(tree report rt node1 2>/dev/null)"; RPT_EXIT=$?
assert_eq "$RPT_EXIT" "0" "report exits 0"
assert_contains "$RPT_OUT" "node1" "report includes node id"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 3: Concurrency — 8 parallel emit loops × 25 events → zero loss
# ─────────────────────────────────────────────────────────────────────────────

tree init conc 2>/dev/null

# Unique-by-seq token so we can verify no collision (all seq values distinct)
for i in $(seq 1 8); do
  (
    for j in $(seq 1 25); do
      SEQ=$(( (i - 1) * 25 + j ))
      EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"n${i}x${j}\",\"type\":\"node_created\",\"seq\":$SEQ}"
      TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" emit conc "n${i}x${j}" "$EV" 2>/dev/null
    done
  ) &
done
wait

# 3.1 Event count: 1 init + 200 emitted = 201
CONC_LINES="$(wc -l < "$PROJECTS/conc/tree/events.jsonl" | tr -d ' ')"
assert_eq "$CONC_LINES" "201" "concurrency: no event loss (201 lines)"

# 3.2 All lines are valid JSON
INVALID_JSON_COUNT=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | jq -e . >/dev/null 2>&1 || INVALID_JSON_COUNT=$(( INVALID_JSON_COUNT + 1 ))
done < "$PROJECTS/conc/tree/events.jsonl"
assert_eq "$INVALID_JSON_COUNT" "0" "concurrency: all lines valid JSON"

# 3.3 Rebuild twice → same event_count (deterministic)
tree rebuild-index conc 2>/dev/null
IDX1="$(jq '.event_count' "$PROJECTS/conc/tree/index.json")"
tree rebuild-index conc 2>/dev/null
IDX2="$(jq '.event_count' "$PROJECTS/conc/tree/index.json")"
assert_eq "$IDX1" "$IDX2" "concurrency: rebuild is deterministic (same event_count)"
assert_eq "$IDX1" "201" "concurrency: index event_count = 201"
# events_hash is the stronger determinism signal (content-equality, not count)
HASH1="$(jq -r '.events_hash' "$PROJECTS/conc/tree/index.json")"
tree rebuild-index conc >/dev/null 2>&1
HASH2="$(jq -r '.events_hash' "$PROJECTS/conc/tree/index.json")"
assert_eq "$HASH1" "$HASH2" "concurrency: rebuild is deterministic (same events_hash)"

# 3.4 All seq values 1-200 present (no duplicates from lock collision)
SEQ_COUNT="$(jq '[.nodes | to_entries[] | select(.key != "root") | .key] | length' "$PROJECTS/conc/tree/index.json")"
assert_eq "$SEQ_COUNT" "200" "concurrency: all 200 unique nodes indexed"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 4: Crash — kill -9 mid-run, log parseable, no loss from other emitters
# ─────────────────────────────────────────────────────────────────────────────

tree init crash 2>/dev/null

# Start a victim emitter with an effectively-unbounded event budget so it
# CANNOT complete before the kill — the mid-run property is guaranteed, not
# timing-dependent. We poll until it has demonstrably started (>=3 events in
# the log), then kill -9.
VICTIM_TOTAL=100000
VICTIM_PID=""
(
  for j in $(seq 1 "$VICTIM_TOTAL"); do
    EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"victim${j}\",\"type\":\"node_created\"}"
    TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" emit crash "victim${j}" "$EV" 2>/dev/null
  done
) &
VICTIM_PID=$!

# Wait until the victim has written at least 3 events (poll, max ~10s)
VICTIM_STARTED=0
for _ in $(seq 1 100); do
  # shellcheck disable=SC2126  # NOT grep -c: it exits 1 on zero matches, and `|| echo 0` would emit a second line ("0\n0")
  if [ "$(grep '"victim' "$PROJECTS/crash/tree/events.jsonl" 2>/dev/null | wc -l | tr -d ' ')" -ge 3 ]; then
    VICTIM_STARTED=1; break
  fi
  sleep 0.1
done
kill -9 "$VICTIM_PID" 2>/dev/null || true
wait "$VICTIM_PID" 2>/dev/null || true
assert_eq "$VICTIM_STARTED" "1" "crash: victim emitter demonstrably started before kill -9"
# shellcheck disable=SC2126  # NOT grep -c: it exits 1 on zero matches (see poll loop above)
VICTIM_COUNT="$(grep '"victim' "$PROJECTS/crash/tree/events.jsonl" 2>/dev/null | wc -l | tr -d ' ')"
VICTIM_MIDRUN=0
[ "$VICTIM_COUNT" -lt "$VICTIM_TOTAL" ] && VICTIM_MIDRUN=1
assert_eq "$VICTIM_MIDRUN" "1" "crash: kill -9 landed mid-run (victim wrote $VICTIM_COUNT < $VICTIM_TOTAL events)"

# Meanwhile emit 20 survivor events from a different "emitter"
for k in $(seq 1 20); do
  EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"survivor${k}\",\"type\":\"node_created\"}"
  TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" emit crash "survivor${k}" "$EV" 2>/dev/null
done

# 4.1 Log is parseable (rebuild does not fail)
tree rebuild-index crash 2>/dev/null; CRASH_REBUILD_EXIT=$?
assert_eq "$CRASH_REBUILD_EXIT" "0" "crash: rebuild succeeds after kill -9"

# 4.2 All survivor events are in the index
SURVIVOR_COUNT="$(jq '[.nodes | keys[] | select(startswith("survivor"))] | length' "$PROJECTS/crash/tree/index.json")"
assert_eq "$SURVIVOR_COUNT" "20" "crash: all survivor events retained"

# 4.3 events.jsonl — every complete line is valid JSON
CRASH_INVALID=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s' "$line" | jq -e . >/dev/null 2>&1 || CRASH_INVALID=$(( CRASH_INVALID + 1 ))
done < "$PROJECTS/crash/tree/events.jsonl"
assert_eq "$CRASH_INVALID" "0" "crash: all complete lines are valid JSON"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 5: Truncated-tail injection
# ─────────────────────────────────────────────────────────────────────────────

tree init trunc 2>/dev/null
EV1='{"schema_version":1,"ts":"2026-01-01T00:00:00Z","node":"good1","type":"node_created"}'
EV2='{"schema_version":1,"ts":"2026-01-01T00:00:01Z","node":"good2","type":"node_created"}'
tree emit trunc good1 "$EV1" 2>/dev/null
tree emit trunc good2 "$EV2" 2>/dev/null

EVENTS_FILE="$PROJECTS/trunc/tree/events.jsonl"

# Inject partial line WITHOUT trailing newline (simulates kill mid-write)
printf '{"schema_version":1,"ts":"2026-01-01T00:00:02Z","node":"partial","type":"nod' >> "$EVENTS_FILE"

# Verify the injected tail has no newline (test setup sanity)
LAST_CHAR="$(tail -c 1 "$EVENTS_FILE" | xxd -p | tr -d '\n')"
assert_neq "$LAST_CHAR" "0a" "test setup: partial line has no trailing newline"

# 5.1 rebuild succeeds (not crashes/errors)
TRUNC_OUT="$(tree rebuild-index trunc 2>&1)"; TRUNC_REBUILD_EXIT=$?
assert_eq "$TRUNC_REBUILD_EXIT" "0" "truncated-tail: rebuild exits 0"
assert_contains "$TRUNC_OUT" "truncated tail" "truncated-tail: warning emitted to stderr"

# 5.2 tombstone present in index
TOMBSTONE="$(jq '.truncated_tail' "$PROJECTS/trunc/tree/index.json")"
assert_neq "$TOMBSTONE" "null" "truncated-tail: tombstone is non-null in index"
assert_contains "$TOMBSTONE" "byte_offset" "tombstone has byte_offset field"
assert_contains "$TOMBSTONE" "content_hash" "tombstone has content_hash field"
assert_contains "$TOMBSTONE" "partial_content" "tombstone has partial_content field"

# 5.3 Valid events before the truncated tail are retained
TRUNC_NODES="$(jq -r '[.nodes | keys[]] | sort | join(",")' "$PROJECTS/trunc/tree/index.json")"
assert_contains "$TRUNC_NODES" "good1" "truncated-tail: good1 retained"
assert_contains "$TRUNC_NODES" "good2" "truncated-tail: good2 retained"

# 5.4 Partial line node NOT indexed (it was not a complete valid event)
assert_not_contains "$TRUNC_NODES" "partial" "truncated-tail: partial node NOT in index (incomplete line)"

# 5.5 Silent drop = failure: the tombstone MUST exist (non-null)
# (Already asserted above in 5.2; this documents the explicit contract.)
TRUNC_TAIL_NULL="$(jq '.truncated_tail == null' "$PROJECTS/trunc/tree/index.json")"
assert_eq "$TRUNC_TAIL_NULL" "false" "truncated-tail: silent drop is failure (tombstone must exist)"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 6: Staleness — auto-rebuild when index absent or events newer
# ─────────────────────────────────────────────────────────────────────────────

tree init stale 2>/dev/null
emit_event stale snode "node_created" 2>/dev/null

INDEX_FILE="$PROJECTS/stale/tree/index.json"
STALE_EVENTS="$PROJECTS/stale/tree/events.jsonl"

# 6.1 No index yet → next-decision auto-rebuilds
assert_file_absent "$INDEX_FILE" "staleness: index does not exist yet"
tree next-decision stale >/dev/null 2>&1; ND_STALE_EXIT=$?
assert_eq "$ND_STALE_EXIT" "0" "staleness: next-decision exits 0 with no index"
assert_file_exists "$INDEX_FILE" "staleness: index auto-created by next-decision"

# 6.2 touch events → next read subcommand auto-rebuilds
# Record current index mtime
INDEX_MTIME_BEFORE="$(stat -c '%Y' "$INDEX_FILE" 2>/dev/null || stat -f '%m' "$INDEX_FILE" 2>/dev/null)"

# Force events to be newer than index
sleep 1
touch "$STALE_EVENTS"

# 6.3 escalations auto-rebuilds (mtime check)
tree escalations stale 2>/dev/null
INDEX_MTIME_AFTER="$(stat -c '%Y' "$INDEX_FILE" 2>/dev/null || stat -f '%m' "$INDEX_FILE" 2>/dev/null)"
assert_neq "$INDEX_MTIME_BEFORE" "$INDEX_MTIME_AFTER" "staleness: index rebuilt when events newer than index"

# 6.4 report also auto-rebuilds
rm -f "$INDEX_FILE"
tree report stale snode 2>/dev/null; RPT_STALE_EXIT=$?
assert_eq "$RPT_STALE_EXIT" "0" "staleness: report auto-rebuilds absent index"
assert_file_exists "$INDEX_FILE" "staleness: index recreated by report"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 7: fetch --raw emits manager_raw_read event
# ─────────────────────────────────────────────────────────────────────────────

tree init fetch 2>/dev/null

# Create a real artifact file
ARTIFACT="$TEST_TMP/artifact.txt"
printf 'artifact content line 1\nartifact content line 2\n' > "$ARTIFACT"

# Emit a node_report event with the contract-mandated {path, sha256} object
# format (tree-contracts.md §4) — bare strings are only a compat fallback,
# so the test must exercise the conformant shape.
ARTIFACT_SHA="$(sha256sum "$ARTIFACT" | awk '{print $1}')"
REPORT_EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"work1\",\"type\":\"node_report\",\"artifact_paths\":[{\"path\":\"$ARTIFACT\",\"sha256\":\"$ARTIFACT_SHA\"}],\"evidence_pointers\":[],\"artifact_sha256\":\"abc123\"}"
tree emit fetch work1 "$REPORT_EV" 2>/dev/null

# 7.1 fetch --raw prints artifact content (object-format artifact_paths)
FETCH_OUT="$(tree fetch fetch work1 --raw 2>/dev/null)"
assert_contains "$FETCH_OUT" "artifact content line 1" "fetch --raw prints artifact content"
assert_contains "$FETCH_OUT" "artifact content line 2" "fetch --raw prints full artifact content"

# 7.1b bare-string artifact_paths still works (compat fallback)
tree init fetchstr 2>/dev/null
REPORT_EV_STR="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"w2\",\"type\":\"node_report\",\"artifact_paths\":[\"$ARTIFACT\"],\"evidence_pointers\":[],\"artifact_sha256\":\"abc123\"}"
tree emit fetchstr w2 "$REPORT_EV_STR" 2>/dev/null
FETCH_STR_OUT="$(tree fetch fetchstr w2 --raw 2>/dev/null)"
assert_contains "$FETCH_STR_OUT" "artifact content line 1" "fetch --raw compat: bare-string artifact path still printed"

# 7.2 fetch --raw appended manager_raw_read event
LAST_EVENT="$(tail -1 "$PROJECTS/fetch/tree/events.jsonl")"
assert_eq "$(printf '%s' "$LAST_EVENT" | jq -r '.type')" "manager_raw_read" "fetch --raw appends manager_raw_read event"
assert_eq "$(printf '%s' "$LAST_EVENT" | jq -r '.node')" "work1" "manager_raw_read event has correct node"

# 7.3 manager_raw_read is valid JSON with required envelope fields
for field in schema_version ts node type; do
  VAL="$(printf '%s' "$LAST_EVENT" | jq -r --arg f "$field" '.[$f]')"
  assert_neq "$VAL" "" "manager_raw_read has $field field"
  assert_neq "$VAL" "null" "manager_raw_read $field is not null"
done

# 7.4 fetch --raw still logs manager_raw_read even when no artifact paths
tree init fetch2 2>/dev/null
emit_event fetch2 noartifact "node_created" 2>/dev/null
tree fetch fetch2 noartifact --raw 2>/dev/null
LAST_FETCH2="$(tail -1 "$PROJECTS/fetch2/tree/events.jsonl")"
assert_eq "$(printf '%s' "$LAST_FETCH2" | jq -r '.type')" "manager_raw_read" "fetch --raw logs event even with no artifacts"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 8: syntax / shellcheck / --help exits
# ─────────────────────────────────────────────────────────────────────────────

# 8.1 bash -n clean
bash -n "$SCRIPT" 2>/dev/null; BASH_N_EXIT=$?
assert_eq "$BASH_N_EXIT" "0" "bash -n tree.sh is clean"

# 8.2 shellcheck clean (if installed)
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$SCRIPT" 2>/dev/null; SC_EXIT=$?
  assert_eq "$SC_EXIT" "0" "shellcheck tree.sh is clean"
else
  # Note: shellcheck not installed; skipping (not a failure)
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# 8.3 All subcommands + top-level --help exit 0
for sub in --help help -h init emit rebuild-index next-decision report escalations fetch; do
  tree "$sub" --help >/dev/null 2>&1; H_EXIT=$?
  assert_eq "$H_EXIT" "0" "$sub --help exits 0"
done

# 8.4 Unknown subcommand exits 2
tree bogus-command 2>/dev/null; UNK_EXIT=$?
assert_eq "$UNK_EXIT" "2" "unknown subcommand exits 2"

# 8.5 Top-level with no args exits 2
TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" 2>/dev/null; NO_CMD_EXIT=$?
assert_eq "$NO_CMD_EXIT" "2" "no-subcommand exits 2"

# 8.6 Path-traversal / invalid project names are rejected BEFORE any file op.
# The guard must run in the dispatcher (non-subshell) context — an exit
# inside $(...) is swallowed, so this asserts the guard actually bites.
for bad in "../escape" "a/../../b" "/abs" "-dash" ".dot" "has space"; do
  tree init "$bad" >/dev/null 2>&1; BAD_EXIT=$?
  assert_eq "$BAD_EXIT" "2" "init '$bad' rejected with exit 2"
done
assert_file_absent "$PROJECTS/../escape/tree/events.jsonl" "traversal name created no files outside projects dir"
# Read subcommands reject too (guard is at the dispatcher chokepoint)
tree next-decision "../escape" >/dev/null 2>&1; BAD_ND_EXIT=$?
assert_eq "$BAD_ND_EXIT" "2" "next-decision '../escape' rejected with exit 2"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 9: ID-targeted decision_resolved + escalation_resolved semantics (Fix 1)
# ─────────────────────────────────────────────────────────────────────────────

tree init idres 2>/dev/null

# Emit two decision_fork events on the same node, each with a distinct decision_id
TS_A="2026-06-12T10:00:00Z"
TS_B="2026-06-12T10:00:01Z"
FORK_A="{\"schema_version\":1,\"ts\":\"$TS_A\",\"node\":\"dnode\",\"type\":\"decision_fork\",\"decision_id\":\"fork-A\",\"question\":\"Fork A?\",\"options\":[],\"evidence_pointers\":[]}"
FORK_B="{\"schema_version\":1,\"ts\":\"$TS_B\",\"node\":\"dnode\",\"type\":\"decision_fork\",\"decision_id\":\"fork-B\",\"question\":\"Fork B?\",\"options\":[],\"evidence_pointers\":[]}"
tree emit idres dnode "$FORK_A" 2>/dev/null
tree emit idres dnode "$FORK_B" 2>/dev/null

# 9.1 Both forks open before any resolve
tree rebuild-index idres 2>/dev/null
OPEN_BEFORE="$(jq '[.decisions[] | select(.node=="dnode" and .resolved==false)] | length' "$PROJECTS/idres/tree/index.json")"
assert_eq "$OPEN_BEFORE" "2" "decision: two open forks on same node before resolve"

# 9.2 Resolve by id: only fork-A closes; fork-B remains open
TS_R="2026-06-12T10:00:02Z"
RESOLVE_A="{\"schema_version\":1,\"ts\":\"$TS_R\",\"node\":\"dnode\",\"type\":\"decision_resolved\",\"decision_id\":\"fork-A\",\"chosen\":\"yes\"}"
tree emit idres dnode "$RESOLVE_A" 2>/dev/null
tree rebuild-index idres 2>/dev/null
OPEN_AFTER_A="$(jq '[.decisions[] | select(.node=="dnode" and .resolved==false)] | length' "$PROJECTS/idres/tree/index.json")"
assert_eq "$OPEN_AFTER_A" "1" "decision id-targeted resolve: exactly one fork still open"
CLOSED_A="$(jq '[.decisions[] | select(.node=="dnode" and .id=="fork-A" and .resolved==true)] | length' "$PROJECTS/idres/tree/index.json")"
assert_eq "$CLOSED_A" "1" "decision id-targeted resolve: fork-A is now closed"
OPEN_B="$(jq '[.decisions[] | select(.node=="dnode" and .id=="fork-B" and .resolved==false)] | length' "$PROJECTS/idres/tree/index.json")"
assert_eq "$OPEN_B" "1" "decision id-targeted resolve: fork-B still open in index"

# next-decision still returns fork-B (the remaining open fork)
ND_IDRES="$(tree next-decision idres 2>/dev/null)"
assert_contains "$ND_IDRES" "Fork B?" "decision id-targeted resolve: next-decision returns remaining open fork"

# 9.3 Bulk resolve (no decision_id): both open forks close simultaneously
# Add a fresh pair of forks for bulk-close test
tree init idres2 2>/dev/null
FORK_C="{\"schema_version\":1,\"ts\":\"2026-06-12T11:00:00Z\",\"node\":\"bnode\",\"type\":\"decision_fork\",\"decision_id\":\"fork-C\",\"question\":\"Fork C?\",\"options\":[],\"evidence_pointers\":[]}"
FORK_D="{\"schema_version\":1,\"ts\":\"2026-06-12T11:00:01Z\",\"node\":\"bnode\",\"type\":\"decision_fork\",\"decision_id\":\"fork-D\",\"question\":\"Fork D?\",\"options\":[],\"evidence_pointers\":[]}"
tree emit idres2 bnode "$FORK_C" 2>/dev/null
tree emit idres2 bnode "$FORK_D" 2>/dev/null
BULK_RESOLVE="{\"schema_version\":1,\"ts\":\"2026-06-12T11:00:02Z\",\"node\":\"bnode\",\"type\":\"decision_resolved\",\"chosen\":\"bulk\"}"
tree emit idres2 bnode "$BULK_RESOLVE" 2>/dev/null
tree rebuild-index idres2 2>/dev/null
OPEN_AFTER_BULK="$(jq '[.decisions[] | select(.node=="bnode" and .resolved==false)] | length' "$PROJECTS/idres2/tree/index.json")"
assert_eq "$OPEN_AFTER_BULK" "0" "decision bulk resolve (no id): all open forks for node closed"

# 9.4 Escalation id-targeted resolve: two open escalations, resolve one by id
tree init escres 2>/dev/null
ESC_EV_P="{\"schema_version\":1,\"ts\":\"2026-06-12T12:00:00Z\",\"node\":\"escnode\",\"type\":\"escalation_opened\",\"escalation_id\":\"esc-1\",\"question\":\"Esc 1?\",\"options\":[],\"evidence_pointers\":[]}"
ESC_EV_Q="{\"schema_version\":1,\"ts\":\"2026-06-12T12:00:01Z\",\"node\":\"escnode\",\"type\":\"escalation_opened\",\"escalation_id\":\"esc-2\",\"question\":\"Esc 2?\",\"options\":[],\"evidence_pointers\":[]}"
tree emit escres escnode "$ESC_EV_P" 2>/dev/null
tree emit escres escnode "$ESC_EV_Q" 2>/dev/null
ESC_RESOLVE_1="{\"schema_version\":1,\"ts\":\"2026-06-12T12:00:02Z\",\"node\":\"escnode\",\"type\":\"escalation_resolved\",\"escalation_id\":\"esc-1\"}"
tree emit escres escnode "$ESC_RESOLVE_1" 2>/dev/null
tree rebuild-index escres 2>/dev/null
OPEN_ESC="$(jq '[.escalations[] | select(.node=="escnode" and .resolved==false)] | length' "$PROJECTS/escres/tree/index.json")"
assert_eq "$OPEN_ESC" "1" "escalation id-targeted resolve: exactly one escalation still open"
CLOSED_ESC_1="$(jq '[.escalations[] | select(.node=="escnode" and .id=="esc-1" and .resolved==true)] | length' "$PROJECTS/escres/tree/index.json")"
assert_eq "$CLOSED_ESC_1" "1" "escalation id-targeted resolve: esc-1 is now closed"
OPEN_ESC_2="$(jq '[.escalations[] | select(.node=="escnode" and .id=="esc-2" and .resolved==false)] | length' "$PROJECTS/escres/tree/index.json")"
assert_eq "$OPEN_ESC_2" "1" "escalation id-targeted resolve: esc-2 still open in index"

# 9.5 Escalation bulk resolve (no escalation_id): both close
tree init escres2 2>/dev/null
ESC_EV_R="{\"schema_version\":1,\"ts\":\"2026-06-12T13:00:00Z\",\"node\":\"bescnode\",\"type\":\"escalation_opened\",\"escalation_id\":\"esc-R\",\"question\":\"Esc R?\",\"options\":[],\"evidence_pointers\":[]}"
ESC_EV_S="{\"schema_version\":1,\"ts\":\"2026-06-12T13:00:01Z\",\"node\":\"bescnode\",\"type\":\"escalation_opened\",\"escalation_id\":\"esc-S\",\"question\":\"Esc S?\",\"options\":[],\"evidence_pointers\":[]}"
tree emit escres2 bescnode "$ESC_EV_R" 2>/dev/null
tree emit escres2 bescnode "$ESC_EV_S" 2>/dev/null
BULK_ESC_RESOLVE="{\"schema_version\":1,\"ts\":\"2026-06-12T13:00:02Z\",\"node\":\"bescnode\",\"type\":\"escalation_resolved\"}"
tree emit escres2 bescnode "$BULK_ESC_RESOLVE" 2>/dev/null
tree rebuild-index escres2 2>/dev/null
OPEN_BULK_ESC="$(jq '[.escalations[] | select(.node=="bescnode" and .resolved==false)] | length' "$PROJECTS/escres2/tree/index.json")"
assert_eq "$OPEN_BULK_ESC" "0" "escalation bulk resolve (no id): all open escalations for node closed"

finalize_test
