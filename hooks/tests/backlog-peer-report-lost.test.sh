#!/usr/bin/env bash
# backlog-peer-report-lost.test.sh — the pre-push range rule of scripts/check-backlog-entries.js
# (`--range`, peer_report_lost, R3–R6) and its wiring in .githooks/pre-push.

. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-backlog-entries.js"

json_codes() { # <json> -> sorted unique codes, comma-joined
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write([...new Set(j.violations.map(v=>v.code))].sort().join(","))}catch(e){process.stdout.write("unparsable")}})'
}
json_count() { # <json> <code>
  printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.violations.filter(v=>v.code==='$2').length))}catch(e){process.stdout.write('x')}})"
}

new_repo() { # <name> -> path; a git repo with a plan, a CHANGELOG and a block-mode backlog config
  local d="$TEST_TMP/$1"
  mkdir -p "$d/docs/plans" "$d/.claude"
  git -C "$d" init -q
  git -C "$d" config user.email t@local
  git -C "$d" config user.name t
  git -C "$d" config autopilot.testIdentityGate off
  printf '# ok\n' > "$d/docs/plans/ok.md"
  printf '# Changelog\n' > "$d/CHANGELOG.md"
  printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' > "$d/.claude/backlog-config.md"
  echo "$d"
}

# row <title> <id> <reporter> <report> <reply> [status]
row() {
  printf '%s\n' "### $1" "- **Id**: $2" "- **Status**: ${6:-open}" '- **Since**: 2026-09-05' \
    '- **Origin**: peer' "- **Reporter**: $3" "- **Report**: $4" "- **Reply**: $5" \
    '- **Problem**: 回報者遇到的問題' '- **Impact**: 不修會一直發生' \
    '- **Trigger**: when it fires' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' ''
}

write_backlog() { # <repo> <next-id number> [rows...] (rows already rendered)
  local d="$1" n="$2"; shift 2
  { printf '# BACKLOG\n\n<!-- next-id: BL-%04d -->\n\n' "$n"; local r; for r in "$@"; do printf '%s\n\n' "$r"; done; } > "$d/docs/BACKLOG.md"
}

commit_all() { # <repo> <msg> -> sha
  git -C "$1" add -A
  git -C "$1" commit -q -m "$2"
  git -C "$1" rev-parse HEAD
}

range_check() { # <repo> <range> [gate]
  node "${3:-$GATE}" --backlog "$1/docs/BACKLOG.md" --config "$1/.claude/backlog-config.md" --range "$2" 2>/dev/null
}

# A backlog left with no rows at all is unparseable_entry (pre-existing behaviour), which would
# block for the wrong reason; head states that delete the last peer row keep this answered row.
KEEP="$(row 'Keeper row' BL-0002 openclaw msg_01K '2026-09-06 msg_01KR')"

# ---------------------------------------------------------------------------------------------
# R4 — honest flow: commit A fills the Reply, commit B deletes the row ⇒ allowed.
d="$(new_repo r4)"
write_backlog "$d" 3 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)" "$(row 'Self row two' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 3 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' '2026-10-01 msg_01REPLY')" "$(row 'Self row two' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
commit_all "$d" "A: reply recorded" >/dev/null
write_backlog "$d" 3 "$(row 'Self row two' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
HEADSHA="$(commit_all "$d" "B: row deleted")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R4: reply in A then delete in B is allowed"
assert_eq "$(json_count "$out" peer_report_lost)" "0" "R4: no peer_report_lost"
assert_contains "$out" '"commits":3' "R4: base plus both commits were read"

# Mutation: a gate that reads only base and head (the wrong implementation) must block this flow.
MUTROOT="$TEST_TMP/mutroot"
mkdir -p "$MUTROOT/scripts/lib" "$MUTROOT/references"
cp "$REPO_ROOT/references/stage-graph.json" "$MUTROOT/references/"
cp "$REPO_ROOT/scripts/resolve-project-paths.sh" "$REPO_ROOT/scripts/project-detect.js" "$MUTROOT/scripts/"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$REPO_ROOT/scripts/lib/resolve-config.sh" "$MUTROOT/scripts/lib/"
MUT_BASEHEAD="$MUTROOT/scripts/check-base-head.js"
sed "s|const shas = (baseSha ? \[baseSha\] : \[\]).concat(String(r.stdout).split('\\\\n').filter(Boolean));|const shas = (baseSha ? [baseSha] : []).concat([headSha]);|" "$GATE" > "$MUT_BASEHEAD"
if cmp -s "$GATE" "$MUT_BASEHEAD"; then
  fail "R4 mutation did not apply (sed pattern drifted from the gate source)"
fi
out="$(range_check "$d" "$BASE..$HEADSHA" "$MUT_BASEHEAD")"; rc=$?
assert_eq "$rc" "1" "R4 mutation: base-vs-head-only reading blocks the honest flow (the suite can tell)"
assert_eq "$(json_count "$out" peer_report_lost)" "1" "R4 mutation: reports the falsely lost pair"

# Dishonest flow: delete with Reply none ⇒ blocked.
d="$(new_repo r4-bad)"
write_backlog "$d" 3 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)" "$(row 'Self row two' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 3 "$(row 'Self row two' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
HEADSHA="$(commit_all "$d" "row deleted without reply")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "deleting an unanswered peer row is blocked"
assert_eq "$(json_codes "$out")" "peer_report_lost" "only peer_report_lost fires"
assert_contains "$out" "BL-0001" "the violation names the Id"

# Reply unknown counts as unanswered; a range with no base (whole history) still sees it.
d="$(new_repo unknown)"
write_backlog "$d" 2 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' unknown)"
commit_all "$d" base >/dev/null
write_backlog "$d" 3 "$KEEP"
HEADSHA="$(commit_all "$d" "deleted")"
out="$(range_check "$d" "$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "Reply unknown + delete is blocked (no-base range reads the whole history)"
assert_eq "$(json_codes "$out")" "peer_report_lost" "Reply unknown: blocked for the loss only"

# Answered at base, deleted at head ⇒ allowed (green twin of the case above).
d="$(new_repo answered)"
write_backlog "$d" 2 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 3 "$KEEP"
HEADSHA="$(commit_all "$d" "deleted after reply")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "an answered peer row may be deleted"

# ---------------------------------------------------------------------------------------------
# R5 — the row survives but one reporter is dropped ⇒ blocked.
d="$(new_repo r5)"
write_backlog "$d" 2 "$(row 'Two reporters' BL-0001 'cuda；openclaw' '2026-09-05 fleet；msg_01OC' '2026-09-06 msg_01R；none')"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 2 "$(row 'Two reporters' BL-0001 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')"
HEADSHA="$(commit_all "$d" "drop openclaw")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "R5: dropping an unanswered reporter from a surviving row is blocked"
assert_contains "$out" "msg_01OC" "R5: the lost Report is named"
# Mutation: keying by Id alone (row-level protection) lets R5 through.
MUT_IDKEY="$MUTROOT/scripts/check-id-key.js"
sed 's|key: `${id}\\0${p.report}`|key: id|' "$GATE" > "$MUT_IDKEY"
if cmp -s "$GATE" "$MUT_IDKEY"; then fail "R5 mutation did not apply"; fi
out="$(range_check "$d" "$BASE..$HEADSHA" "$MUT_IDKEY")"; rc=$?
assert_eq "$rc" "0" "R5 mutation: an Id-only key misses the dropped reporter (the suite can tell)"

# ---------------------------------------------------------------------------------------------
# R3 — exits only by Id string: plans, CHANGELOG, or ANOTHER backlog row.
setup_r3() { # <name> -> repo with an unanswered peer row at base, deleted at head minus the exit
  local d; d="$(new_repo "$1")"
  write_backlog "$d" 3 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)" "$(row 'Other row' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
  R3BASE="$(commit_all "$d" base)"
  write_backlog "$d" 3 "$(row 'Other row' BL-0002 openclaw msg_01AAA '2026-09-06 msg_01BBB')"
  echo "$d"
}
d="$(setup_r3 r3-plan)"; R3BASE="$(git -C "$d" rev-parse HEAD)"
printf '# x\n\nCarries BL-0001 forward.\n' > "$d/docs/plans/x.md"
HEADSHA="$(commit_all "$d" "move to plan")"
out="$(range_check "$d" "$R3BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R3: Id written into docs/plans/x.md is an exit"

d="$(setup_r3 r3-report-only)"; R3BASE="$(git -C "$d" rev-parse HEAD)"
printf '# x\n\nFrom 2026-09-05 fleet (cuda).\n' > "$d/docs/plans/x.md"
HEADSHA="$(commit_all "$d" "plan quotes only the Report")"
out="$(range_check "$d" "$R3BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "R3: the same Report string in a plan is NOT an exit"

d="$(setup_r3 r3-changelog)"; R3BASE="$(git -C "$d" rev-parse HEAD)"
printf '# Changelog\n\n- fixed BL-0001\n' > "$d/CHANGELOG.md"
HEADSHA="$(commit_all "$d" "changelog names it")"
out="$(range_check "$d" "$R3BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R3: Id in CHANGELOG.md is an exit"

d="$(setup_r3 r3-prefix)"; R3BASE="$(git -C "$d" rev-parse HEAD)"
printf '# x\n\nSee BL-00010.\n' > "$d/docs/plans/x.md"
HEADSHA="$(commit_all "$d" "longer id only")"
out="$(range_check "$d" "$R3BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "R3: BL-00010 does not count as a mention of BL-0001"

d="$(setup_r3 r3-other-row)"; R3BASE="$(git -C "$d" rev-parse HEAD)"
write_backlog "$d" 3 "$(row 'Other row' BL-0002 'openclaw；cuda' 'msg_01AAA；2026-09-05 fleet' '2026-09-06 msg_01BBB；none' | sed 's/- \*\*Problem\*\*: .*/- **Problem**: 合併自 BL-0001 的回報/')"
HEADSHA="$(commit_all "$d" "merged into another row")"
out="$(range_check "$d" "$R3BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R3: Id named by another BACKLOG row is an exit"

# Mutation: without the exit check, the plans case blocks.
MUT_NOEXIT="$MUTROOT/scripts/check-no-exit.js"
sed 's|    if (hasExit(p.id)) continue;|    /* exit removed */|' "$GATE" > "$MUT_NOEXIT"
if cmp -s "$GATE" "$MUT_NOEXIT"; then fail "R3 mutation did not apply"; fi
d="$TEST_TMP/r3-plan"
out="$(range_check "$d" "$(git -C "$d" rev-parse HEAD~1)..$(git -C "$d" rev-parse HEAD)" "$MUT_NOEXIT")"; rc=$?
assert_eq "$rc" "1" "R3 mutation: with no exit check the plan exit is ignored (the suite can tell)"

# ---------------------------------------------------------------------------------------------
# R6 — the file gate runs on the pushed head: a merge that produced a duplicate Id blocks.
d="$(new_repo r6)"
write_backlog "$d" 3 "$(row 'Lane one row' BL-0002 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 3 "$(row 'Lane one row' BL-0002 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')" "$(row 'Lane two row' BL-0002 openclaw msg_01O '2026-09-07 msg_01S')"
HEADSHA="$(commit_all "$d" "merge result")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "R6: duplicate Id at the pushed head blocks"
assert_eq "$(json_codes "$out")" "duplicate_id" "R6: reported as duplicate_id"
write_backlog "$d" 3 "$(row 'Lane one row' BL-0002 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')" "$(row 'Lane two row' BL-0003 openclaw msg_01O '2026-09-07 msg_01S')"
HEADSHA="$(commit_all "$d" "renumber without raising next-id")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "1" "R6: an Id at next-id blocks"
assert_eq "$(json_codes "$out")" "bad_id" "R6: reported as bad_id"
write_backlog "$d" 4 "$(row 'Lane one row' BL-0002 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')" "$(row 'Lane two row' BL-0003 openclaw msg_01O '2026-09-07 msg_01S')"
HEADSHA="$(commit_all "$d" "raise next-id")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R6: unique Ids below next-id pass"
# The working tree differs from the pushed commit: the committed blob is what gets checked.
write_backlog "$d" 4 "$(row 'Lane one row' BL-0002 cuda '2026-09-05 fleet' '2026-09-06 msg_01R')" "$(row 'Lane two row' BL-0002 openclaw msg_01O '2026-09-07 msg_01S')"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc" "0" "R6: the pushed commit's backlog is checked, not the dirty working tree"
git -C "$d" checkout -q -- docs/BACKLOG.md
MUT_NOFILE="$MUTROOT/scripts/check-no-file-gate.js"
sed 's|const annotated = checked.annotated.concat(|const annotated = [].concat(|' "$GATE" > "$MUT_NOFILE"
if cmp -s "$GATE" "$MUT_NOFILE"; then fail "R6 mutation did not apply"; fi
out="$(range_check "$d" "$BASE..$(git -C "$d" rev-parse HEAD~1)" "$MUT_NOFILE")"; rc=$?
assert_eq "$rc" "0" "R6 mutation: without the head file gate the bad_id head passes (the suite can tell)"

# Table compat: a legacy table whose extra columns happen to be called Origin/Reporter/Report/Reply
# was never read by the old gate. Until the file opts in, deleting such a row is an ordinary delete,
# not peer_report_lost. The opt-in control is the same history with `required_fields: Origin`
# (Report is not requirable on its own; Reporter/Report/Reply follow a required Origin).
tc_repo() { # <name> [required_fields] -> repo with two Id+Report table rows; HEAD deletes the first
  local d; d="$(new_repo "$1")"
  { printf '%s\n' '## Style' '- style: table' '## Mode' '- mode: block' '- id_pattern: ^\d{4}$'
    if [ -n "${2:-}" ]; then printf -- '- required_fields: %s\n' "$2"; fi; } > "$d/.claude/backlog-config.md"
  local hdr='| Id | Title | Status | Trigger | Effort | Source | Pointer | Origin | Reporter | Report | Reply |' sep='|---|---|---|---|---|---|---|---|---|---|---|'
  local r1='| 0001 | Row one | open | when x | S | me | none | peer | cuda | ticket 12 | none |' r2='| 0002 | Row two | open | when y | S | me | none | peer | cuda | ticket 13 | none |'
  printf '%s\n' '# Backlog' '' "$hdr" "$sep" "$r1" "$r2" > "$d/docs/BACKLOG.md"
  commit_all "$d" base >/dev/null
  printf '%s\n' '# Backlog' '' "$hdr" "$sep" "$r2" > "$d/docs/BACKLOG.md"
  commit_all "$d" "drop row one" >/dev/null
  echo "$d"
}
d="$(tc_repo tc-compat)"
out="$(range_check "$d" HEAD~1..HEAD)"; rc=$?
assert_eq "$rc" "0" "table compat: deleting a row with a legacy Report column passes --range without opt-in"
assert_eq "$(json_count "$out" peer_report_lost)" "0" "table compat: no peer_report_lost without opt-in"
TC_COMPAT_DIR="$d"
d="$(tc_repo tc-optin Origin)"
out="$(range_check "$d" HEAD~1..HEAD)"; rc=$?
assert_eq "$rc:$(json_codes "$out")" "1:peer_report_lost" "table opt-in: with Origin in required_fields the same delete blocks"
assert_eq "$(json_count "$out" peer_report_lost)" "1" "table opt-in: reported as peer_report_lost"
MUT_NONORM="$MUTROOT/scripts/check-no-normalise.js"
sed 's|^        if (NEW_FIELDS.includes(f) \&\& !fieldOptedIn(ocfg, f)) continue;$|        ;|' "$GATE" > "$MUT_NONORM"
if cmp -s "$GATE" "$MUT_NONORM"; then fail "table compat mutation did not apply"; fi
out="$(range_check "$TC_COMPAT_DIR" HEAD~1..HEAD "$MUT_NONORM")"; rc=$?
assert_eq "$rc:$(json_count "$out" peer_report_lost)" "1:1" "table compat mutation: without parse-layer normalisation the legacy delete blocks (the suite can tell)"

# ---------------------------------------------------------------------------------------------
# BL-0131 — the opt-in commit itself deletes an unanswered peer row. Before it, the file carries
# no next-id mark, so the history parse read the row legacy-style and never saw the (Id, Report)
# pair; the opt-in commit's own text no longer has the row. The loss must still be caught, while a
# file that never opts in keeps the legacy reading (tc-compat above).
bare_backlog() { # <repo> [rows...] -> a backlog WITHOUT the next-id mark
  local d="$1"; shift
  { printf '# BACKLOG\n\n'; local r; for r in "$@"; do printf '%s\n\n' "$r"; done; } > "$d/docs/BACKLOG.md"
}
d="$(new_repo optin-delete)"
bare_backlog "$d" "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)" "$KEEP"
BASE="$(commit_all "$d" "pre-opt-in")"
write_backlog "$d" 3 "$KEEP"
HEADSHA="$(commit_all "$d" "opt in and delete the unanswered row in one commit")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$rc:$(json_count "$out" peer_report_lost)" "1:1" "BL-0131: delete in the opt-in commit blocks"
assert_contains "$out" "BL-0001" "BL-0131: the violation names the Id"
# Negative control: the same history without the opt-in at head is an ordinary legacy delete.
d="$(new_repo optin-never)"
bare_backlog "$d" "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)" "$KEEP"
BASE="$(commit_all "$d" "legacy")"
bare_backlog "$d" "$KEEP"
HEADSHA="$(commit_all "$d" "legacy delete")"
out="$(range_check "$d" "$BASE..$HEADSHA")"; rc=$?
assert_eq "$(json_count "$out" peer_report_lost)" "0" "BL-0131 control: a file that never opts in keeps the legacy reading"

# No config (mode warn): reported, never blocks — a downstream repo is not wedged.
d="$(new_repo warn)"
rm -f "$d/.claude/backlog-config.md"
write_backlog "$d" 2 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)"
BASE="$(commit_all "$d" base)"
write_backlog "$d" 3 "$KEEP"
HEADSHA="$(commit_all "$d" deleted)"
out="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --range "$BASE..$HEADSHA" 2>/dev/null)"; rc=$?
assert_eq "$rc" "0" "no config → warn mode → exit 0"
assert_eq "$(json_count "$out" peer_report_lost)" "1" "…but the loss is still reported"

# ---------------------------------------------------------------------------------------------
# Wiring: .githooks/pre-push reads the range from stdin like the qc-gate does.
SBX="$(new_repo hook)"
mkdir -p "$SBX/scripts/lib" "$SBX/references" "$SBX/.githooks"
cp "$REPO_ROOT/references/stage-graph.json" "$SBX/references/"
cp "$GATE" "$REPO_ROOT/scripts/resolve-project-paths.sh" "$REPO_ROOT/scripts/project-detect.js" "$SBX/scripts/"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$REPO_ROOT/scripts/lib/resolve-config.sh" "$SBX/scripts/lib/"
cp "$REPO_ROOT/.githooks/pre-push" "$SBX/.githooks/pre-push"
write_backlog "$SBX" 2 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)"
BASE="$(commit_all "$SBX" base)"
printf 'x\n' > "$SBX/unrelated.txt"
UNREL="$(commit_all "$SBX" "unrelated change")"
write_backlog "$SBX" 3 "$KEEP"
HEADSHA="$(commit_all "$SBX" "delete unanswered row")"
run_push() { # <stdin line> [hook] -> rc; output in PUSH_OUT
  PUSH_OUT="$(cd "$SBX" && printf '%s\n' "$1" | bash "${2:-.githooks/pre-push}" origin 2>&1)"
}
run_push "HEAD $HEADSHA refs/heads/develop $BASE"; rc=$?
assert_eq "$rc" "1" "pre-push: git push origin HEAD:develop (remote sha known) blocks the loss"
assert_contains "$PUSH_OUT" "peer_report_lost" "pre-push: names the rule"
run_push "refs/heads/develop $UNREL refs/heads/develop $BASE"; rc=$?
assert_eq "$rc" "0" "pre-push: a range that never touched the backlog is skipped"
run_push "refs/heads/feature $HEADSHA refs/heads/feature 0000000000000000000000000000000000000000"; rc=$?
assert_eq "$rc" "1" "pre-push: new remote branch with no origin/HEAD checks the whole history"
assert_contains "$PUSH_OUT" "peer_report_lost" "pre-push: whole-history range blocks for the loss"
git -C "$SBX" update-ref refs/remotes/origin/HEAD "$UNREL"
run_push "refs/heads/feature $HEADSHA refs/heads/feature 0000000000000000000000000000000000000000"; rc=$?
assert_eq "$rc" "1" "pre-push: new remote branch gates origin/HEAD..local"
assert_contains "$PUSH_OUT" "peer_report_lost" "pre-push: origin/HEAD range blocks for the loss, not another code"
assert_not_contains "$PUSH_OUT" "unparseable_entry" "pre-push: no unrelated code in the origin/HEAD range"
run_push "refs/heads/feature 0000000000000000000000000000000000000000 refs/heads/feature $BASE"; rc=$?
assert_eq "$rc" "0" "pre-push: a branch delete is not gated"
git -C "$SBX" config user.name t
write_backlog "$SBX" 2 "$(row 'Peer row one' BL-0001 cuda '2026-09-05 fleet' none)"
FIXED="$(commit_all "$SBX" "restore")"
run_push "HEAD $FIXED refs/heads/develop $BASE"; rc=$?
assert_eq "$rc" "0" "pre-push: the pair is back at head → allowed"


# A remote sha this clone does not have: skipped, but with a printed line (not silently).
GHOST=1234567890abcdef1234567890abcdef12345678
run_push "HEAD $HEADSHA refs/heads/develop $GHOST"; rc=$?
assert_eq "$rc" "0" "pre-push: an unknown remote sha does not block"
assert_contains "$PUSH_OUT" "remote commit $GHOST is not in this clone" "pre-push: an unknown remote sha is reported, not silently skipped"
sed 's/        if ! git cat-file -e "${__bl_rsha}^{commit}" 2>\/dev\/null; then/        if false; then/' "$SBX/.githooks/pre-push" > "$SBX/.githooks/pre-push.mut-ghost"
if cmp -s "$SBX/.githooks/pre-push" "$SBX/.githooks/pre-push.mut-ghost"; then fail "ghost mutation did not apply"; fi
run_push "HEAD $HEADSHA refs/heads/develop $GHOST" .githooks/pre-push.mut-ghost
assert_not_contains "$PUSH_OUT" "is not in this clone" "ghost mutation: a silent skip is caught (the suite can tell)"

# No config → warn mode: the loss is printed, the push is not blocked.
rm "$SBX/.claude/backlog-config.md"
run_push "HEAD $HEADSHA refs/heads/develop $BASE"; rc=$?
assert_eq "$rc" "0" "pre-push warn mode: the loss does not block"
assert_contains "$PUSH_OUT" "warning only, push not blocked" "pre-push warn mode: the violation is announced"
assert_contains "$PUSH_OUT" "peer_report_lost" "pre-push warn mode: the gate output is printed"
sed '/^      elif printf .%s. "\$__bl_out" | grep -qE /,/^        printf .\\nbacklog gate: %s (%s) has violations/d' "$SBX/.githooks/pre-push" > "$SBX/.githooks/pre-push.mut-warn"
if cmp -s "$SBX/.githooks/pre-push" "$SBX/.githooks/pre-push.mut-warn"; then fail "warn mutation did not apply"; fi
bash -n "$SBX/.githooks/pre-push.mut-warn" || fail "warn mutation broke the hook syntax"
run_push "HEAD $HEADSHA refs/heads/develop $BASE" .githooks/pre-push.mut-warn
assert_not_contains "$PUSH_OUT" "peer_report_lost" "warn mutation: a silent warn mode is caught (the suite can tell)"

finalize_test
