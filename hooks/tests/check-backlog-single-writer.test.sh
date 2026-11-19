#!/usr/bin/env bash
# hooks/tests/check-backlog-single-writer.test.sh - scripts/check-backlog-single-writer.js (pre-commit guard): with a hippo store
# present, BACKLOG.md and the store must agree whenever a change touches either. Negative controls: a hand edit of BACKLOG.md (a new
# row, or a field of a stored row) is red; a store op without its row is red; the same change through `project-record.js backlog
# new|reply|close` (which writes both) is green; a repo without a store is never blocked. Needs a hippo (see
# require_hippo_or_skip); prints SKIP and exits 0 without it.
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip check-backlog-single-writer
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
export HIPPO_BIN

GUARD="$REPO_ROOT/scripts/check-backlog-single-writer.js"
PR="$REPO_ROOT/scripts/project-record.js"
BL=docs/BACKLOG.md
guard() { OUT="$(node "$GUARD" --staged --target "$1" 2>&1 < /dev/null)"; RC=$?; }
pr() { local r="$1"; shift; ( cd "$r" && node "$PR" "$@" 2>&1 < /dev/null ); }
newrow() { # newrow <repo> <title> [origin flags, default --origin self] -> prints the record ULID
  local r="$1" t="$2"; shift 2
  [ $# -gt 0 ] || set -- --origin self
  ( cd "$r" && node "$PR" --json backlog new --title "$t" --trigger "when asked" --trigger-type ready --effort S \
      --source "self 2026-11-15" --problem "Problem of $t." --impact "Impact of $t." "$@" 2>/dev/null < /dev/null ) \
    | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).id)'
}

orphan() { # orphan <repo> <title>: a store record written straight with hippo (no BACKLOG.md row), with the row bullets a row needs
  printf -- '- **Since**: 2026-11-15\n- **Problem**: p\n- **Impact**: i\n- **Trigger**: when asked\n- **Source**: self 2026-11-15\n- **Pointer**: none\n' \
    | "$HIPPO_BIN" --json -C "$1" new issue --title "$2" --status open --tag origin:self --tag effort:s --tag trigger:ready --body-file - \
    | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).data.ids[0])'
}

mk() { # mk <name> [store]
  local r; r="$(hs_mkrepo "$1" "${2:-}")"
  mkdir -p "$r/docs" "$r/project/backlog"; printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$r/$BL"
  git -C "$r" add -A -f >/dev/null && git -C "$r" commit -q -m base || fail "base commit $1"
  printf '%s' "$r"
}

R="$(mk store store)"

# --- negative control: a hand-written row, no store record
printf '### hand row\n- **Id**: BL-0001\n- **Status**: open\n' >> "$R/$BL"
git -C "$R" add "$BL"
guard "$R"
assert_eq "$RC" 1 "hand-written BACKLOG.md row with a store present is red"
assert_contains "$OUT" "node scripts/project-record.js backlog" "red message names the writer"
git -C "$R" reset -q HEAD "$BL"; git -C "$R" checkout -q -- "$BL"

# --- positive: project-record writes the store and the row in one run
ID1="$(newrow "$R" "guard fixture row")"
assert_contains "$(cat "$R/$BL")" "### guard fixture row" "project-record backlog new wrote the row into BACKLOG.md"
assert_contains "$(cat "$R/$BL")" "- **Id**: BL-0001" "the row took the file's next id"
assert_contains "$(cat "$R/$BL")" "<!-- next-id: BL-0002 -->" "the next-id mark moved"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "a project-record backlog new (store op + row) is green"
git -C "$R" commit -q -m withop || fail "commit with op"

# --- negative control: hand edit of a field of a stored row
sed -i 's/^- \*\*Problem\*\*: Problem of guard fixture row\./- **Problem**: edited by hand./' "$R/$BL"
git -C "$R" add "$BL"
guard "$R"
assert_eq "$RC" 1 "hand edit of a stored row's field is red"
assert_contains "$OUT" "backlog_store_mismatch" "names the mismatch"
git -C "$R" reset -q HEAD "$BL"; git -C "$R" checkout -q -- "$BL"

# --- reply and close go through the writer too (peer row)
ID2="$(newrow "$R" "peer row" --origin peer --reporter tester --report "fleet 01ABC (tester, 2026-11-15)")"
assert_contains "$(cat "$R/$BL")" "- **Reply**: none" "peer row starts unanswered"
pr "$R" backlog reply "$ID2" --reply "2026-11-15 fleet 01XYZ" >/dev/null || fail "backlog reply"
assert_contains "$(cat "$R/$BL")" "- **Reply**: 2026-11-15 fleet 01XYZ" "reply landed in the row"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "new + reply through project-record is green"
git -C "$R" commit -q -m peer || fail "commit peer"
pr "$R" backlog close "$ID1" done >/dev/null || fail "backlog close"
assert_not_contains "$(cat "$R/$BL")" "### guard fixture row" "close removed the row"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "close through project-record is green"
git -C "$R" commit -q -m closed || fail "commit close"

# --- negative control: a writer run staged only in part (the worktree agrees, the commit would not)
ID3="$(newrow "$R" "partial stage row")"
git -C "$R" add -f .hippo
guard "$R"
assert_eq "$RC" 1 "staging only .hippo after a writer run is red"
assert_contains "$OUT" "$BL" "names the unstaged BACKLOG.md"
git -C "$R" reset -q; git -C "$R" add -f "$BL"
guard "$R"
assert_eq "$RC" 1 "staging only BACKLOG.md with .hippo dirty is red"
assert_contains "$OUT" ".hippo" "names the unstaged .hippo"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "staging BACKLOG.md and .hippo together is green"
git -C "$R" commit -q -m partial || fail "commit partial"
pr "$R" backlog close "$ID3" done >/dev/null || fail "backlog close partial"
git -C "$R" add -A -f; git -C "$R" commit -q -m partialclosed || fail "commit partial close"

# --- negative control: a store op with no row (BACKLOG.md untouched)
ORPHAN="$(orphan "$R" "orphan op")"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 1 "a store op without its BACKLOG.md row is red"
assert_contains "$OUT" "backlog_unprojected" "names the unprojected record"
assert_contains "$OUT" "$ORPHAN" "names the record id"

# --- the repair command projects it, and the commit is green
pr "$R" backlog sync "$ORPHAN" >/dev/null || fail "backlog sync"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "backlog sync puts the row in and the tree agrees again"
git -C "$R" commit -q -m synced || fail "commit sync"

# --- known drift listed in project/backlog/store-drift.json passes; a stale entry fails (the list only shrinks)
ORPHAN2="$(orphan "$R" "tolerated orphan")"
printf '{"records":{"%s":"test"}}\n' "$ORPHAN2" > "$R/project/backlog/store-drift.json"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 0 "a listed known-drift record passes"
printf '{"records":{"%s":"test","01AAAAAAAAAAAAAAAAAAAAAAAA":"gone"}}\n' "$ORPHAN2" > "$R/project/backlog/store-drift.json"
git -C "$R" add -A -f
guard "$R"
assert_eq "$RC" 1 "a drift entry that no longer drifts is red"
assert_contains "$OUT" "remove it from the list" "tells to remove the stale entry"
git -C "$R" reset -q; git -C "$R" checkout -q -- . ; rm -f "$R/project/backlog/store-drift.json"

# --- range mode: a base..head with a hand edit is red
base="$(git -C "$R" rev-parse HEAD)"
printf '### range hand row\n- **Id**: BL-0099\n- **Status**: open\n' >> "$R/$BL"; git -C "$R" commit -q -am direct
OUT="$(node "$GUARD" --range "$base..HEAD" --target "$R" 2>&1 < /dev/null)"; RC=$?
assert_eq "$RC" 1 "range with a hand edit is red"

# --- rename: a fully staged rename is not "unstaged" (porcelain -z gives "R  dest\0orig\0"); renamed then edited is
RN="$(mk renamed store)"
git -C "$RN" mv "$BL" project/backlog/BACKLOG.md
guard "$RN"
assert_not_contains "$OUT" "unstaged changes" "a fully staged rename of BACKLOG.md is not reported as unstaged"
printf 'late edit\n' >> "$RN/project/backlog/BACKLOG.md"
guard "$RN"
assert_eq "$RC" 1 "a renamed then edited BACKLOG.md is red"
assert_contains "$OUT" "unstaged changes in: project/backlog/BACKLOG.md" "names the edited renamed file"

# --- no store: never blocked
N="$(mk nostore)"
printf 'x\n' >> "$N/$BL"; git -C "$N" add "$BL"
guard "$N"
assert_eq "$RC" 0 "repo without a hippo store is not guarded"

# --- usage
node "$GUARD" --bogus >/dev/null 2>&1 < /dev/null; assert_eq "$?" 2 "unknown flag exits 2"

# --- Fix 5: check-backlog-entries.js --hippo --reconcile reads project/backlog/store-drift.json directly
GATE_JS="$REPO_ROOT/scripts/check-backlog-entries.js"
RD="$(mk recdrift store)"
SD1="$(orphan "$RD" "store drift one")"
SD2="$(orphan "$RD" "store drift two")"
REC_OUT="$(node "$GATE_JS" --hippo --reconcile --target "$RD" 2>/dev/null < /dev/null)"; REC_RC=$?
assert_eq "$REC_RC" 1 "reconcile without store-drift.json blocks on unprojected records"
assert_eq "$(printf '%s' "$REC_OUT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.new_count + ":" + d.allowed_count)')" "2:0" "unlisted drift counts in new_count (2:0)"
printf '{"records":{"%s":"legacy one","%s":"legacy two"}}\n' "$SD1" "$SD2" > "$RD/project/backlog/store-drift.json"
REC_OUT="$(node "$GATE_JS" --hippo --reconcile --target "$RD" 2>/dev/null < /dev/null)"; REC_RC=$?
assert_eq "$REC_RC" 0 "reconcile with both drifting records listed in store-drift.json exits 0"
assert_eq "$(printf '%s' "$REC_OUT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log([d.exit, d.new_count, d.allowed_count, d.violations.every(v => v.allowed === true), d.reconcile.drift.every(x => x.allowed === true)].join(":"))')" "0:0:2:true:true" "listed drift is reported with allowed:true and counted in allowed_count (2), not new_count (0)"
SD3="$(orphan "$RD" "store drift unlisted")"
REC_OUT="$(node "$GATE_JS" --hippo --reconcile --target "$RD" 2>/dev/null < /dev/null)"; REC_RC=$?
assert_eq "$REC_RC" 1 "reconcile with an unlisted drifting record blocks even when store-drift.json is present"
assert_eq "$(printf '%s' "$REC_OUT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.new_count + ":" + d.allowed_count)')" "1:2" "listed records stay in allowed_count (2) while new drift increments new_count (1)"
pr "$RD" backlog close "$SD3" cancelled >/dev/null || fail "close SD3"
printf '{"records":{"%s":"legacy one","%s":"legacy two","01ZZZZZZZZZZZZZZZZZZZZZZZZ":"no longer drifts"}}\n' "$SD1" "$SD2" > "$RD/project/backlog/store-drift.json"
REC_OUT="$(node "$GATE_JS" --hippo --reconcile --target "$RD" 2>/dev/null < /dev/null)"; REC_RC=$?
assert_eq "$REC_RC" 1 "reconcile fails when a store-drift.json record no longer drifts"
assert_eq "$(printf '%s' "$REC_OUT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.new_count + ":" + d.allowed_count)')" "1:2" "stale store-drift entry counts in new_count (1:2)"
assert_contains "$REC_OUT" "remove it from the list" "reconcile reports stale store-drift entry removal hint"

# --- Fix 1: project-record.js backlog import <BL-id> imports an unstored BACKLOG.md row with no file edit
RI="$(mk recimp store)"
cat > "$RI/$BL" <<'EOF'
# BACKLOG

<!-- next-id: BL-0002 -->

### Hand-planted backlog row awaiting import
- **Id**: BL-0001
- **Status**: open
- **Since**: 2026-11-17
- **Origin**: peer
- **Reporter**: PM
- **Report**: 01M7MW5VV0CK85HZ4AY57WPZ1Y
- **Reply**: 2026-11-17 01M7MW3W1FBJ5Q006DH26FTWT3
- **Problem**: Row was committed directly to BACKLOG.md without a hippo store record.
- **Impact**: Reconcile fails with backlog_unimported.
- **Trigger**: ready
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: PEER-REPORTED PM 2026-11-17
- **Pointer**: none
EOF
RI_BEFORE="$(cksum < "$RI/$BL")"
node "$GATE_JS" --hippo --reconcile --target "$RI" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 1 "before backlog import, reconcile fails"
pr "$RI" backlog import BL-0001 >/dev/null || fail "backlog import BL-0001"
assert_eq "$RI_BEFORE" "$(cksum < "$RI/$BL")" "backlog import does not modify BACKLOG.md"
node "$GATE_JS" --hippo --reconcile --target "$RI" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 0 "after backlog import, reconcile exits 0"
git -C "$RI" add -A
guard "$RI"
assert_eq "$RC" 0 "single-writer guard is green after backlog import"

# --- Fix 3: .githooks/pre-merge-commit refuses git merge --no-ff of a hand-edited BACKLOG.md branch
RM="$(hs_mkrepo mergehook store)"
mkdir -p "$RM/docs" "$RM/project/backlog" "$RM/scripts" "$RM/.githooks"
printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$RM/$BL"
cp "$REPO_ROOT/.githooks/pre-merge-commit" "$RM/.githooks/pre-merge-commit"
chmod +x "$RM/.githooks/pre-merge-commit"
ln -s "$REPO_ROOT/scripts/check-backlog-single-writer.js" "$RM/scripts/check-backlog-single-writer.js"
git -C "$RM" config core.hooksPath "$RM/.githooks"
git -C "$RM" config autopilot.testIdentityGate off
git -C "$RM" add -A >/dev/null && git -C "$RM" commit -q --no-verify -m "base with hook" || fail "mergehook base"
BASE_BR="$(git -C "$RM" symbolic-ref --short HEAD)"
git -C "$RM" checkout -q -b bad-hand-branch
printf '### branch hand row\n- **Id**: BL-0001\n- **Status**: open\n' >> "$RM/$BL"
git -C "$RM" add "$BL" && git -C "$RM" commit -q --no-verify -m "hand edit on branch" || fail "bad branch commit"
git -C "$RM" checkout -q "$BASE_BR"
git -C "$RM" commit -q --allow-empty --no-verify -m "advance base" || fail "advance base"
MERGE_OUT="$(git -C "$RM" merge --no-ff -m "merge bad branch" bad-hand-branch 2>&1 < /dev/null)"; MERGE_RC=$?
assert_eq "$MERGE_RC" 1 "pre-merge-commit refuses git merge --no-ff when branch hand-edited BACKLOG.md"
assert_contains "$MERGE_OUT" "backlog single-writer gate failed" "pre-merge-commit prints refusal banner"
assert_contains "$MERGE_OUT" "node scripts/project-record.js backlog" "pre-merge-commit names the writer"
git -C "$RM" merge --abort 2>/dev/null || git -C "$RM" reset --hard -q HEAD
git -C "$RM" checkout -q -b good-writer-branch
newrow "$RM" "writer branch row" >/dev/null || fail "newrow on good branch"
git -C "$RM" add -A && git -C "$RM" commit -q --no-verify -m "writer edit on branch" || fail "good branch commit"
git -C "$RM" checkout -q "$BASE_BR"
MERGE_OK_OUT="$(git -C "$RM" merge --no-ff -m "merge good branch" good-writer-branch 2>&1 < /dev/null)"; MERGE_OK_RC=$?
assert_eq "$MERGE_OK_RC" 0 "pre-merge-commit allows git merge --no-ff when branch used project-record.js ($MERGE_OK_OUT)"

# --- Fix 2: scripts/dispatch-hetero.sh rejects a hand that edits BACKLOG.md directly (boundary_rejected / backlog_single_writer)
HETERO_SH="$REPO_ROOT/scripts/dispatch-hetero.sh"
RH="$(hs_mkrepo heterogate store)"
git -C "$RH" branch -M develop
mkdir -p "$RH/docs" "$RH/project/backlog"
printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$RH/$BL"
git -C "$RH" add -A >/dev/null && git -C "$RH" commit -q -m "base with clean store" || fail "heterogate base"
BSW_CAP_DIR="$TEST_TMP/bsw-cap"; BSW_SM_DIR="$TEST_TMP/bsw-sm"; BSW_LIVE_DIR="$TEST_TMP/bsw-live"
mkdir -p "$BSW_CAP_DIR" "$BSW_SM_DIR" "$BSW_LIVE_DIR"
chmod 700 "$BSW_LIVE_DIR"
BSW_PROMPT="$TEST_TMP/bsw-prompt.txt"
printf 'update backlog\n' > "$BSW_PROMPT"
BSW_AGY_ENV="$TEST_TMP/bsw-agy-envelope"
cat > "$BSW_AGY_ENV" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({
  conversation_id: "bsw-fixture",
  duration_seconds: 1,
  num_turns: 1,
  response: "done",
  status: "SUCCESS",
  usage: { cache_read_tokens: 0, input_tokens: 10, output_tokens: 5, thinking_tokens: 0, total_tokens: 15 }
}))'
EOF
chmod +x "$BSW_AGY_ENV"
STUB_HAND_BYPASS="$TEST_TMP/agy-hand-bypass"
cat > "$STUB_HAND_BYPASS" <<EOF
#!/usr/bin/env bash
printf '### fake hand bypass\n- **Id**: BL-0001\n- **Status**: open\n' >> docs/BACKLOG.md
git -c core.hooksPath=/dev/null add docs/BACKLOG.md
git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -q --no-verify -m "chore: direct backlog edit"
"$BSW_AGY_ENV"
EOF
chmod +x "$STUB_HAND_BYPASS"
make_agy_stub_versioned "$STUB_HAND_BYPASS"
STUB_HAND_CLEAN="$TEST_TMP/agy-hand-clean"
cat > "$STUB_HAND_CLEAN" <<EOF
#!/usr/bin/env bash
echo clean > unrelated.txt
git -c core.hooksPath=/dev/null add unrelated.txt
git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -q --no-verify -m "chore: unrelated file"
"$BSW_AGY_ENV"
EOF
chmod +x "$STUB_HAND_CLEAN"
make_agy_stub_versioned "$STUB_HAND_CLEAN"
STUB_HAND_WRITER="$TEST_TMP/agy-hand-writer"
cat > "$STUB_HAND_WRITER" <<EOF
#!/usr/bin/env bash
node "$PR" backlog new --title "Hand writer row" --trigger "when asked" --trigger-type ready --effort S \
  --origin self --source "self 2026-11-18" --problem "Problem via writer." --impact "Impact via writer." >/dev/null
git -c core.hooksPath=/dev/null add -A
git -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -q --no-verify -m "chore: backlog via writer"
"$BSW_AGY_ENV"
EOF
chmod +x "$STUB_HAND_WRITER"
make_agy_stub_versioned "$STUB_HAND_WRITER"

run_hetero_case() {
  (
    cd "$RH" || exit 99
    unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
      AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
      AUTOPILOT_DISPATCH_DEPTH
    ENGINE_CAPABILITY_DIR="$BSW_CAP_DIR" \
    AUTOPILOT_SESSION_MODE_DIR="$BSW_SM_DIR" \
    AUTOPILOT_LIVE_DIR="$BSW_LIVE_DIR" \
    AUTOPILOT_DISPATCH_USAGE=off \
    AUTOPILOT_CODEFORGE_COLLECT=off \
      bash "$HETERO_SH" --no-verify-tip --runner agy "$@" < /dev/null
  )
}

H_BAD_OUT="$(run_hetero_case --branch fix/hand-bypass --prompt-file "$BSW_PROMPT" --agy-bin "$STUB_HAND_BYPASS" 2>"$TEST_TMP/h-bad.err")"; H_BAD_RC=$?
assert_eq "$H_BAD_RC" 1 "dispatch-hetero exits 1 when fake hand edits BACKLOG.md directly"
assert_eq "$(printf '%s' "$H_BAD_OUT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.status + ":" + d.boundary_code)')" \
  "boundary_rejected:backlog_single_writer" "dispatch-hetero emits status boundary_rejected and boundary_code backlog_single_writer"
H_BAD_LOG="$(printf '%s' "$H_BAD_OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).agent_log)')"
assert_file_exists "$H_BAD_LOG" "dispatch-hetero writes agent_log on backlog_single_writer rejection"
assert_contains "$(cat "$H_BAD_LOG")" "backlog_unimported" "agent_log records the single-writer checker output"
assert_contains "$(cat "$H_BAD_LOG")" "node scripts/project-record.js backlog" "agent_log records the writer remediation"
H_BAD_WT="$(printf '%s' "$H_BAD_OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).worktree)')"
[ -n "$H_BAD_WT" ] && git -C "$RH" worktree remove --force "$H_BAD_WT" >/dev/null 2>&1 || true

H_CLEAN_OUT="$(run_hetero_case --branch fix/hand-clean --prompt-file "$BSW_PROMPT" --agy-bin "$STUB_HAND_CLEAN" 2>"$TEST_TMP/h-clean.err")"; H_CLEAN_RC=$?
assert_eq "$H_CLEAN_RC" 0 "dispatch-hetero leaves non-backlog commits unchanged ($H_CLEAN_OUT)"
assert_contains "$H_CLEAN_OUT" '"status": "committed"' "non-backlog hand commit succeeds as committed"

H_WRITER_OUT="$(run_hetero_case --branch fix/hand-writer --prompt-file "$BSW_PROMPT" --agy-bin "$STUB_HAND_WRITER" 2>"$TEST_TMP/h-writer.err")"; H_WRITER_RC=$?
assert_eq "$H_WRITER_RC" 0 "dispatch-hetero accepts a hand commit made through project-record.js ($H_WRITER_OUT)"
assert_contains "$H_WRITER_OUT" '"status": "committed"' "writer-backed hand commit succeeds as committed"

# --- Fix 4: scripts/admit-backlog-follow-ups.js routes through project-record.js when a hippo store exists
ADMIT_JS="$REPO_ROOT/scripts/admit-backlog-follow-ups.js"
MVP_JS="$REPO_ROOT/scripts/review-mvp-portfolio.js"
PANEL_JSON="$TEST_TMP/admit-panel.json"
PORTFOLIO_JSON="$TEST_TMP/admit-portfolio.json"
node - "$PANEL_JSON" <<'NODE'
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema_version: 1,
  roster: ['rev-a'],
  budget: 3,
  acceptance_prerequisites: ['core'],
  reviewers: [{
    reviewer_id: 'rev-a',
    assessments: [
      {
        item_id: 'core',
        title: 'Ship core slice',
        classification: 'MUST-FIX',
        evidence: 'Spec A1 requires core slice.',
        evidence_kind: 'spec',
        evidence_verified: true,
        scores: { acceptance: 10, risk: 9, value: 9, cost: 3 },
      },
      {
        item_id: 'followup-1',
        title: 'Automate store drift audit',
        classification: 'CUT/FOLLOW-UP',
        evidence: 'Test T4 recorded manual step.',
        evidence_kind: 'test',
        evidence_verified: true,
        scores: { acceptance: 4, risk: 5, value: 7, cost: 2 },
        follow_up: {
          context: 'Manual store drift audit remains after core slice.',
          trigger: 'When second repository adopts hippo backlog mode',
          proposed_backlog_title: 'Automate cross-repo store drift audit',
        },
      },
    ],
  }],
}, null, 2));
NODE
node "$MVP_JS" --input "$PANEL_JSON" > "$PORTFOLIO_JSON" || fail "build portfolio fixture"

RA="$(mk admitstore store)"
DRY_REC="$(node "$ADMIT_JS" --input "$PORTFOLIO_JSON" --backlog "$RA/$BL" --current-ticket BSW-1 --dry-run < /dev/null)"; DRY_RC=$?
assert_eq "$DRY_RC" 0 "admit-backlog-follow-ups --dry-run with store exits 0"
assert_eq "$(printf '%s' "$DRY_REC" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log([r.dry_run, r.admitted.length, r.backlog_before_digest === r.backlog_after_digest, r.proposed_backlog_digest !== r.backlog_before_digest].join(":"))')" \
  "true:1:true:true" "--dry-run keeps store/file unchanged while computing proposed_backlog_digest"
node "$GATE_JS" --hippo --reconcile --target "$RA" >/dev/null 2>&1 < /dev/null; assert_eq "$?" 0 "reconcile stays clean after --dry-run"

LIVE_REC="$(node "$ADMIT_JS" --input "$PORTFOLIO_JSON" --backlog "$RA/$BL" --current-ticket BSW-1 < /dev/null)"; LIVE_RC=$?
assert_eq "$LIVE_RC" 0 "admit-backlog-follow-ups with store exits 0"
assert_eq "$(printf '%s' "$LIVE_REC" | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const keys = ["schema_version","artifact_type","current_ticket","current_ticket_reopened","admitted","duplicate","rejected","backlog_before_digest","backlog_after_digest","proposed_backlog_digest","dry_run","receipt_digest"];
  const hasAll = keys.every((k) => Object.prototype.hasOwnProperty.call(r, k));
  console.log([hasAll, r.admitted.length, r.duplicate.length, r.backlog_after_digest === r.proposed_backlog_digest, r.backlog_before_digest !== r.backlog_after_digest].join(":"));
')" "true:1:0:true:true" "admit-backlog-follow-ups preserves receipt fields and updates BACKLOG.md"
REC_ADMIT="$(node "$GATE_JS" --hippo --reconcile --target "$RA" 2>/dev/null < /dev/null)"; REC_ADMIT_RC=$?
assert_eq "$REC_ADMIT_RC" 0 "after admit-backlog-follow-ups with a store, reconcile reports no drift ($REC_ADMIT)"
assert_eq "$(printf '%s' "$REC_ADMIT" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log([d.new_count, d.reconcile.checked, d.reconcile.missing.length, d.reconcile.drift.length].join(":"))')" \
  "0:1:0:0" "admitted candidate exists in both BACKLOG.md and hippo store with zero drift"

DUP_REC="$(node "$ADMIT_JS" --input "$PORTFOLIO_JSON" --backlog "$RA/$BL" --current-ticket BSW-1 < /dev/null)"; DUP_RC=$?
assert_eq "$DUP_RC" 0 "second admit-backlog-follow-ups run with store exits 0"
assert_eq "$(printf '%s' "$DUP_REC" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(r.admitted.length + ":" + r.duplicate.length)')" \
  "0:1" "second run deduplicates already-admitted candidate"

RAF="$(mk admitfiles)"
FILES_REC="$(node "$ADMIT_JS" --input "$PORTFOLIO_JSON" --backlog "$RAF/$BL" --current-ticket BSW-1 < /dev/null)"; FILES_RC=$?
assert_eq "$FILES_RC" 0 "admit-backlog-follow-ups without store still exits 0"
assert_contains "$(cat "$RAF/$BL")" "<!-- autopilot-follow-up:" "store-less repo keeps direct follow-up marker write"

# --- Commit 2: zh-TW refusal message, hand-raised next-id refusal, and .githooks/pre-commit via git commit
RNID="$(mk nextid store)"
sed -i 's/<!-- next-id: BL-0001 -->/<!-- next-id: BL-0099 -->/' "$RNID/$BL"
git -C "$RNID" add "$BL"
guard "$RNID"
assert_eq "$RC" 1 "hand-raised next-id without adding matching rows is red"
assert_contains "$OUT" "next_id_hand_edited" "names next_id_hand_edited"
assert_contains "$OUT" "禁止直接手改 BACKLOG.md" "refusal uses zh-TW message"
assert_contains "$OUT" "node scripts/project-record.js backlog new|sync" "refusal points at project-record.js backlog new|sync"

# negative control: mutating ENFORCE_NEXT_ID_GUARD to false in a temp copy stops catching hand-raised next-id
MUT_SCRIPTS="$TEST_TMP/mut-scripts"
cp -r "$REPO_ROOT/scripts" "$MUT_SCRIPTS"
sed -i 's/const ENFORCE_NEXT_ID_GUARD = true;/const ENFORCE_NEXT_ID_GUARD = false;/' "$MUT_SCRIPTS/check-backlog-single-writer.js"
grep -q 'const ENFORCE_NEXT_ID_GUARD = false;' "$MUT_SCRIPTS/check-backlog-single-writer.js" || fail "mutation anchor drifted: ENFORCE_NEXT_ID_GUARD = true not found in check-backlog-single-writer.js"
MUT_OUT="$(node "$MUT_SCRIPTS/check-backlog-single-writer.js" --staged --target "$RNID" 2>&1 < /dev/null)"; MUT_RC=$?
assert_eq "$MUT_RC" 0 "mutant without next-id guard fails to catch hand-raised next-id ($MUT_OUT)"
git -C "$RNID" reset -q HEAD "$BL"; git -C "$RNID" checkout -q -- "$BL"

# real .githooks/pre-commit through git commit: hand row -> refused, hand next-id -> refused, writer write -> allowed
# the repo carries its own copy of scripts/, so the dev-checkout rule applies: the plugin dir is only usable as a store with the committed id "autopilot"
RBL=docs/BACKLOG.md
RPC="$(hs_mkrepo precommit)"
"$HIPPO_BIN" --json -C "$RPC" init --visibility internal --id autopilot >/dev/null || fail "hippo init precommit"
mkdir -p "$RPC/docs" "$RPC/hooks/tests/lib" "$RPC/references"
printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n' > "$RPC/$RBL"
cp -r "$REPO_ROOT/.githooks" "$RPC/.githooks"
chmod +x "$RPC/.githooks/"*
cp -r "$REPO_ROOT/scripts" "$RPC/scripts"
# the manifest sync rituals need the whole plugin tree; this scratch repo only exercises the single-writer step of the real hook
printf '#!/usr/bin/env bash\nexit 0\n' > "$RPC/scripts/sync-all.sh"
cp -r "$REPO_ROOT/hooks/_shared" "$RPC/hooks/_shared"
# the copied scripts/ make project-detect see the plugin layout; pin the layout the way a consumer repo does
cp -r "$REPO_ROOT/hooks/tests/fixtures/record-files/base/dot-claude" "$RPC/.claude"
cp "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh" "$RPC/hooks/tests/lib/suite-residue-reap.sh"
cp "$REPO_ROOT/references/blind-dispatch.md" "$RPC/references/blind-dispatch.md"
git -C "$RPC" config core.hooksPath "$RPC/.githooks"
# the harness exports a test author (t@t) that the pre-commit test-identity gate refuses; real commits below use a non-test one
pcommit() { GIT_AUTHOR_NAME="Precommit Lane" GIT_AUTHOR_EMAIL="lane@autopilot-precommit.dev" GIT_COMMITTER_NAME="Precommit Lane" GIT_COMMITTER_EMAIL="lane@autopilot-precommit.dev" git -C "$RPC" commit "$@"; }
git -C "$RPC" add -A -f >/dev/null && git -C "$RPC" commit -q --no-verify -m "precommit base" || fail "precommit base"

printf '### hand bypass row\n- **Id**: BL-0001\n- **Status**: open\n' >> "$RPC/$RBL"
git -C "$RPC" add "$RBL"
PC_HAND="$(pcommit -m "hand row bypass" 2>&1 < /dev/null)"; PC_HAND_RC=$?
assert_eq "$PC_HAND_RC" 1 "git commit via .githooks/pre-commit refuses hand-added BACKLOG.md row"
assert_contains "$PC_HAND" "backlog single-writer gate failed" "pre-commit prints single-writer banner"
assert_contains "$PC_HAND" "node scripts/project-record.js backlog new|sync" "pre-commit points at backlog new|sync"
git -C "$RPC" reset -q HEAD "$RBL"; git -C "$RPC" checkout -q -- "$RBL"

sed -i 's/<!-- next-id: BL-0001 -->/<!-- next-id: BL-0050 -->/' "$RPC/$RBL"
git -C "$RPC" add "$RBL"
PC_NID="$(pcommit -m "hand next-id bypass" 2>&1 < /dev/null)"; PC_NID_RC=$?
assert_eq "$PC_NID_RC" 1 "git commit via .githooks/pre-commit refuses hand-raised next-id"
assert_contains "$PC_NID" "next_id_hand_edited" "pre-commit names next_id_hand_edited"
git -C "$RPC" reset -q HEAD "$RBL"; git -C "$RPC" checkout -q -- "$RBL"

newrow "$RPC" "precommit writer row" >/dev/null || fail "newrow in RPC"
git -C "$RPC" add -A -f >/dev/null
PC_OK="$(pcommit -m "writer backlog commit" 2>&1 < /dev/null)"; PC_OK_RC=$?
assert_eq "$PC_OK_RC" 0 "git commit via .githooks/pre-commit allows project-record.js write ($PC_OK)"

finalize_test
