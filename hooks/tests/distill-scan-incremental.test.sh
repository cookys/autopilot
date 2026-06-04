#!/usr/bin/env bash
# distill-scan.js — incremental cursor correctness.
# The cursor's whole promise is "skip already-processed sessions WITHOUT changing the counts":
#   1. incremental cumulative totals must EQUAL a stateless full scan (value gate unchanged)
#   2. an unchanged session must be reused from cache, not re-scanned
#   3. a NEW session must be (re)scanned and surfaced by --new-only; untouched candidates must not
. "$(dirname "$0")/lib.sh"

SCAN="$REPO_ROOT/scripts/distill-scan.js"
assert_file_exists "$SCAN" "scanner present"

# --- fixture: a fake ~/.claude/projects tree with one session whose command sequence
#     repeats git add → git commit → git log 3× so the trigram crosses the ≥3× gate ---
ROOT="$TEST_TMP/projects"
PROJ="$ROOT/-home-cookys-projects-demo"
mkdir -p "$PROJ"
emit_session() {  # emit_session <file> <repeats>
  local f="$1" n="$2" i
  : > "$f"
  printf '%s\n' '{"type":"user","cwd":"/home/cookys/projects/demo","message":{"content":"please ship it"}}' >> "$f"
  for ((i = 0; i < n; i++)); do
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git add -A"}}]}}' >> "$f"
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m wip"}}]}}' >> "$f"
    printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git log --oneline"}}]}}' >> "$f"
  done
}
emit_session "$PROJ/sessionA.jsonl" 3

STATE="$TEST_TMP/scan-state.json"
run_scan() { DISTILL_SCAN_ROOT="$ROOT" node "$SCAN" "$@" 2>/dev/null; }

# --- 1. parity: full scan vs incremental cold run must agree on the trigram count ---
full="$(run_scan --json)"
incr1="$(run_scan --json --incremental --state "$STATE")"
get_tri() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).top_trigrams.find(r=>r[0]==="git add → git commit → git log");process.stdout.write(String(a?a[1]:0))})'; }
assert_eq "$(get_tri "$full")" "3" "full scan sees the trigram 3×"
assert_eq "$(get_tri "$incr1")" "$(get_tri "$full")" "incremental cumulative == full scan (value gate intact)"
assert_file_exists "$STATE" "cursor state file written"

# --- 2. warm run: nothing changed → 0 rescanned, session reused from cache ---
warm="$(run_scan --json --incremental --state "$STATE")"
cursor_field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s).cursor["'"$2"'"]))})'; }
assert_eq "$(cursor_field "$warm" rescanned)" "0" "warm run re-scans nothing"
assert_neq "$(cursor_field "$warm" reused)" "0" "warm run reuses cached session"

# --- 3. a NEW session appears → --new-only surfaces only the freshly-crossed candidate ---
emit_session "$PROJ/sessionB.jsonl" 3
newrun="$(run_scan --json --new-only --state "$STATE")"
assert_eq "$(cursor_field "$newrun" rescanned)" "1" "new-only re-scans exactly the new session"
# sessionB pushes the cumulative trigram from 3→6: it ROSE this run, so --new-only keeps it
assert_eq "$(get_tri "$newrun")" "6" "cumulative trigram now 6× and reported as risen"

# --- 4. re-running --new-only with no change → candidate no longer 'new' (delta empty) ---
quiet="$(run_scan --json --new-only --state "$STATE")"
assert_eq "$(get_tri "$quiet")" "0" "unchanged candidate drops out of --new-only delta"

finalize_test
