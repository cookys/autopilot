#!/usr/bin/env bash
# close-session.test.sh — `repo-residue-sweep.js close-session` (session close-out) + the branch->session
# ledger (scripts/lib/dispatch-branch-ledger.sh) + ledger compaction under `reap --auto`.
#
# One fixture holds two sessions' branches: S1 merged / unintegrated / checked-out / campaign-held /
# unexpired-lease-pointed, a foreman-owned hand branch (row belongs to S1 only through the foreman's run
# id), a nested hand, S2's unintegrated branch, and a branch with no ledger row. close-session S1 must act
# on exactly the right ones. Two mutants (ownership transitivity, checked-out guard) must change the outcome.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
LIB="$REPO_ROOT/scripts/lib/dispatch-branch-ledger.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.autopilot"
unset AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_RESIDUE_LEASE_HOURS AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS AUTOPILOT_SESSION_ID
NOW="$(date +%s)"
TODAY="$(date -u +%F)"
jx() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v));})' "$2"; }
# stable one-line summary of a close-session report
sig() { jx "$1" '"deleted="+j.deleted.map(x=>x.branch).sort().join(",")+";archived="+j.archived.map(x=>x.branch).sort().join(",")+";kept="+j.kept.map(x=>x.branch+":"+x.why).sort().join(",")'; }

G() { git -C "$SBX" -c user.email=t@t -c user.name=t "$@"; }
ledger_row() { # <branch> <session|null> <run_id> <root_run_id>
  node -e 'process.stdout.write(JSON.stringify({schema:"autopilot.dispatch-branch/1",branch:process.argv[1],session_id:process.argv[2]==="null"?null:process.argv[2],run_id:process.argv[3],root_run_id:process.argv[4],created_at:Number(process.argv[5]),base_sha:process.argv[6]})+"\n")' "$1" "$2" "$3" "$4" "${CREATED:-$NOW}" "$BASE" >> "$SBX/.git/autopilot/dispatch-branches.jsonl"
}
ahead() { # <branch> : branch one commit ahead of BASE, not checked out
  local c; c="$(G commit-tree "$(G rev-parse "$BASE^{tree}")" -p "$BASE" -m "ahead-$1-$RANDOM")"; G update-ref "refs/heads/$1" "$c"
}

# build_fixture <dir> : SBX=<dir>, develop one commit past BASE
build_fixture() {
  SBX="$1"; rm -rf "$SBX"; mkdir -p "$SBX"
  G init -q -b develop; G config core.logAllRefUpdates true
  echo a > "$SBX/a.txt"; G add a.txt; G commit -q -m base; BASE="$(G rev-parse HEAD)"
  echo b > "$SBX/b.txt"; G add b.txt; G commit -q -m second
  printf '.autopilot-worktree\n.autopilot-worktree.lock\n' >> "$SBX/.git/info/exclude"
  mkdir -p "$SBX/.git/autopilot"
  # branches
  G update-ref refs/heads/s1-merged "$BASE"                       # ancestor of develop = integrated
  G update-ref refs/heads/foreman/F1 "$BASE"                      # foreman branch, integrated
  ahead s1-unint; ahead s2-unint; ahead noledger; ahead s1-campaign; ahead s1-leased
  ahead hands/F1/u1; ahead hands/F1/u2
  ahead reuse-s2; ahead reuse-hand; ahead s1-shared; ahead sib-shared
  G worktree add -q "$TEST_TMP/co-$$-$(basename "$SBX")" -b s1-checkedout "$BASE" 2>/dev/null
  git -C "$TEST_TMP/co-$$-$(basename "$SBX")" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "ahead-co"
  # an unexpired-lease marker worktree (on another branch) that names s1-leased
  local lw="$TEST_TMP/lease-$$-$(basename "$SBX")"
  G worktree add -q "$lw" -b lease-holder "$BASE" 2>/dev/null
  printf 'created_at=%s\nbranch=s1-leased\nbase_sha=%s\nrun_id=r-l\nroot_run_id=r-l\nloop_id=r-l\nretention_reason=failure\nretention_expires_at=%s\nschema=2\n' "$NOW" "$BASE" "$((NOW + 100000))" > "$lw/.autopilot-worktree"
  # second marker worktree naming the SAME branch, with an EXPIRED lease, created after the unexpired one
  local lw2="$TEST_TMP/lease2-$$-$(basename "$SBX")"
  G worktree add -q "$lw2" -b lease-holder2 "$BASE" 2>/dev/null
  printf 'created_at=%s\nbranch=s1-leased\nbase_sha=%s\nrun_id=r-l2\nroot_run_id=r-l2\nloop_id=r-l2\nretention_reason=failure\nretention_expires_at=%s\nschema=2\n' "$NOW" "$BASE" "$((NOW - 100))" > "$lw2/.autopilot-worktree"
  # campaign journal: camp-open unresolved
  node -e 'process.stdout.write(JSON.stringify({kind:"journal",op:"campaign_event",payload:JSON.stringify({campaign_id:"camp-open",event:{event_type:"review_started"}})})+"\n")' > "$SBX/.git/autopilot/implementation-campaign.jsonl"
  # ledger. S1 owns: merged, unint, checkedout, campaign, leased, and foreman F1 (run id F1).
  # the nested hand's row comes BEFORE its parent's row, and both before the foreman's: ownership must not depend on order
  ledger_row hands/F1/u2 S9 u2 u1            # nested: owned through root_run_id=u1 (transitive)
  ledger_row hands/F1/u1 null u1 F1          # hand in the foreman's child session: owned through root_run_id=F1
  ledger_row foreman/F1 S1 F1 F1
  ledger_row s1-merged S1 r-m r-m
  ledger_row s1-unint S1 r-u r-u
  ledger_row s1-checkedout S1 r-c r-c
  ledger_row s1-campaign S1 r-camp camp-open
  ledger_row s1-leased S1 r-ls r-ls
  ledger_row s2-unint S2 r-s2 r-s2
  # a name reused: S1's row, then a NEWER row from S2 for the same branch -> the branch is S2's, not S1's
  CREATED=$((NOW - 5)) ledger_row reuse-s2 S1 r-old r-old
  ledger_row reuse-s2 S2 r-new r-new
  # a name re-created by hand long after S1's row (the row is hours older than the live ref) -> stale
  CREATED=$((NOW - 7200)) ledger_row reuse-hand S1 r-rh r-rh
  # root_run_id must not pull in siblings: S3's row shares S1's root but is not S1's
  ledger_row s1-shared S1 r-sh shared-root
  ledger_row sib-shared S3 r-sib shared-root
  # noledger: deliberately no row
}
run_close() { node "${CS_SCRIPT:-$SCRIPT}" close-session --repo "$SBX" "$@"; }
refs_snapshot() { G for-each-ref --format='%(refname) %(objectname)' | sort; }

# ---------------------------------------------------------------- the ledger writer (bash lib)
LT="$TEST_TMP/lt"; mkdir -p "$LT"
append() { bash -c '. "$1"; . "$2"; shift 2; dispatch_branch_ledger_append "$@"' _ "$REPO_ROOT/scripts/lib/json-emit.sh" "$LIB" "$@"; }
CLAUDE_CODE_SESSION_ID=sess-A AUTOPILOT_SESSION_ID=must-not-be-read append "$LT" hands/x/a run-1 root-1 "$(printf 'a%.0s' {1..40})" 2>"$TEST_TMP/err1"
assert_eq "$?" "0" "ledger append: rc 0"
ROW="$(cat "$LT/autopilot/dispatch-branches.jsonl")"
assert_eq "$(jx "$ROW" '[j.schema,j.branch,j.session_id,j.run_id,j.root_run_id,j.base_sha.length,typeof j.created_at].join("|")')" "autopilot.dispatch-branch/1|hands/x/a|sess-A|run-1|root-1|40|number" "ledger row fields; session_id from CLAUDE_CODE_SESSION_ID only"
assert_eq "$(wc -l < "$LT/autopilot/dispatch-branches.jsonl" | tr -d ' ')" "1" "ledger row is exactly one line"
env -u CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID=must-not-be-read bash -c '. "$1"; . "$2"; dispatch_branch_ledger_append "$3" hands/x/b run-2 root-2 deadbeef' _ "$REPO_ROOT/scripts/lib/json-emit.sh" "$LIB" "$LT"
assert_eq "$(jx "$(sed -n 2p "$LT/autopilot/dispatch-branches.jsonl")" 'j.session_id')" "null" "no CLAUDE_CODE_SESSION_ID -> session_id null (AUTOPILOT_SESSION_ID ignored)"
append "$LT" 'hands/we"ird\n' run-3 root-3 abc; assert_eq "$(jx "$(sed -n 3p "$LT/autopilot/dispatch-branches.jsonl")" 'j.branch')" 'hands/we"ird\n' "ledger row escapes JSON specials"
# fail-open: a FILE where the autopilot dir should be -> one stderr line, rc 0
mkdir -p "$TEST_TMP/lt2"; : > "$TEST_TMP/lt2/autopilot"
ERR="$(append "$TEST_TMP/lt2" hands/y run-4 root-4 abc 2>&1 >/dev/null)"; RC=$?
assert_eq "$RC" "0" "ledger append fails open (rc 0)"
assert_eq "$(printf '%s\n' "$ERR" | grep -c .)" "1" "ledger append failure prints exactly one stderr line"
assert_contains "$ERR" "append failed" "failure line names the failure"
# the append takes the lock: a held lock delays it
( flock -x 8; sleep 2 ) 8>"$LT/autopilot/dispatch-branches.jsonl.lock" & HOLD=$!
sleep 0.4; T0=$(date +%s%N); append "$LT" hands/x/c run-5 root-5 abc; T1=$(date +%s%N); wait "$HOLD"
[ $(( (T1 - T0) / 1000000 )) -ge 1000 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "ledger append must wait for the lock (waited $(( (T1 - T0) / 1000000 )) ms)"
assert_eq "$(wc -l < "$LT/autopilot/dispatch-branches.jsonl" | tr -d ' ')" "4" "append after the lock released landed"

# ---------------------------------------------------------------- usage
build_fixture "$TEST_TMP/repo1"
node "$SCRIPT" close-session --repo "$SBX" >/dev/null 2>&1; assert_eq "$?" "2" "no --session -> exit 2"
node "$SCRIPT" close-session --repo "$SBX" --session 'bad id' >/dev/null 2>&1; assert_eq "$?" "2" "bad --session -> exit 2"
node "$SCRIPT" scan --repo "$SBX" --session S1 >/dev/null 2>&1; assert_eq "$?" "2" "--session on scan -> exit 2"
node "$SCRIPT" close-session --repo "$SBX" --session S1 --auto --yes >/dev/null 2>&1; assert_eq "$?" "2" "--auto on close-session -> exit 2"

# ---------------------------------------------------------------- dry run changes nothing
BEFORE="$(refs_snapshot)"
DRY="$(run_close --session S1)"; assert_eq "$?" "0" "dry run -> exit 0"
assert_eq "$(refs_snapshot)" "$BEFORE" "dry run changes no ref"
assert_eq "$(jx "$DRY" 'j.dry_run')" "true" "dry run says so"
EXPECT="deleted=foreman/F1,s1-merged;archived=hands/F1/u1,hands/F1/u2,s1-shared,s1-unint;kept=reuse-hand:ledger_row_stale,s1-campaign:unresolved_campaign,s1-checkedout:checked_out,s1-leased:live_or_in_use_or_unexpired_lease_worktree"
assert_eq "$(sig "$DRY")" "$EXPECT" "dry run plan = the real plan"
assert_eq "$(jx "$DRY" 'j.schema+"|"+j.session')" "autopilot.close-session/1|S1" "report schema + session"

# ---------------------------------------------------------------- the real run
S2TIP="$(G rev-parse s2-unint)"; NLTIP="$(G rev-parse noledger)"; U1TIP="$(G rev-parse hands/F1/u1)"; UNTIP="$(G rev-parse s1-unint)"
OUT="$(run_close --session S1 --yes)"; RC=$?
assert_eq "$RC" "0" "S1 close-out -> exit 0 (only keep rules left behind)"
assert_eq "$(sig "$OUT")" "$EXPECT" "S1 close-out acts exactly on the right branches"
for b in s1-merged foreman/F1 s1-unint hands/F1/u1 hands/F1/u2; do G rev-parse --verify -q "refs/heads/$b" >/dev/null && fail "$b should be deleted" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)); done
for b in s1-checkedout s1-campaign s1-leased s2-unint noledger reuse-s2 reuse-hand sib-shared; do G rev-parse --verify -q "refs/heads/$b" >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "$b must survive"; done
assert_eq "$(G rev-parse "refs/archive/$TODAY/s1-unint")" "$UNTIP" "unintegrated branch archived at its tip"
assert_eq "$(G rev-parse "refs/archive/$TODAY/hands/F1/u1")" "$U1TIP" "foreman-owned hand archived at its tip"
assert_eq "$(G rev-parse s2-unint)" "$S2TIP" "S2's branch untouched"
assert_eq "$(G rev-parse noledger)" "$NLTIP" "branch with no ledger row untouched"
assert_eq "$(G for-each-ref "refs/archive/$TODAY/" | grep -c -E 's2-unint|noledger|s1-merged|checkedout')" "0" "no archive ref for anything but S1's unintegrated branches"
assert_eq "$(jx "$OUT" 'j.archived.find(a=>a.branch==="s1-unint").ref')" "refs/archive/$TODAY/s1-unint" "archived entry carries the ref"
# idempotent: a second run has nothing left to remove
OUT2="$(run_close --session S1 --yes)"; assert_eq "$?" "0" "second run exit 0"
assert_eq "$(sig "$OUT2")" "deleted=;archived=;kept=reuse-hand:ledger_row_stale,s1-campaign:unresolved_campaign,s1-checkedout:checked_out,s1-leased:live_or_in_use_or_unexpired_lease_worktree" "second run only repeats keep rules"
# S2 on the same repo now: its own branch is archived, nothing else
OUT3="$(run_close --session S2 --yes)"; assert_eq "$?" "0" "S2 close-out exit 0"
assert_eq "$(sig "$OUT3")" "deleted=;archived=reuse-s2,s2-unint;kept=" "S2 close-out acts on its own branches, including the reused name whose latest row is S2's"
assert_eq "$(G rev-parse noledger)" "$NLTIP" "still: branch with no ledger row untouched"
G rev-parse --verify -q refs/heads/sib-shared >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "sibling sharing a root_run_id must survive"
OUT4="$(run_close --session S3 --yes)"; assert_eq "$(sig "$OUT4")" "deleted=;archived=sib-shared;kept=" "S3 owns only its own row"

# ---------------------------------------------------------------- campaign signal unreadable -> keep
build_fixture "$TEST_TMP/repo2"
printf '{"schema_version":1,"missions":' > "$SBX/.git/autopilot/mission-bad.tmp"; mkdir -p "$SBX/.git/autopilot/mission"; printf 'not json' > "$SBX/.git/autopilot/mission/registry.json"
OUT="$(run_close --session S1 --yes)"; RC=$?
assert_eq "$RC" "0" "unreliable campaign signal: keep rule, exit 0"
assert_eq "$(jx "$OUT" 'j.deleted.length+j.archived.length')" "0" "unreliable campaign signal: nothing removed"
assert_contains "$(sig "$OUT")" "s1-unint:campaign_signal_unavailable" "unreliable campaign signal named"

# ---------------------------------------------------------------- archive collision keeps (exit 1)
build_fixture "$TEST_TMP/repo3"
G update-ref "refs/archive/$TODAY/s1-unint" "$BASE"
UNTIP="$(G rev-parse s1-unint)"
OUT="$(run_close --session S1 --yes)"; RC=$?
assert_eq "$RC" "1" "archive collision -> exit 1"
assert_eq "$(jx "$OUT" 'j.kept.find(k=>k.branch==="s1-unint").why')" "archive_ref_failed" "collision reason"
assert_eq "$(G rev-parse s1-unint)" "$UNTIP" "colliding branch kept"
assert_eq "$(G rev-parse "refs/archive/$TODAY/s1-unint")" "$BASE" "pre-existing archive ref not overwritten"
G rev-parse --verify -q refs/heads/s1-merged >/dev/null && fail "other branches still processed after a collision" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# ---------------------------------------------------------------- no ledger at all
mkdir -p "$TEST_TMP/repo4"; SBX="$TEST_TMP/repo4"; G init -q -b develop; G commit -q --allow-empty -m base; BASE="$(G rev-parse HEAD)"; ahead lone
OUT="$(run_close --session S1 --yes)"; assert_eq "$?" "0" "no ledger: exit 0"
assert_eq "$(sig "$OUT")" "deleted=;archived=;kept=" "no ledger: nothing to do"
G rev-parse --verify -q refs/heads/lone >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "no ledger: branch untouched"

# ---------------------------------------------------------------- compaction under reap --auto
build_fixture "$TEST_TMP/repo5"
printf 'this line is not json\n' >> "$SBX/.git/autopilot/dispatch-branches.jsonl"
ledger_row gone-branch S1 r-g r-g
BEFORE_N="$(grep -c . "$SBX/.git/autopilot/dispatch-branches.jsonl")"
AUTO="$(node "$SCRIPT" reap --repo "$SBX" --auto --yes)"; assert_eq "$?" "0" "reap --auto exit 0"
L="$SBX/.git/autopilot/dispatch-branches.jsonl"
assert_not_contains "$(cat "$L")" '"branch":"gone-branch"' "compaction drops a row whose branch is gone"
assert_contains "$(cat "$L")" '"branch":"s1-unint"' "compaction keeps a row whose branch exists"
assert_contains "$(cat "$L")" 'this line is not json' "compaction keeps an unparseable line verbatim"
assert_eq "$(jx "$AUTO" 'j.ledger.compacted')" "1" "auto report counts the dropped row"
assert_eq "$(( BEFORE_N - $(grep -c . "$L") ))" "1" "exactly one line removed"
assert_eq "$(ls "$SBX/.git/autopilot" | grep -c 'dispatch-branches.jsonl.tmp')" "0" "no temp file left behind"
# compaction waits for the append lock
ledger_row gone-two S1 r-g2 r-g2
( flock -x 8; sleep 2 ) 8>"$L.lock" & HOLD=$!
sleep 0.4; T0=$(date +%s%N); node "$SCRIPT" reap --repo "$SBX" --auto --yes >/dev/null; T1=$(date +%s%N); wait "$HOLD"
[ $(( (T1 - T0) / 1000000 )) -ge 1000 ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "compaction must wait for the append lock (waited $(( (T1 - T0) / 1000000 )) ms)"
assert_not_contains "$(cat "$L")" '"branch":"gone-two"' "compaction after the lock released dropped the row"

# ---------------------------------------------------------------- mutation proofs
# A mutant copy of the sweep (everything else symlinked) must produce a different outcome.
MUT="$TEST_TMP/mut"; mkdir -p "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"
for f in "$REPO_ROOT"/scripts/*; do ln -s "$f" "$MUT/scripts/$(basename "$f")"; done
mutate() { # <label> <sed expr> : builds $MUT/scripts/repo-residue-sweep.js from the original
  rm -f "$MUT/scripts/repo-residue-sweep.js"; sed -E "$2" "$SCRIPT" > "$MUT/scripts/repo-residue-sweep.js"
  cmp -s "$SCRIPT" "$MUT/scripts/repo-residue-sweep.js" && fail "mutation '$1' did not apply"
  build_fixture "$TEST_TMP/mrepo-$1"
  CS_SCRIPT="$MUT/scripts/repo-residue-sweep.js" run_close --session S1 --yes
}
M1="$(mutate transitive 's/for \(let grew = true; grew;\)/for (let grew = false; grew;)/')"
assert_neq "$(sig "$M1")" "$EXPECT" "mutant: no transitive run-id ownership -> outcome differs"
assert_contains "$(sig "$M1")" "kept=" "mutant transitive still runs"
M1B="$(mutate allsessions 's/if \(r\.session_id === session\) take\(r\);/take(r);/')"
assert_neq "$(sig "$M1B")" "$EXPECT" "mutant: every session's rows owned -> outcome differs (S2/other branches would be hit)"
M4="$(mutate rootprop 's/runIds\.add\(r\.run_id\);/runIds.add(r.run_id); runIds.add(r.root_run_id);/')"
assert_neq "$(sig "$M4")" "$EXPECT" "mutant: root_run_id propagates -> sibling session's branch is archived"
M5="$(mutate stale 's/if \(!ledgerRowFitsBranch\(mainPath, b, Number\(mine\.get\(name\)\[0\]\.created_at\)\)\) \{/if (false) {/')"
assert_neq "$(sig "$M5")" "$EXPECT" "mutant: staleness check removed -> hand-re-created branch is archived"
M6="$(mutate lastpointer 's/ptrs\.some\(/ptrs.slice(-1).some(/')"
assert_neq "$(sig "$M6")" "$EXPECT" "mutant: only the last pointing worktree counts -> leased branch is archived"
M7="$(mutate latestrow 's/if \(!cur \|\| at >= cur\.at\) latest\.set/if (!cur) latest.set/')"
assert_neq "$(sig "$M7")" "$EXPECT" "mutant: first row wins instead of the latest -> reused name is mis-owned"
M2="$(mutate checkedout "s/if \(checkedOut\.has\(name\)\) \{ keep\('checked_out'\); continue; \}//")"
assert_neq "$(sig "$M2")" "$EXPECT" "mutant: checked-out guard removed -> outcome differs"
M3="$(mutate lease "s/ \|\| w\.lease_expired === false\)\) \{ keep/ || false)) { keep/")"
assert_neq "$(sig "$M3")" "$EXPECT" "mutant: lease-pointer guard weakened -> outcome differs"

finalize_test
