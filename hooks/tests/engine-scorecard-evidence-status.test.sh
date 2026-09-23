#!/usr/bin/env bash
# engine-scorecard-evidence-status.test.sh — `engine-scorecard.js current` on evidence-backed rows.
#
# Fixture = three real reviewer rows from the 2026-08-20 exam round (model names and hashes only):
#   gpt-5.6-sol / codex                qualified, evidence now past expires_at   (control)
#   GLM-5.3 / anthropic-compatible     failed (40/42), evidence `degraded`, past expires_at
#   Gemini-3.7-Flash-High / agy        qualified requalification (evidence `supersedes` an earlier record)
# Two defects this pins (2026-09-24):
#   1. the agy row crashed `current --role reviewer` (the embedded record was lineage-checked alone,
#      where its predecessor cannot be present) — and resolve-dispatch-topology.js read that crash as
#      "no reviewer candidates";
#   2. every expired non-revoked record is `stale`, and deriveStatus read every stale receipt as
#      qualified — so the failed GLM-5.3 exam read as admitted once it expired.
. "$(dirname "$0")/lib.sh"

export ENGINE_SCORECARD_DIR="$TEST_TMP/scorecard"
mkdir -p "$ENGINE_SCORECARD_DIR"
cp "$REPO_ROOT/hooks/tests/fixtures/scorecard-evidence-status/scorecard.jsonl" "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

OUT="$(node "$REPO_ROOT/scripts/engine-scorecard.js" current --role reviewer 2>"$TEST_TMP/err")"
RC=$?
assert_eq "$RC" "0" "current --role reviewer does not crash on a requalified evidence row ($(head -c 200 "$TEST_TMP/err"))"

seat() {
  # print "<status> <admission_status>" for engine $1
  printf '%s' "$OUT" | node -e '
let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
  let rows = []; try { rows = JSON.parse(s); } catch { }
  const r = rows.find((x) => x.engine === process.argv[1]);
  process.stdout.write(r ? `${r.status} ${r.admission_status}` : "absent");
});' "$1"
}

assert_eq "$(seat GLM-5.3)" "failed no_record" \
  "an expired FAILED exam is not admitted (stale must not read as qualified)"
assert_eq "$(seat gpt-5.6-sol)" "provisional qualified" \
  "an expired QUALIFICATION keeps its standing (advisory expiry, calendar tooth pulled 2026-08-22)"
assert_eq "$(seat Gemini-3.7-Flash-High)" "provisional qualified" \
  "a requalified row is evaluated and admitted"

finalize_test "engine-scorecard-evidence-status"
