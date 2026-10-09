#!/usr/bin/env bash
# repo-residue-auto.test.sh — `repo-residue-sweep.js reap --auto --yes` (the canonical automatic
# reaper) and the schema-2 marker grammar it shares with scripts/lib/worktree-reap.sh.
#
# Every removal rule gets a case that proves the matching safety condition BLOCKS removal:
# live lock, process cwd, dirty, detached HEAD, no/invalid marker, unexpired lease (default and
# explicit), HEAD != branch tip, unresolved campaign (journal and Mission registry), unreadable
# campaign signal, checked-out/young/recently-touched/campaign/lease-pointed branches.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME/.autopilot"
unset AUTOPILOT_RESIDUE_AUTO_REAP AUTOPILOT_RESIDUE_LEASE_HOURS AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
G() { git -C "$SBX" -c user.email=t@t -c user.name=t "$@"; }
jx() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);process.stdout.write(typeof v==="string"?v:JSON.stringify(v));})' "$2"; }
NOW="$(date +%s)"
old_commit() { # <days-ago> <parent> → sha of an empty-tree-delta commit dated N days ago
  local d; d="$(date -d "@$((NOW - $1 * 86400))" -R)"
  GIT_AUTHOR_DATE="$d" GIT_COMMITTER_DATE="$d" G commit-tree "$(G rev-parse "$2^{tree}")" -p "$2" -m "c$1-$RANDOM"
}
no_reflog_branch() { git -C "$SBX" -c core.logAllRefUpdates=false update-ref "refs/heads/$1" "$2"; }

G init -q -b develop
G config core.logAllRefUpdates true   # reflog activity is part of "last activity"; do not depend on ambient git config
BASE_DATE="$(date -d "@$((NOW - 5 * 86400))" -R)"
echo a > "$SBX/a.txt"; G add a.txt; GIT_AUTHOR_DATE="$BASE_DATE" GIT_COMMITTER_DATE="$BASE_DATE" G commit -q -m base
BASE="$(G rev-parse HEAD)"
printf '.autopilot-worktree\n.autopilot-worktree.lock\n' >> "$SBX/.git/info/exclude"
COMMON="$SBX/.git"

# mk_wt <name> [unintegrated] — worktree dir under $TEST_TMP, branch <name>; unintegrated = one commit ahead
mk_wt() {
  G worktree add -q "$TEST_TMP/wt-$1" -b "$1" "$BASE" 2>/dev/null
  if [ "${2:-}" = unintegrated ]; then git -C "$TEST_TMP/wt-$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "ahead-$1"; fi
}
# mk_marker <dir> <branch> <root> <run> [extra marker lines...]  (created_at = 1 h ago unless CREATED set)
mk_marker() {
  local dir="$1" br="$2" root="$3" run="$4"; shift 4
  { printf 'created_at=%s\nbranch=%s\nbase_sha=%s\nrun_id=%s\nroot_run_id=%s\nloop_id=%s\n' "${CREATED:-$((NOW - 3600))}" "$br" "$BASE" "$run" "$root" "$run"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf 'schema=2\n'; } > "$dir/.autopilot-worktree"
}
EXPIRED="retention_expires_at=$((NOW - 100))"; FUTURE="retention_expires_at=$((NOW + 100000))"

# ------------------------------------------------------------ marker grammar: bash validator
mv_check() { bash -c '. "$1"; _wt_read_schema2_marker "$2"' _ "$REPO_ROOT/scripts/lib/worktree-reap.sh" "$1"; }
js_check() { node -e 'const r=require(process.argv[1]).parseSchema2Marker(process.argv[2]);process.exit(r&&r.valid?0:1)' "$SCRIPT" "$1"; }
M="$TEST_TMP/m"; mkdir -p "$M"
SHA64="$(printf 'a%.0s' {1..64})"
mkm() { # <file> <lines...> → full marker with the 7 required keys plus extras
  local f="$1"; shift
  { printf 'created_at=1\nbranch=feat/x\nbase_sha=%s\nrun_id=r\nroot_run_id=r\nloop_id=r\n' "$BASE"; for l in "$@"; do printf '%s\n' "$l"; done; printf 'schema=2\n'; } > "$f"
}
check_both() { # <name> <want 0|1> <lines...>
  local name="$1" want="$2"; shift 2
  mkm "$M/$name" "$@"
  mv_check "$M/$name"; local b=$?
  js_check "$M/$name"; local j=$?
  assert_eq "$([ "$b" -eq 0 ] && echo 0 || echo 1)" "$want" "marker grammar (bash) $name"
  assert_eq "$([ "$j" -eq 0 ] && echo 0 || echo 1)" "$want" "marker grammar (js parity) $name"
}
check_both base 0
check_both inspect 0 retention=inspect
check_both empty-retention 0 retention=
check_both default-record 0 retention_reason=failure retention_expires_at=1790000000
check_both inspect-record 0 retention=inspect retention_reason=no_op retention_expires_at=1790000000
check_both lease 0 retention=lease retention_owner=o.1 "retention_reason_sha256=$SHA64" retention_expires_at=1790000000
check_both reason-without-expires 1 retention_reason=failure
check_both expires-without-reason 1 retention_expires_at=1790000000
check_both reason-bad-chars 1 'retention_reason=Bad Reason' retention_expires_at=1790000000
check_both reason-uppercase 1 retention_reason=Failure retention_expires_at=1790000000
check_both expires-not-number 1 retention_reason=failure retention_expires_at=soon
check_both lease-with-reason 1 retention=lease retention_owner=o "retention_reason_sha256=$SHA64" retention_expires_at=1790000000 retention_reason=failure
check_both lease-missing-owner 1 retention=lease "retention_reason_sha256=$SHA64" retention_expires_at=1790000000
check_both lease-bad-sha 1 retention=lease retention_owner=o retention_reason_sha256=zz retention_expires_at=1790000000
check_both owner-without-lease 1 retention=inspect retention_owner=o "retention_reason_sha256=$SHA64" retention_expires_at=1790000000
check_both empty-owner-key 1 retention_owner= retention_reason=failure retention_expires_at=1790000000
check_both unknown-retention 1 retention=forever
check_both duplicate-reason 1 retention_reason=a retention_reason=b retention_expires_at=1790000000
check_both stray-line 1 'not a key value line'
check_both unknown-key 1 retention_note=x
mkm "$M/bad-schema"; sed -i 's/^schema=2$/schema=3/' "$M/bad-schema"
mv_check "$M/bad-schema" && fail "bash accepted schema=3" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
js_check "$M/bad-schema" && fail "js accepted schema=3" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))

# ------------------------------------------------------------ _wt_record_retention
mkm "$M/rec" retention=inspect retention_reason=old retention_expires_at=5
bash -c '. "$1"; _wt_record_retention_dir() { :; }; mkdir -p "$2/w"; cp "$3" "$2/w/.autopilot-worktree"; _wt_record_retention "$2/w" "Main Checkout!" 3' _ "$REPO_ROOT/scripts/lib/worktree-reap.sh" "$M" "$M/rec"
R="$(cat "$M/w/.autopilot-worktree")"
assert_contains "$R" 'retention=inspect' "record keeps retention=inspect"
assert_contains "$R" 'retention_reason=main_checkout' "record sanitises the reason token"
assert_not_contains "$R" 'retention_reason=old' "record replaces the previous reason"
assert_eq "$(grep -c '^retention_expires_at=' "$M/w/.autopilot-worktree")" "1" "record leaves one expiry line"
mv_check "$M/w/.autopilot-worktree" && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "recorded marker still validates"
mkm "$M/lease-keep" retention=lease retention_owner=o "retention_reason_sha256=$SHA64" retention_expires_at=1790000000
mkdir -p "$M/lw"; cp "$M/lease-keep" "$M/lw/.autopilot-worktree"
bash -c '. "$1"; _wt_record_retention "$2" failure 3' _ "$REPO_ROOT/scripts/lib/worktree-reap.sh" "$M/lw"
assert_eq "$(cat "$M/lease-keep")" "$(cat "$M/lw/.autopilot-worktree")" "record never touches an explicit lease"
printf 'garbage\n' > "$M/lw/.autopilot-worktree"
bash -c '. "$1"; _wt_record_retention "$2" failure 3' _ "$REPO_ROOT/scripts/lib/worktree-reap.sh" "$M/lw" && fail "record rewrote an invalid marker" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_eq "$(cat "$M/lw/.autopilot-worktree")" "garbage" "invalid marker left untouched"

# ------------------------------------------------------------ fixture: worktrees
# removable
mk_wt w-expired unintegrated;   mk_marker "$TEST_TMP/wt-w-expired" w-expired root-a run-a "retention_reason=failure" "$EXPIRED"
mk_wt w-integrated;             mk_marker "$TEST_TMP/wt-w-integrated" w-integrated root-b run-b
mk_wt w-created-old unintegrated; CREATED=$((NOW - 100 * 3600)) mk_marker "$TEST_TMP/wt-w-created-old" w-created-old root-c run-c
mk_wt w-lease-expired unintegrated; mk_marker "$TEST_TMP/wt-w-lease-expired" w-lease-expired root-d run-d retention=lease retention_owner=o "retention_reason_sha256=$SHA64" "$EXPIRED"
mk_wt w-campaign-done unintegrated; mk_marker "$TEST_TMP/wt-w-campaign-done" w-campaign-done camp-done run-cd "retention_reason=failure" "$EXPIRED"
mk_wt w-gone;                   rm -rf "$TEST_TMP/wt-w-gone"
# blocked
mk_wt b-unexpired unintegrated; mk_marker "$TEST_TMP/wt-b-unexpired" b-unexpired root-e run-e "retention_reason=failure" "$FUTURE"
mk_wt b-created-recent unintegrated; mk_marker "$TEST_TMP/wt-b-created-recent" b-created-recent root-f run-f
mk_wt b-lease-integrated;       mk_marker "$TEST_TMP/wt-b-lease-integrated" b-lease-integrated root-g run-g retention=lease retention_owner=o "retention_reason_sha256=$SHA64" "$FUTURE"
mk_wt b-dirty unintegrated;     mk_marker "$TEST_TMP/wt-b-dirty" b-dirty root-h run-h "retention_reason=dirty" "$EXPIRED"; echo x > "$TEST_TMP/wt-b-dirty/new.txt"
mk_wt b-live unintegrated;      mk_marker "$TEST_TMP/wt-b-live" b-live root-i run-i "retention_reason=failure" "$EXPIRED"; exec 9>"$TEST_TMP/wt-b-live/.autopilot-worktree.lock"; flock -n 9
mk_wt b-busy unintegrated;      mk_marker "$TEST_TMP/wt-b-busy" b-busy root-j run-j "retention_reason=failure" "$EXPIRED"
( cd "$TEST_TMP/wt-b-busy" && exec sleep 600 ) & BUSY_PID=$!
mk_wt b-detached unintegrated;  mk_marker "$TEST_TMP/wt-b-detached" b-detached root-k run-k "retention_reason=failure" "$EXPIRED"; git -C "$TEST_TMP/wt-b-detached" checkout -q --detach
mk_wt b-nomarker unintegrated
mk_wt b-nomarker-int
mk_wt b-badmarker unintegrated; mk_marker "$TEST_TMP/wt-b-badmarker" b-badmarker root-m run-m "retention_reason=failure" "$EXPIRED"; echo 'stray line' >> "$TEST_TMP/wt-b-badmarker/.autopilot-worktree"
mk_wt b-lease-unexpired unintegrated; mk_marker "$TEST_TMP/wt-b-lease-unexpired" b-lease-unexpired root-n run-n retention=lease retention_owner=o "retention_reason_sha256=$SHA64" "$FUTURE"
mk_wt b-campaign unintegrated;  mk_marker "$TEST_TMP/wt-b-campaign" b-campaign camp-open run-bc "retention_reason=failure" "$EXPIRED"
mk_wt b-mission unintegrated;   mk_marker "$TEST_TMP/wt-b-mission" b-mission "mission-$(printf 'b%.0s' {1..24})" run-bm "retention_reason=failure" "$EXPIRED"
# a dirty worktree under .claude/worktrees with a process inside: never listed
mkdir -p "$SBX/.claude/worktrees"
G worktree add -q "$SBX/.claude/worktrees/session" -b session-branch "$BASE" 2>/dev/null; echo y > "$SBX/.claude/worktrees/session/dirty.txt"
( cd "$SBX/.claude/worktrees/session" && exec sleep 600 ) & SESS_PID=$!

# campaign journal + Mission registry (the authoritative signals)
mkdir -p "$COMMON/autopilot/mission/states"
row() { node -e 'process.stdout.write(JSON.stringify({kind:"journal",op:"campaign_event",payload:JSON.stringify({campaign_id:process.argv[1],event:{event_type:process.argv[2]}})})+"\n")' "$1" "$2"; }
{ row camp-open review_started; row camp-done terminal_ready; row camp-12345678 review_started; } > "$COMMON/autopilot/implementation-campaign.jsonl"
MKEY="$(printf 'b%.0s' {1..64})"
printf '{"schema_version":1,"missions":{"%s":{}}}\n' "$MKEY" > "$COMMON/autopilot/mission/registry.json"
printf '{"state":"ACTIVE","terminal":false,"root_run_id":"mission-%s"}\n' "$(printf 'b%.0s' {1..24})" > "$COMMON/autopilot/mission/states/$MKEY.json"

# ------------------------------------------------------------ fixture: branches
OLD15="$(old_commit 15 "$BASE")"; OLD2="$(old_commit 2 "$BASE")"
no_reflog_branch hands/old "$OLD15"
no_reflog_branch hands/young "$OLD2"
no_reflog_branch hetero/old-two "$(old_commit 20 "$BASE")"
no_reflog_branch feature/old "$(old_commit 30 "$BASE")"
no_reflog_branch bot/old "$(old_commit 16 "$BASE")"
no_reflog_branch hands/camp-12345678-x "$(old_commit 40 "$BASE")"
no_reflog_branch hands/merged "$BASE"                      # integrated, idle 5 days
no_reflog_branch feature/merged "$BASE"                    # integrated, non-dispatch
G branch hands/touched "$(old_commit 25 "$BASE")"          # old commit, but the reflog entry is NOW
no_reflog_branch hands/ptr "$(old_commit 25 "$BASE")"
G branch hands/fresh-int "$BASE"                          # integrated, but its reflog entry is NOW
mk_wt ptr-holder unintegrated; mk_marker "$TEST_TMP/wt-ptr-holder" hands/ptr root-p run-p retention=lease retention_owner=o "retention_reason_sha256=$SHA64" "$FUTURE"
# hands/checked-out: old, checked out by an unmarked worktree
no_reflog_branch hands/checked "$(old_commit 25 "$BASE")"; G worktree add -q "$TEST_TMP/wt-hands-checked" hands/checked 2>/dev/null
printf '{"residue":{"branch_prefixes":["bot/"]}}\n' > "$HOME/.autopilot/config.json"
today() { date -u +%F; }

# ------------------------------------------------------------ CLI refusals
node "$SCRIPT" reap --repo "$SBX" --auto >/dev/null 2>&1; assert_eq "$?" "2" "--auto without --yes → usage"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --preserve-dir "$TEST_TMP/p" >/dev/null 2>&1; assert_eq "$?" "2" "--auto + --preserve-dir refused"
node "$SCRIPT" reap --repo "$SBX" --auto --yes --older-than-days 3 >/dev/null 2>&1; assert_eq "$?" "2" "--auto + --older-than-days refused"
node "$SCRIPT" scan --repo "$SBX" --auto >/dev/null 2>&1; assert_eq "$?" "2" "--auto belongs to reap"
node "$SCRIPT" reap --repo "$SBX" --sizes --yes >/dev/null 2>&1; assert_eq "$?" "2" "--sizes belongs to scan"

# ------------------------------------------------------------ scan: additive fields, no tree walk
SCAN="$(node "$SCRIPT" scan --repo "$SBX")"
assert_eq "$(jx "$SCAN" 'typeof j.needs_human_count')" "number" "scan: needs_human_count present"
assert_eq "$(jx "$SCAN" 'j.needs_human.every(e=>e.bytes===null)')" "true" "scan without --sizes never measures (bytes null)"
assert_eq "$(jx "$SCAN" 'j.needs_human.some(e=>e.path&&e.path.endsWith("/wt-b-live"))')" "false" "scan: live worktree not needs_human"
assert_eq "$(jx "$SCAN" 'j.needs_human.some(e=>e.path&&e.path.endsWith("/wt-b-unexpired"))')" "false" "scan: unexpired lease not needs_human"
assert_eq "$(jx "$SCAN" 'j.needs_human.some(e=>e.path&&e.path.endsWith("/.claude/worktrees/session"))')" "false" "scan: .claude/worktrees path with a process inside excluded"
assert_eq "$(jx "$SCAN" 'j.worktrees.find(w=>w.path.endsWith("/wt-w-expired")).lease_expired')" "true" "scan: lease_expired field"
SIZED="$(node "$SCRIPT" scan --repo "$SBX" --sizes)"
assert_eq "$(jx "$SIZED" 'j.needs_human.filter(e=>e.kind==="worktree").every(e=>typeof e.bytes==="number")')" "true" "scan --sizes measures worktrees"
assert_eq "$(jx "$SIZED" 'j.needs_human_bytes>0')" "true" "scan --sizes totals bytes"
[ ! -e "$COMMON/autopilot-residue-auto.json" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "scan must not write the auto result file"

# ------------------------------------------------------------ disabled by config → nothing happens
OUT="$(AUTOPILOT_RESIDUE_AUTO_REAP=0 node "$SCRIPT" reap --repo "$SBX" --auto --yes)"; RC=$?
assert_eq "$RC" "0" "auto_reap=false exits 0"
assert_contains "$OUT" 'auto_reap_disabled' "auto_reap=false says so"
[ -d "$TEST_TMP/wt-w-expired" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "auto_reap=false must remove nothing"
[ ! -e "$COMMON/autopilot-residue-auto.json" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "auto_reap=false writes no result"

# ------------------------------------------------------------ the auto run (from a LINKED worktree: --repo is not the main checkout)
MAIN_HEAD_BEFORE="$(G rev-parse HEAD)"
OUT="$(node "$SCRIPT" reap --repo "$TEST_TMP/wt-b-nomarker" --auto --yes)"; RC=$?
assert_eq "$RC" "0" "auto run exit 0"
gone() { [ ! -d "$TEST_TMP/wt-$1" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "auto: wt-$1 should be removed"; }
kept() { [ -d "$TEST_TMP/wt-$1" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "auto: wt-$1 must be kept ($2)"; }
why() { jx "$OUT" "j.kept.find(k=>k.path&&k.path.endsWith('/wt-$1')).why"; }
gone w-expired; gone w-integrated; gone w-created-old; gone w-lease-expired; gone w-campaign-done; gone w-gone
[ -d "$SBX" ] && [ "$(G rev-parse HEAD)" = "$MAIN_HEAD_BEFORE" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "main checkout untouched"
kept b-unexpired "default lease not expired";  assert_eq "$(why b-unexpired)" "lease_not_expired" "reason: lease_not_expired"
kept b-created-recent "created_at + lease_hours in the future"; assert_eq "$(why b-created-recent)" "lease_not_expired" "reason: created_at fallback not expired"
kept b-lease-integrated "explicit lease"; assert_eq "$(why b-lease-integrated)" "explicit_lease_unexpired" "reason: explicit lease beats integrated"
kept b-lease-unexpired "explicit lease";  assert_eq "$(why b-lease-unexpired)" "explicit_lease_unexpired" "reason: explicit lease unexpired"
kept b-dirty dirty;       assert_eq "$(why b-dirty)" "dirty" "reason: dirty"
kept b-live live;         assert_eq "$(why b-live)" "live" "reason: live (flock)"
kept b-busy "process cwd"; assert_eq "$(why b-busy)" "process_cwd_inside" "reason: process cwd inside"
kept b-detached detached; assert_eq "$(why b-detached)" "detached_or_head_not_branch_tip" "reason: detached HEAD"
kept b-nomarker "no marker"; assert_eq "$(why b-nomarker)" "no_marker" "reason: no marker"
kept b-nomarker-int "no marker (integrated)"; assert_eq "$(why b-nomarker-int)" "no_marker" "reason: integrated but no marker"
kept b-badmarker "invalid marker"; assert_eq "$(why b-badmarker)" "marker_invalid" "reason: invalid marker"
kept b-campaign "journal campaign open";  assert_eq "$(why b-campaign)" "unresolved_campaign" "reason: open campaign (journal)"
kept b-mission "mission open";            assert_eq "$(why b-mission)" "unresolved_campaign" "reason: open Mission (registry)"
kept ptr-holder "explicit lease"
# removed worktrees leave their branches
for b in w-expired w-integrated w-created-old w-lease-expired w-campaign-done; do G rev-parse --verify -q "refs/heads/$b" >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "branch $b must survive its worktree"; done
assert_eq "$(jx "$OUT" 'j.removed.filter(r=>r.kind==="worktree").length')" "6" "removed: 5 marker worktrees + the missing-dir entry"
assert_eq "$(jx "$OUT" 'j.removed.some(r=>r.path.endsWith("/wt-w-gone")&&r.reason==="missing_dir")')" "true" "missing-dir pruned and recorded"
[ -z "$(G worktree list --porcelain | grep 'wt-w-gone')" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "missing-dir entry gone from git"

# branches
ref_of() { G rev-parse --verify -q "refs/archive/$(today)/$1"; }
G rev-parse --verify -q refs/heads/hands/old >/dev/null && fail "hands/old (15d) should be archived+deleted" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_eq "$(ref_of hands/old)" "$OLD15" "archive ref resolves to the old tip"
G rev-parse --verify -q refs/heads/hetero/old-two >/dev/null && fail "hetero/old-two should be archived" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -n "$(ref_of hetero/old-two)" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "hetero/old-two archive ref"
G rev-parse --verify -q refs/heads/bot/old >/dev/null && fail "residue.branch_prefixes bot/ should be archived" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -n "$(ref_of bot/old)" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "bot/old archive ref"
G branch restored "refs/archive/$(today)/hands/old" && assert_eq "$(G rev-parse restored)" "$OLD15" "one command restores an archived branch"
assert_eq "$(jx "$OUT" 'j.archived.map(a=>a.branch).sort().join(",")')" "bot/old,hands/old,hetero/old-two" "archived list"
keep_branch() { G rev-parse --verify -q "refs/heads/$1" >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "branch $1 must stay ($2)"; }
keep_branch hands/young "younger than 14 days"
keep_branch hands/touched "reflog says it was touched just now"
keep_branch hands/camp-12345678-x "unresolved campaign id in the name"
keep_branch hands/ptr "an unexpired-lease marker names it"
keep_branch hands/checked "checked out"
keep_branch feature/old "not a dispatch branch"
keep_branch feature/merged "integrated but not a dispatch branch"
keep_branch hands/fresh-int "integrated but created just now"
G rev-parse --verify -q refs/heads/hands/merged >/dev/null && fail "integrated idle dispatch branch should be deleted" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_eq "$(jx "$OUT" 'j.removed.some(r=>r.kind==="branch"&&r.branch==="hands/merged"&&r.reason==="integrated")')" "true" "integrated branch recorded in removed"
assert_eq "$(jx "$OUT" 'j.kept.find(k=>k.branch==="hands/ptr").why')" "live_or_unexpired_lease_worktree" "reason: lease worktree points at the branch"
assert_eq "$(jx "$OUT" 'j.kept.find(k=>k.branch==="hands/camp-12345678-x").why')" "unresolved_campaign" "reason: branch in unresolved campaign"
assert_eq "$(jx "$OUT" 'j.kept.find(k=>k.branch==="hands/young").why')" "younger_than_archive_days" "reason: young branch"
assert_eq "$(jx "$OUT" 'j.kept.find(k=>k.branch==="hands/touched").why')" "younger_than_archive_days" "reason: reflog activity counts"

# needs_human
NH_TXT="$(jx "$OUT" 'j.needs_human')"
assert_contains "$NH_TXT" '/wt-b-dirty' "needs_human: expired dirty marker worktree"
assert_contains "$NH_TXT" '/wt-b-detached' "needs_human: expired detached marker worktree"
assert_contains "$NH_TXT" '/wt-b-nomarker' "needs_human: clean-unintegrated without a marker"
assert_contains "$NH_TXT" '/wt-b-badmarker' "needs_human: invalid marker counts as no marker"
assert_contains "$NH_TXT" '"branch":"feature/old"' "needs_human: unintegrated non-dispatch branch older than 14 d"
assert_not_contains "$NH_TXT" '/wt-b-live' "needs_human: live excluded"
assert_not_contains "$NH_TXT" '/wt-b-unexpired' "needs_human: unexpired default lease excluded"
assert_not_contains "$NH_TXT" '/wt-b-lease-unexpired' "needs_human: unexpired explicit lease excluded"
assert_not_contains "$NH_TXT" '.claude/worktrees/session' "needs_human: .claude/worktrees path with a live process excluded"
assert_not_contains "$NH_TXT" 'hands/young' "needs_human: young branch excluded"
assert_not_contains "$NH_TXT" 'feature/merged' "needs_human: integrated branch excluded"
assert_eq "$(jx "$OUT" 'j.needs_human.find(e=>e.path&&e.path.endsWith("/wt-b-dirty")).reason')" "dirty" "needs_human reason = retention_reason"
assert_eq "$(jx "$OUT" 'j.needs_human.find(e=>e.path&&e.path.endsWith("/wt-b-dirty")).command')" "git -C '$TEST_TMP/wt-b-dirty' status --short" "needs_human exact command (dirty)"
assert_eq "$(jx "$OUT" 'j.needs_human.find(e=>e.path&&e.path.endsWith("/wt-b-nomarker")).command')" "git -C '$SBX' worktree remove '$TEST_TMP/wt-b-nomarker'" "needs_human exact command (clean)"
assert_eq "$(jx "$OUT" 'j.needs_human.find(e=>e.branch==="feature/old").command.startsWith("git -C \x27'"$SBX"'\x27 update-ref ")')" "true" "needs_human branch command archives first"
assert_eq "$(jx "$OUT" 'j.needs_human.filter(e=>e.kind==="worktree").every(e=>typeof e.bytes==="number")')" "true" "auto run measures worktree sizes"
assert_eq "$(jx "$OUT" 'j.needs_human_count===j.needs_human.length')" "true" "needs_human_count"
assert_eq "$(jx "$OUT" 'j.needs_human_bytes===j.needs_human.reduce((a,e)=>a+(e.bytes||0),0)')" "true" "needs_human_bytes"

# result file
RES="$COMMON/autopilot-residue-auto.json"
assert_file_exists "$RES" "result file at <git-common-dir>/autopilot-residue-auto.json"
assert_eq "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([j.schema,typeof j.ran_at,Array.isArray(j.removed),Array.isArray(j.archived),Array.isArray(j.needs_human),typeof j.needs_human_count,typeof j.needs_human_bytes].join(","))' "$RES")" "autopilot.residue-auto/1,string,true,true,true,number,number" "result file schema"
SCAN2="$(node "$SCRIPT" scan --repo "$SBX")"
assert_eq "$(jx "$SCAN2" 'j.needs_human.filter(e=>e.kind==="worktree").every(e=>typeof e.bytes==="number")')" "true" "plain scan copies cached sizes from the auto result"

# idempotent: a second run removes nothing more
OUT2="$(node "$SCRIPT" reap --repo "$SBX" --auto --yes)"
assert_eq "$(jx "$OUT2" 'j.removed.length+j.archived.length')" "0" "second run is a no-op"

# unreadable campaign signal → only root==run markers go; archives are skipped
kill "$BUSY_PID" 2>/dev/null; wait "$BUSY_PID" 2>/dev/null
mk_wt s-same unintegrated;  mk_marker "$TEST_TMP/wt-s-same" s-same same-id same-id "retention_reason=failure" "$EXPIRED"
mk_wt s-diff unintegrated;  mk_marker "$TEST_TMP/wt-s-diff" s-diff root-z run-z "retention_reason=failure" "$EXPIRED"
no_reflog_branch hands/old2 "$(old_commit 30 "$BASE")"
printf '{ not json' > "$COMMON/autopilot/mission/registry.json"
OUT3="$(node "$SCRIPT" reap --repo "$SBX" --auto --yes)"
gone s-same
kept s-diff "campaign signal unavailable: root_run_id != run_id"
assert_eq "$(jx "$OUT3" 'j.kept.find(k=>k.path&&k.path.endsWith("/wt-s-diff")).why')" "campaign_signal_unavailable" "reason: signal unavailable (worktree)"
G rev-parse --verify -q refs/heads/hands/old2 >/dev/null && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "no archive while the campaign signal is unavailable"
assert_contains "$(jx "$OUT3" 'j.notes')" 'campaign_signal_unavailable' "report says the signal was unavailable"
kill "$SESS_PID" 2>/dev/null; wait "$SESS_PID" 2>/dev/null

finalize_test
