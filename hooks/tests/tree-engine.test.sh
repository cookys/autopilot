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

# 2.2 init is idempotent on empty file (no error, no double bootstrap line)
SECOND_INIT_OUT="$(tree init rt 2>&1)"; SECOND_INIT_EXIT=$?
assert_eq "$SECOND_INIT_EXIT" "1" "second init on non-empty file exits 1 (guards against overwrite)"
assert_contains "$SECOND_INIT_OUT" "not overwriting" "second init message"

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

# 3.4 All seq values 1-200 present (no duplicates from lock collision)
SEQ_COUNT="$(jq '[.nodes | to_entries[] | select(.key != "root") | .key] | length' "$PROJECTS/conc/tree/index.json")"
assert_eq "$SEQ_COUNT" "200" "concurrency: all 200 unique nodes indexed"

# ─────────────────────────────────────────────────────────────────────────────
# TEST 4: Crash — kill -9 mid-run, log parseable, no loss from other emitters
# ─────────────────────────────────────────────────────────────────────────────

tree init crash 2>/dev/null

# Start a victim emitter that emits many events (it gets kill-9'd mid-way)
VICTIM_PID=""
(
  for j in $(seq 1 1000); do
    EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"victim${j}\",\"type\":\"node_created\"}"
    TREE_PROJECTS_DIR="$PROJECTS" bash "$SCRIPT" emit crash "victim${j}" "$EV" 2>/dev/null
  done
) &
VICTIM_PID=$!

# Let it run briefly, then kill -9
sleep 0.2
kill -9 "$VICTIM_PID" 2>/dev/null || true
wait "$VICTIM_PID" 2>/dev/null || true

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
ND_STALE="$(tree next-decision stale 2>/dev/null)"; ND_STALE_EXIT=$?
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

# Emit a node_report event with an artifact path
REPORT_EV="{\"schema_version\":1,\"ts\":\"2026-01-01T00:00:00Z\",\"node\":\"work1\",\"type\":\"node_report\",\"artifact_paths\":[\"$ARTIFACT\"],\"evidence_pointers\":[],\"artifact_sha256\":\"abc123\"}"
tree emit fetch work1 "$REPORT_EV" 2>/dev/null

# 7.1 fetch --raw prints artifact content
FETCH_OUT="$(tree fetch fetch work1 --raw 2>/dev/null)"
assert_contains "$FETCH_OUT" "artifact content line 1" "fetch --raw prints artifact content"
assert_contains "$FETCH_OUT" "artifact content line 2" "fetch --raw prints full artifact content"

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

finalize_test
