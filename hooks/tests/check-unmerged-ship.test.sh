#!/usr/bin/env bash
# scripts/check-unmerged-ship.js + hooks/unmerged-ship-advisory.js: a SHIP-AS-IS head that is not in origin/develop after
# the max age is flagged once, appends a blocked line to its fleet task, and the Stop hook fires it throttled.
# Temp repos, temp ledgers, fake dispatch manifests and a PATH `fleet` shim only; the real fleet is never called.
. "$(dirname "$0")/lib.sh"

CHECK="$REPO_ROOT/scripts/check-unmerged-ship.js"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/no-config.json"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
unset AUTOPILOT_FLEET_ADDRESS AUTOPILOT_UNMERGED_SHIP AUTOPILOT_EVENTS_REVIEW_LEDGERS
OWNER="ns/cx/merge-lane--claude"; export FLEET_ADDRESS="$OWNER@sess-0123"
NOW="2026-11-15T12:00:00Z"
TASK="01JABCDEFGHJKMNPQRSTVWXYZ0"

# fleet shim: records one argv element per line
SHIM="$TEST_TMP/shim"; mkdir -p "$SHIM"
FLEET_LOG="$TEST_TMP/fleet.argv"
cat > "$SHIM/fleet" <<EOF
#!/usr/bin/env bash
{ echo "CALL"; for a in "\$@"; do echo "\$a"; done; } >> "$FLEET_LOG"
if [ "\$1" = whoami ]; then
  [ -f "$TEST_TMP/shim-whoami-cli" ] && { echo "courier socket mismatch" >&2; echo "address:   cookys/aimax395-team/fleet-cli   (this CLI's identity; replies land in fleet inbox)"; exit 0; }
  exit 1
fi
[ -f "$TEST_TMP/shim-invalid" ] && { echo "blocked_on_invalid: bad target" >&2; exit 2; }
[ -f "$TEST_TMP/shim-fail" ] && { echo "boom" >&2; exit 3; }
exit 0
EOF
chmod +x "$SHIM/fleet"
export PATH="$SHIM:$PATH"
fleet_calls() { [ -f "$FLEET_LOG" ] && grep -c '^CALL$' "$FLEET_LOG" || echo 0; }

# repos: bare origin, a work clone with develop pushed
BARE="$TEST_TMP/origin.git"; WORK="$TEST_TMP/work"
git init -q --bare "$BARE"
git clone -q "$BARE" "$WORK" 2>/dev/null
git -C "$WORK" config user.email t@t; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b develop
printf 'base\n' > "$WORK/a.txt"; git -C "$WORK" add -A; git -C "$WORK" commit -qm base
git -C "$WORK" push -q origin develop 2>/dev/null
BASE="$(git -C "$WORK" rev-parse HEAD)"
mkbranch() { # <name> <file> -> prints head sha; leaves develop checked out
  git -C "$WORK" checkout -q -b "$1" develop
  printf '%s\n' "$1" > "$WORK/$2"; git -C "$WORK" add -A; git -C "$WORK" commit -qm "$1 one"
  printf '%s two\n' "$1" >> "$WORK/$2"; git -C "$WORK" commit -qam "$1 two"
  git -C "$WORK" rev-parse HEAD
  git -C "$WORK" checkout -q develop
}
mkledger() { # <dir> <head> <finalized_at> <verdict> <fleet_task|none>
  node -e '
    const fs = require("fs"), path = require("path");
    const [dir, head, fin, verdict, task] = process.argv.slice(1);
    const ph = path.join(dir, "review-P1"); fs.mkdirSync(path.join(ph, "g1"), { recursive: true });
    const d = JSON.stringify({ schema_version: 1, phase: "P1", generation: 1, dispositions: [] });
    fs.writeFileSync(path.join(ph, "g1", "dispositions.json"), d);
    const entry = { generation: 1, base: process.env.BASE, head, seats: [{ id: "s1", status: "reviewed" }], reviewed_seats: 1, total_seats: 1,
      status: "finalized", collected_at: fin, finalized_at: fin, dispositions_path: "review-P1/g1/dispositions.json",
      dispositions_sha256: require("crypto").createHash("sha256").update(d).digest("hex") };
    if (task !== "none") entry.fleet_task = task;
    fs.writeFileSync(path.join(ph, "chain.json"), JSON.stringify([entry]));
    fs.writeFileSync(path.join(dir, "phase-P1.base"), process.env.BASE + "\n");
    fs.writeFileSync(path.join(dir, "receipt-P1.json"), JSON.stringify({ kind: "review", phase: "P1", phase_base_sha: process.env.BASE, chain: [entry], verdict, open_findings: [] }));
  ' "$@"
}
export BASE
jq_state() { node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.items.map(i=>i.state+":"+i.source+":"+i.age_min).join(","))' "$1"; }
run_check() { env -u AUTOPILOT_SESSION_ID node "$CHECK" --repo "$WORK" --now "$NOW" "$@" 2>"$TEST_TMP/check.err"; }

# 1. verdict 2h old, head not in origin/develop -> exit 1, unmerged; --notify marks the task once
H1="$(mkbranch feat1 f1.txt)"
mkledger "$TEST_TMP/led1" "$H1" "2026-11-15T10:00:00Z" SHIP-AS-IS "$TASK"
OUT="$(run_check --review-ledger "$TEST_TMP/led1" --json)"; RC=$?
assert_eq "1" "$RC" "2h-old unmerged SHIP-AS-IS exits 1"
assert_eq "unmerged:review:120" "$(jq_state "$OUT")" "item is unmerged, source review, 120 min"
assert_contains "$OUT" '"schema":"autopilot.unmerged-ship/1"' "json schema tag"
assert_contains "$OUT" "\"fleet_task\":\"$TASK\"" "item carries the fleet task"
OUT="$(run_check --review-ledger "$TEST_TMP/led1" --notify)"; RC=$?
assert_eq "1" "$RC" "--notify still exits 1"
assert_contains "$OUT" "unmerged-ship: ${H1:0:12} reviewed SHIP-AS-IS 120m ago" "--notify prints the alert line"
assert_eq "1" "$(fleet_calls)" "fleet shim called once"
assert_eq "$(printf 'CALL\ntask\nprogress\n%s\nblocked\n--blocked-on\n%s\nunmerged feat1 %s' "$TASK" "$OWNER" "${H1:0:12}")" "$(cat "$FLEET_LOG")" "exact argv: task progress blocked --blocked-on owner, note unmerged <branch> <sha12>"
OUT="$(run_check --review-ledger "$TEST_TMP/led1" --notify)"
assert_eq "" "$OUT" "second --notify prints nothing for the same head"
assert_eq "1" "$(fleet_calls)" "second --notify does not call fleet again"

# 1b.  a failing fleet leaves the head un-deduped and the next run retries
H1B="$(mkbranch feat1b f1b.txt)"
mkledger "$TEST_TMP/led1b" "$H1B" "2026-11-15T10:00:00Z" SHIP-AS-IS "$TASK"
run_check --review-ledger "$TEST_TMP/led1b" --notify >/dev/null
assert_eq "2" "$(fleet_calls)" "task progress called for the second head"
H1C="$(mkbranch feat1c f1c.txt)"
mkledger "$TEST_TMP/led1c" "$H1C" "2026-11-15T10:00:00Z" SHIP-AS-IS "$TASK"
touch "$TEST_TMP/shim-fail"
OUT="$(run_check --review-ledger "$TEST_TMP/led1c" --notify)"
assert_eq "3" "$(fleet_calls)" "failing fleet: update attempted"
assert_eq "" "$OUT" "failing fleet: no alert recorded as notified"
assert_contains "$(cat "$TEST_TMP/check.err")" "fleet task progress failed" "failing fleet: one stderr line"
OUT="$(run_check --review-ledger "$TEST_TMP/led1c" --notify)"
assert_eq "4" "$(fleet_calls)" "failing fleet: next run calls fleet again (not deduped)"
rm -f "$TEST_TMP/shim-fail"
OUT="$(run_check --review-ledger "$TEST_TMP/led1c" --notify)"
assert_eq "5" "$(fleet_calls)" "fleet back: retry succeeds"
assert_contains "$OUT" "unmerged-ship: ${H1C:0:12}" "fleet back: alert printed"
OUT="$(run_check --review-ledger "$TEST_TMP/led1c" --notify)"
assert_eq "5" "$(fleet_calls)" "after success: deduped"

# 1c. fleet refuses the target (blocked_on_invalid): no dedupe, one stderr line, retried next run
H1D="$(mkbranch feat1d f1d.txt)"
mkledger "$TEST_TMP/led1d" "$H1D" "2026-11-15T10:00:00Z" SHIP-AS-IS "$TASK"
touch "$TEST_TMP/shim-invalid"
BEFORE="$(fleet_calls)"
OUT="$(run_check --review-ledger "$TEST_TMP/led1d" --notify)"
assert_eq "" "$OUT" "blocked_on_invalid: no alert recorded as notified"
assert_eq "1" "$(grep -c 'blocked_on_invalid' "$TEST_TMP/check.err")" "blocked_on_invalid: exactly one stderr line"
OUT="$(run_check --review-ledger "$TEST_TMP/led1d" --notify)"
assert_eq "$((BEFORE + 2))" "$(fleet_calls)" "blocked_on_invalid: not deduped, next run calls fleet again"
rm -f "$TEST_TMP/shim-invalid"

# 1d. no FLEET_ADDRESS and whoami reports the CLI identity: no mark, one stderr line, not deduped
H1E="$(mkbranch feat1e f1e.txt)"
mkledger "$TEST_TMP/led1e" "$H1E" "2026-11-15T10:00:00Z" SHIP-AS-IS "$TASK"
touch "$TEST_TMP/shim-whoami-cli"; BEFORE="$(grep -c '^progress$' "$FLEET_LOG")"
OUT="$(env -u FLEET_ADDRESS bash -c '. /dev/null; node "$0" --repo "$1" --now "$2" --review-ledger "$3" --notify 2>"$4"' "$CHECK" "$WORK" "$NOW" "$TEST_TMP/led1e" "$TEST_TMP/check.err")"
assert_eq "" "$OUT" "cli-identity whoami: no alert recorded"
assert_eq "$BEFORE" "$(grep -c '^progress$' "$FLEET_LOG")" "cli-identity whoami: no task progress call"
assert_contains "$(cat "$TEST_TMP/check.err")" "own fleet address unknown" "cli-identity whoami: one stderr line"
rm -f "$TEST_TMP/shim-whoami-cli"

# 2. verdict 30 min old -> exit 0
H2="$(mkbranch feat2 f2.txt)"
mkledger "$TEST_TMP/led2" "$H2" "2026-11-15T11:30:00Z" SHIP-AS-IS "$TASK"
OUT="$(run_check --review-ledger "$TEST_TMP/led2" --json)"; RC=$?
assert_eq "0" "$RC" "30m-old verdict is not an alert"
assert_eq "unmerged:review:30" "$(jq_state "$OUT")" "still listed as unmerged, below the max age"

# 3. ancestor of origin/develop -> merged
H3="$(mkbranch feat3 f3.txt)"
git -C "$WORK" merge -q --no-ff "$H3" -m "merge feat3" 2>/dev/null; git -C "$WORK" push -q origin develop 2>/dev/null; git -C "$WORK" fetch -q origin
mkledger "$TEST_TMP/led3" "$H3" "2026-11-15T09:00:00Z" SHIP-AS-IS none
OUT="$(run_check --review-ledger "$TEST_TMP/led3" --json)"; RC=$?
assert_eq "0" "$RC" "merged head exits 0"
assert_eq "merged:review:180" "$(jq_state "$OUT")" "ancestor head is merged"

# 3b. squash re-land: same net patch, different sha
H4="$(mkbranch feat4 f4.txt)"
git -C "$WORK" merge -q --squash "$H4" 2>/dev/null; git -C "$WORK" commit -qm "squash feat4"; git -C "$WORK" push -q origin develop 2>/dev/null; git -C "$WORK" fetch -q origin
mkledger "$TEST_TMP/led4" "$H4" "2026-11-15T09:00:00Z" SHIP-AS-IS none
OUT="$(run_check --review-ledger "$TEST_TMP/led4" --json)"; RC=$?
assert_eq "0" "$RC" "squash re-landed head exits 0"
assert_eq "merged:review:180" "$(jq_state "$OUT")" "squash re-land counts as merged"

# 4. FIX-THEN-SHIP is ignored
H5="$(mkbranch feat5 f5.txt)"
mkledger "$TEST_TMP/led5" "$H5" "2026-11-15T09:00:00Z" FIX-THEN-SHIP none
OUT="$(run_check --review-ledger "$TEST_TMP/led5" --json)"; RC=$?
assert_eq "0" "$RC" "FIX-THEN-SHIP exits 0"
assert_eq "" "$(jq_state "$OUT")" "FIX-THEN-SHIP produces no item"

# 5. single-seat dispatch-review run: a manifest of the shape scripts/dispatch-review.sh writes
H6="$(mkbranch feat6 f6.txt)"
REAL_WORK="$(cd "$WORK" && pwd -P)"
IDENT="git-common-dir:$(cd "$WORK" && realpath "$(git rev-parse --git-common-dir)")"
node -e '
  const [file, head, root, ident, task] = process.argv.slice(1);
  const ended = Date.parse("2026-11-15T10:00:00Z") / 1000;
  require("fs").writeFileSync(file, JSON.stringify({ schema: 1, run_id: "review-1-2-abcd", role: "reviewer", runner: "grok", model: "m",
    started_epoch: ended - 60, ended_at: "2026-11-15T10:00:00Z", ended_epoch: ended, final_status: "reviewed", repo_identity: ident,
    repo_identity_source: "consuming_repo_root", fleet_task: task, pool: null, commit: null, verdict: "SHIP-AS-IS", head, repo_root: root }));
' "$AUTOPILOT_DISPATCH_RUNS_DIR/review-1-2-abcd.manifest.json" "$H6" "$REAL_WORK" "$IDENT" "$TASK"
OUT="$(run_check --json)"; RC=$?
assert_eq "1" "$RC" "single-seat manifest SHIP-AS-IS head yields an alert"
assert_eq "unmerged:dispatch:120" "$(jq_state "$OUT")" "item comes from the dispatch manifest"

# 6. head object missing from the repo -> unknown, no alert
node -e '
  const f = process.argv[1]; const m = JSON.parse(require("fs").readFileSync(f, "utf8"));
  m.head = "0123456789abcdef0123456789abcdef01234567"; require("fs").writeFileSync(f, JSON.stringify(m));
' "$AUTOPILOT_DISPATCH_RUNS_DIR/review-1-2-abcd.manifest.json"
OUT="$(run_check --json)"; RC=$?
assert_eq "0" "$RC" "missing head object exits 0"
assert_eq "unknown:dispatch:120" "$(jq_state "$OUT")" "missing head object is unknown"
rm -f "$AUTOPILOT_DISPATCH_RUNS_DIR/review-1-2-abcd.manifest.json"

# 7. usage error
env -u AUTOPILOT_SESSION_ID node "$CHECK" --bogus >/dev/null 2>&1; assert_eq "2" "$?" "unknown flag exits 2"

# 8. Stop hook: alert -> advisory queue; second Stop within 15 min does not re-scan; opt-out is silent
# the hook has no --now: its ledger carries a verdict 2h before the real clock
HOOK_FIN="$(node -e 'process.stdout.write(new Date(Date.now()-2*3600*1000).toISOString())')"
mkledger "$TEST_TMP/ledh" "$H1B" "$HOOK_FIN" SHIP-AS-IS none
export AUTOPILOT_EVENTS_REVIEW_LEDGERS="$TEST_TMP/ledh"
QDIR="$AUTOPILOT_LIVE_DIR/advisory-queue"
payload() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$1" "$WORK"; }
reset_notices() { rm -rf "$AUTOPILOT_LIVE_DIR/unmerged-ship"/notified-* "$QDIR"; }
reset_notices
run_hook unmerged-ship-advisory.js "$(payload hs1)"
assert_eq "0" "$__RUN_EXIT" "hook exits 0"
assert_contains "$__RUN_STDERR" "unmerged-ship: ${H1B:0:12} reviewed SHIP-AS-IS" "hook prints the alert"
assert_contains "$(cat "$QDIR/hs1.jsonl" 2>/dev/null)" "unmerged-ship-advisory" "alert reaches the advisory queue (additionalContext on the next prompt)"
assert_not_contains "$__RUN_STDOUT" '"decision"' "hook never emits a Stop decision"
reset_notices
run_hook unmerged-ship-advisory.js "$(payload hs1)"
assert_eq "" "$__RUN_STDERR" "second Stop in 15 min is throttled: no re-scan, no output"
assert_file_absent "$QDIR/hs1.jsonl" "throttled Stop enqueues nothing"
run_hook unmerged-ship-advisory.js "$(payload hs2)"
assert_contains "$__RUN_STDERR" "unmerged-ship:" "a new session scans again"
reset_notices
AUTOPILOT_UNMERGED_SHIP=false run_hook unmerged-ship-advisory.js "$(payload hs3)"
assert_eq "" "$__RUN_STDERR$__RUN_STDOUT" "AUTOPILOT_UNMERGED_SHIP=false: no output"
assert_file_absent "$QDIR/hs3.jsonl" "opt-out enqueues nothing"
printf '{"unmerged_ship":{"enabled":false}}' > "$AUTOPILOT_CONFIG_FILE"
run_hook unmerged-ship-advisory.js "$(payload hs4)"
assert_eq "" "$__RUN_STDERR$__RUN_STDOUT" "unmerged_ship.enabled=false: no output"
rm -f "$AUTOPILOT_CONFIG_FILE"
printf '{"session_id":"hs5","cwd":"%s","hook_event_name":"Stop"}' "$TEST_TMP" > "$TEST_TMP/p5.json"
run_hook unmerged-ship-advisory.js "$(cat "$TEST_TMP/p5.json")"
assert_eq "" "$__RUN_STDERR$__RUN_STDOUT" "cwd that is not a git repo: no output"

finalize_test
