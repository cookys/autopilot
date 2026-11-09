#!/usr/bin/env bash
# hooks/tests/project-record.test.sh - scripts/project-record.js against the REAL hippo binary (plan 2026-11-02-oc-a3-writers-use-hippo,
# A3.1 steps 2 and 4): the PM red line (with a store present a hippo failure never writes a file-mode target), files-mode dispatch,
# every subcommand in hippo mode, parity with `hippo import --from autopilot-backlog`, validation in both modes, fault reruns,
# the refused-child retry, --target and plugin-dir refusal, read commands leaving the checkout alone, the `record_store` resolver
# field and the session-start spool line.
# Needs a hippo >= 0.2.2 (HIPPO_BIN, else hippo on PATH); prints SKIPPED and exits 0 without it. Every repo is a temp repo under a sandbox
# HOME (hooks/tests/lib/hippo-sandbox.sh, C6). AP_PLUGIN_ROOT (default: this checkout) names the tree whose scripts/ and hooks/ are
# under test, so red-checks mutate a temp copy and never this checkout. Red-checks: docs/plans/evidence/2026-11-02-oc-a3-writers-use-hippo/a3.1-cli/.
. "$(dirname "$0")/lib.sh"
HIPPO_BIN="${HIPPO_BIN:-$(command -v hippo 2>/dev/null)}"
if [ -z "$HIPPO_BIN" ]; then echo "SKIPPED: no hippo (HIPPO_BIN unset, none on PATH)"; exit 0; fi
export HIPPO_BIN
HIPPO_BIN="$(command -v "$HIPPO_BIN")" || fail "HIPPO_BIN is not executable"
export HIPPO_BIN
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup

PLUGIN="${AP_PLUGIN_ROOT:-$REPO_ROOT}"
PR="$PLUGIN/scripts/project-record.js"
FIX="$REPO_ROOT/hooks/tests/fixtures/record-files/base"
export PROJECT_RECORD_NOW="2026-11-09T12:00:00.000Z"
H() { "$HIPPO_BIN" --json -C "$1" "${@:2}"; }
jf() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const v=eval(process.argv[1]); console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
ULID_RE='^[0-9A-HJKMNP-TV-Z]{26}$'

# pr <args...>: runs project-record.js from the temp root; sets RC, OUT (stdout), ERR (stderr).
pr() {
  OUT="$(cd "$TEST_TMP" && node "$PR" "$@" 2>"$TEST_TMP/pr.err")"; RC=$?
  ERR="$(cat "$TEST_TMP/pr.err")"
}
pr_in() { # pr_in <stdin-text> <args...>
  local text="$1"; shift
  OUT="$(cd "$TEST_TMP" && printf '%s' "$text" | node "$PR" "$@" 2>"$TEST_TMP/pr.err")"; RC=$?
  ERR="$(cat "$TEST_TMP/pr.err")"
}
key_of() { printf '%s\n' "$ERR" | sed -n 's/^record key: \([0-9a-f]\{16\}\) .*/\1/p' | head -1; }
key_count() { H "$1" list --tag "key:$2" --history | jf 'd.data.records.length'; }
key_id() { H "$1" list --tag "key:$2" --history | jf 'd.data.records[0].id'; }
all_count() { H "$1" list --history | jf 'd.data.records.length'; }
spool_dir() { echo "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)/autopilot/hippo-spool"; }
spool_count() { find "$(spool_dir "$1")" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
edges() { H "$1" related "$2" --rel "$3" --depth 1 | jf 'd.data.edges.filter(e=>e.state==="present").length'; }
hash_tree() { # sha256 of the file-mode targets of a fixture repo
  (cd "$1" && { sha256sum docs/BACKLOG.md; find docs/backlog -type f -exec sha256sum {} + | sort; } 2>/dev/null)
}
new_issue() { H "$1" new issue --title "$2" | jf 'd.data.ids[0]'; }

# mk_fixture <name> [store]: a temp repo carrying the record-files fixture tree (docs/BACKLOG.md ...), optionally with a hippo store.
mk_fixture() {
  local repo
  repo="$(hs_mkrepo "$1" "${2:-}")"
  cp -r "$FIX/docs" "$repo/docs"
  cp -r "$FIX/dot-claude" "$repo/.claude"
  git -C "$repo" add -A -f >/dev/null
  git -C "$repo" commit -q -m fixture || fail "mk_fixture commit $1"
  printf '%s' "$repo"
}

BL_FLAGS=(--trigger "when it is asked" --trigger-type ready --effort S --origin self --source "self 2026-11-09" --problem "A problem." --impact "Some impact.")
printf 'because it is better\n' > "$TEST_TMP/why.md"
printf '## Context\nctx\n## Problem\nprob\n## Solution\nsol\n' > "$TEST_TMP/lesson.md"
printf '## Done\nd\n## Next\nn\n' > "$TEST_TMP/handoff-bad.md"

# --- usage errors: exit 2, nothing written
R_USE="$(mk_fixture usage)"
H0="$(hash_tree "$R_USE")"
pr --target "$R_USE" backlog new --bogus 1; eq 2 "$RC" "unknown flag -> exit 2"
assert_contains "$ERR" "unknown flag: --bogus" "unknown flag is named"
pr --target "$R_USE" backlog new --count 3; eq 2 "$RC" "--count -> exit 2"
assert_contains "$ERR" "no counter fields" "counter flags are refused by name"
pr --target "$R_USE" backlog new --title; eq 2 "$RC" "flag without a value -> exit 2"
pr --target "$R_USE" nonsense; eq 2 "$RC" "unknown subcommand -> exit 2"
pr --target "$R_USE" --key nothex backlog new; eq 2 "$RC" "bad --key -> exit 2"
pr; eq 2 "$RC" "no subcommand -> exit 2"
eq "$H0" "$(hash_tree "$R_USE")" "usage errors write nothing"

# --- files mode: thin dispatch to record-files.js, info line, validation exit 3 with nothing written
pr --target "$R_USE" --json backlog new --title "Files mode row" "${BL_FLAGS[@]}"
eq 0 "$RC" "files mode: backlog new -> exit 0"
assert_contains "$ERR" "record store: files (no .hippo store in $R_USE)" "files mode prints the store info line"
assert_contains "$(cat "$R_USE/docs/BACKLOG.md")" "### Files mode row" "files mode wrote the row"
eq BL-0006 "$(printf '%s' "$OUT" | jf d.id)" "files mode: id comes from next-id"
H1="$(hash_tree "$R_USE")"
pr --target "$R_USE" backlog new --title "Bad row" --origin self; eq 3 "$RC" "files mode: missing fields -> exit 3"
eq "$H1" "$(hash_tree "$R_USE")" "files mode: validation failure writes nothing"
pr --target "$R_USE" backlog close BL-0003 cancelled; eq 0 "$RC" "files mode: close"
pr --target "$R_USE" backlog reply BL-0001 --reply "2026-11-09 fleet:m1"; eq 0 "$RC" "files mode: reply"
assert_contains "$(cat "$R_USE/docs/BACKLOG.md")" "2026-11-09 fleet:m1" "files mode: reply written"
pr_in "$(cat "$TEST_TMP/why.md")" --target "$R_USE" decision new --title "A decision" --rationale-file -; eq 0 "$RC" "files mode: decision new from stdin"
pr --target "$R_USE" lesson new --title "A lesson" --category build --body-file "$TEST_TMP/lesson.md"; eq 0 "$RC" "files mode: lesson new"
pr --target "$R_USE" lesson new --title "A lesson" --category build --body-file "$TEST_TMP/why.md"; eq 3 "$RC" "files mode: lesson without sections -> exit 3"
pr --target "$R_USE" where; eq 0 "$RC" "files mode: where"
assert_contains "$OUT" "record store: files" "where names the state"

# --- hippo mode: each subcommand -> expected records and edges
R_H="$(hs_mkrepo hmode store)"
pr --target "$R_H" --json backlog new --title "Hippo row" "${BL_FLAGS[@]}"
eq 0 "$RC" "hippo: backlog new -> exit 0"
BL1="$(printf '%s' "$OUT" | jf d.id)"
[[ "$BL1" =~ $ULID_RE ]] && eq 1 1 "hippo: backlog new returns a 26-char ULID" || fail "hippo: id is not a ULID: $BL1"
assert_contains "$ERR" "record key: " "hippo: the retry key is printed"
SHOW="$(H "$R_H" show "$BL1")"
eq "Hippo row" "$(printf '%s' "$SHOW" | jf d.data.record.title)" "hippo: title"
eq issue "$(printf '%s' "$SHOW" | jf d.data.record.kind)" "hippo: kind issue"
eq debt "$(printf '%s' "$SHOW" | jf d.data.record.type)" "hippo: default type debt"
eq open "$(printf '%s' "$SHOW" | jf d.data.record.status)" "hippo: status open"
eq "effort:s,origin:self,trigger:ready" "$(printf '%s' "$SHOW" | jf 'd.data.record.tags.filter(t=>!t.startsWith("key:")).join(",")')" "hippo: tags"
assert_contains "$(printf '%s' "$SHOW" | jf d.data.record.body)" "- **Since**: 2026-11-09" "hippo: Since bullet from the pinned clock"
assert_file_absent "$R_H/docs" "hippo: no docs/ file-mode target appears"

pr --target "$R_H" --json backlog new --title "Second row" --relates "$BL1" "${BL_FLAGS[@]}"
BL2="$(printf '%s' "$OUT" | jf d.id)"
eq 1 "$(edges "$R_H" "$BL2" relates_to)" "hippo: --relates creates a relates_to edge"
pr --target "$R_H" --json backlog new --title "Peer row" --origin peer --reporter cuda --report "2026-11-09 fleet" --trigger "asked" --trigger-type peer --effort "S" --source "PEER-REPORTED cuda 2026-11-09" --problem "P." --impact "I."
eq 0 "$RC" "hippo: peer row created"
BLP="$(printf '%s' "$OUT" | jf d.id)"
assert_contains "$(H "$R_H" show "$BLP" | jf 'd.data.record.tags.join(",")')" "reporter:cuda" "hippo: reporter tag"
pr --target "$R_H" backlog close "$BLP" done; eq 3 "$RC" "hippo: closing a peer row with no reply is refused (exit 3)"
pr --target "$R_H" backlog reply "$BLP" --reply "2026-11-09 fleet:m1"; eq 0 "$RC" "hippo: backlog reply"
assert_contains "$(H "$R_H" show "$BLP" | jf d.data.record.body)" "- **Reply**: 2026-11-09 fleet:m1" "hippo: Reply bullet replaced"
pr --target "$R_H" backlog reply "$BLP" --reply "garbage"; eq 3 "$RC" "hippo: bad reply -> exit 3"
SHA="$(git -C "$R_H" rev-parse HEAD)"
pr --target "$R_H" backlog close "$BLP" done --commit HEAD --by "$BL1"; eq 0 "$RC" "hippo: backlog close with --commit and --by"
eq done "$(H "$R_H" show "$BLP" | jf d.data.record.status)" "hippo: closed done"
eq 1 "$(edges "$R_H" "$BLP" implemented_by)" "hippo: implemented_by edge"
assert_contains "$(H "$R_H" related "$BLP" --rel implemented_by --depth 1 | jf 'JSON.stringify(d.data.edges)')" "git:$SHA" "hippo: implemented_by carries the full sha"
pr --target "$R_H" backlog close "$BL2" superseded --by BL-0042; eq 0 "$RC" "hippo: close superseded with a non-record ref"
assert_contains "$ERR" "superseded by BL-0042" "hippo: non-record --by is an info line"
eq superseded "$(H "$R_H" show "$BL2" | jf d.data.record.status)" "hippo: superseded"
pr --target "$R_H" backlog close "$BL1" superseded; eq 1 "$RC" "hippo: close superseded without --by -> exit 1"
pr --target "$R_H" backlog reply BL-0001 --reply none; eq 2 "$RC" "hippo: a file-native id is a usage error (exit 2)"

pr --target "$R_H" --json decision new --title "Use hippo" --rationale-file "$TEST_TMP/why.md" --ledger-row "row-1" --area core --decides "$BL1" --relates "$BL2"
eq 0 "$RC" "hippo: decision new"
D1="$(printf '%s' "$OUT" | jf d.id)"
eq decision "$(H "$R_H" show "$D1" | jf d.data.record.kind)" "hippo: decision kind"
eq active "$(H "$R_H" show "$D1" | jf d.data.record.status)" "hippo: decision active"
eq 1 "$(edges "$R_H" "$BL1" decided_by)" "hippo: --decides edge"
eq 1 "$(edges "$R_H" "$D1" relates_to)" "hippo: decision --relates edge"
pr --target "$R_H" decision new --title "Use hippo" --rationale-file "$TEST_TMP/why.md" --ledger-row "row-1" --area core --decides "$BL1" --relates "$BL2"
eq 0 "$RC" "hippo: decision new with the same ledger row is a rerun"
eq 1 "$(H "$R_H" list --history | jf 'd.data.records.filter(r=>r.kind==="decision").length')" "hippo: ledger row makes the key stable (one decision)"
pr --target "$R_H" --json decision supersede "$D1" --title "Use hippo v2" --rationale-file "$TEST_TMP/why.md"
eq 0 "$RC" "hippo: decision supersede"
D2="$(printf '%s' "$OUT" | jf d.id)"
eq superseded "$(H "$R_H" show "$D1" | jf d.data.record.status)" "hippo: old decision superseded"
eq 1 "$(edges "$R_H" "$D2" supersedes)" "hippo: supersedes edge"
pr --target "$R_H" --json adr new --title "Adopt records" --body-file "$TEST_TMP/why.md"
eq 0 "$RC" "hippo: adr new"
A1="$(printf '%s' "$OUT" | jf d.id)"
eq adr "$(H "$R_H" show "$A1" | jf d.data.record.kind)" "hippo: adr kind"
pr --target "$R_H" --json adr supersede "$A1" --title "Adopt records v2" --body-file "$TEST_TMP/why.md" --status open
eq 0 "$RC" "hippo: adr supersede"
eq superseded "$(H "$R_H" show "$A1" | jf d.data.record.status)" "hippo: old adr superseded"
pr --target "$R_H" --json lesson new --title "A lesson" --category debug --body-file "$TEST_TMP/lesson.md"
eq 0 "$RC" "hippo: lesson new"
L1="$(printf '%s' "$OUT" | jf d.id)"
eq lesson "$(H "$R_H" show "$L1" | jf d.data.record.kind)" "hippo: lesson kind"
eq debug "$(H "$R_H" show "$L1" | jf d.data.record.area)" "hippo: lesson area is the category"
printf 'decision text\n' > "$TEST_TMP/hd.md"; printf 'lesson text\n' > "$TEST_TMP/hl.md"
printf '## Done\nd\n## Next\nn\n## Pitfalls\np\n' > "$TEST_TMP/handoff-bad2.md"
HANDOFF_BODY="$(node -e 'const rf=require(process.argv[1]);process.stdout.write(rf.HANDOFF_SECTIONS.map(([k,,req])=>"## "+k+"\n"+(req?"text\n":"")).join("\n"))' "$PLUGIN/scripts/lib/record-files.js")"
printf '%s\n' "$HANDOFF_BODY" > "$TEST_TMP/handoff.md"
pr --target "$R_H" --json handoff new --title "Session end" --area proj --body-file "$TEST_TMP/handoff.md" --decision-file "$TEST_TMP/hd.md" --lesson-file "$TEST_TMP/hl.md"
eq 0 "$RC" "hippo: handoff new"
HN="$(printf '%s' "$OUT" | jf d.id)"
eq handoff-note "$(H "$R_H" show "$HN" | jf d.data.record.kind)" "hippo: handoff-note kind"
eq 2 "$(edges "$R_H" "$HN" relates_to)" "hippo: both children relate to the note"
pr --target "$R_H" handoff close "$HN"; eq 0 "$RC" "hippo: handoff close"
eq done "$(H "$R_H" show "$HN" | jf d.data.record.status)" "hippo: handoff done"
H "$R_H" check >/dev/null; eq 0 "$?" "hippo: hippo check passes after every subcommand"
BADIDS="$(H "$R_H" list --history | jf 'd.data.records.filter(r=>!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(r.id)).length')"
eq 0 "$BADIDS" "hippo: every record id is a 26-char ULID"

# --- validation exits 3 in both modes, nothing written
for MODE in files hippo; do
  if [ "$MODE" = files ]; then RV="$(mk_fixture val-files)"; else RV="$(mk_fixture val-hippo store)"; fi
  if [ "$MODE" = files ]; then HV0="$(hash_tree "$RV")"; else HV0="$(all_count "$RV")"; fi
  for BAD in "backlog new --title X --origin self" "lesson new --title X --category nope --body-file $TEST_TMP/lesson.md" \
             "lesson new --title X --category build --body-file $TEST_TMP/why.md" "decision new --title X" "adr new --title X" \
             "handoff new --title X --area p --body-file $TEST_TMP/handoff-bad.md"; do
    # shellcheck disable=SC2086
    pr --target "$RV" $BAD; eq 3 "$RC" "$MODE: validation exit 3 for: $BAD"
  done
  pr --target "$RV" backlog new --title $'two\nlines' "${BL_FLAGS[@]}"; eq 3 "$RC" "$MODE: multi-line title -> exit 3"
  pr --target "$RV" backlog new --title "T" --type nonsense "${BL_FLAGS[@]}"; eq 3 "$RC" "$MODE: bad --type -> exit 3"
  if [ "$MODE" = files ]; then eq "$HV0" "$(hash_tree "$RV")" "$MODE: validation failures write nothing"
  else eq "$HV0" "$(all_count "$RV")" "$MODE: validation failures write nothing"; eq 0 "$(spool_count "$RV")" "$MODE: validation failures spool nothing"; fi
done

# --- the PM red line: a store is present, hippo fails -> the file-mode targets stay byte-identical
STUB_DIR="$HS_ROOT/stubs"; mkdir -p "$STUB_DIR"
mkstub() { # mkstub <name> <exit> <code> <rule>
  cat > "$STUB_DIR/$1" <<STUB
#!/bin/sh
case " \$* " in
  *" new "*) printf '%s\n' '{"schema":"hippo/1","command":"new","ok":false,"data":null,"warnings":[],"error":{"code":"$3","rule":$4,"message":"stub refusal","file":null,"hint":null}}'; exit $2;;
esac
exec "$HIPPO_BIN" "\$@"
STUB
  chmod +x "$STUB_DIR/$1"
}
mkstub stub-invalid 3 rule '"invalid-value"'
mkstub stub-five 5 environment null

R_NF="$(mk_fixture nofallback store)"
NF0="$(hash_tree "$R_NF")"
NFS=(--target "$R_NF" backlog new --title "Must not reach files" "${BL_FLAGS[@]}")
HIPPO_BIN="$HS_ROOT/does-not-exist" pr "${NFS[@]}"
eq 0 "$RC" "red line (a): missing binary -> exit 0 (spooled)"
eq 1 "$(spool_count "$R_NF")" "red line (a): exactly one spool file"
assert_contains "$ERR" "WARNING record store degraded" "red line (a): degraded warning"
eq "$NF0" "$(hash_tree "$R_NF")" "red line (a): BACKLOG.md and sidecars byte-identical"
rm -f "$(spool_dir "$R_NF")"/*.json
HIPPO_BIN="$STUB_DIR/stub-invalid" pr "${NFS[@]}"
eq 3 "$RC" "red line (b): hippo exit 3 invalid-value -> exit 3"
eq 0 "$(spool_count "$R_NF")" "red line (b): nothing spooled on a rule refusal"
assert_contains "$ERR" "refused: exit 3 rule/invalid-value" "red line (b): refusal printed"
eq "$NF0" "$(hash_tree "$R_NF")" "red line (b): BACKLOG.md and sidecars byte-identical"
HIPPO_BIN="$STUB_DIR/stub-five" pr "${NFS[@]}"
eq 0 "$RC" "red line (c): hippo exit 5 -> exit 0 (spooled)"
eq 1 "$(spool_count "$R_NF")" "red line (c): exactly one spool file"
eq "$NF0" "$(hash_tree "$R_NF")" "red line (c): BACKLOG.md and sidecars byte-identical"
rm -f "$(spool_dir "$R_NF")"/*.json
hs_leak_guard
pr --target "$R_NF" backlog new --title "Leaks hostx-abc1" "${BL_FLAGS[@]}"
eq 3 "$RC" "red line (d): real hippo leak refusal -> exit 3"
assert_contains "$ERR" "leak" "red line (d): the rule is named"
eq "$NF0" "$(hash_tree "$R_NF")" "red line (d): BACKLOG.md and sidecars byte-identical"
eq 0 "$(all_count "$R_NF")" "red line (d): no record created"
for CMD in "decision new --title D --rationale-file $TEST_TMP/why.md" "lesson new --title L --category build --body-file $TEST_TMP/lesson.md"; do
  # shellcheck disable=SC2086
  HIPPO_BIN="$STUB_DIR/stub-invalid" pr --target "$R_NF" $CMD
  assert_neq "$RC" 0 "red line: '$CMD' refused by hippo does not succeed"
  eq "$NF0" "$(hash_tree "$R_NF")" "red line: '$CMD' leaves file-mode targets byte-identical"
  eq "false" "$([ -e "$R_NF/docs/knowledge/debug-patterns.md.new" ] && echo true || echo false)" "red line: no stray file for '$CMD'"
done
git -C "$R_NF" status --porcelain | grep -v '^?? .hippo' >/dev/null && fail "red line: working tree changed outside .hippo" || eq 1 1 "red line: working tree untouched outside .hippo"
rm -f "$HIPPO_CONFIG_DIR/leak-guard.toml"

# --- spool: a missing binary spools every creating subcommand; reads of the existing record refuse (exit 5)
R_SP="$(hs_mkrepo spool store)"
BLX="$(new_issue "$R_SP" "Existing")"
for CMD in "decision new --title D --rationale-file $TEST_TMP/why.md" "lesson new --title L --category build --body-file $TEST_TMP/lesson.md" \
           "adr new --title A --body-file $TEST_TMP/why.md" "handoff new --title H --area proj --body-file $TEST_TMP/handoff.md"; do
  # shellcheck disable=SC2086
  HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_SP" $CMD; eq 0 "$RC" "spool: '$CMD' -> exit 0"
done
eq 4 "$(spool_count "$R_SP")" "spool: four files, one per write"
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_SP" backlog reply "$BLX" --reply none; eq 5 "$RC" "spool: backlog reply needs a read -> exit 5"
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_SP" backlog close "$BLX" done; eq 5 "$RC" "spool: backlog close needs a read -> exit 5"
eq 4 "$(spool_count "$R_SP")" "spool: refusals spool nothing"
pr --target "$R_SP" flush; eq 0 "$RC" "flush replays the spool"
eq 0 "$(spool_count "$R_SP")" "flush empties the spool"
eq 1 "$(H "$R_SP" list --history | jf 'd.data.records.filter(r=>r.kind==="lesson").length')" "flush created the spooled lesson"

# --- parity: hippo import vs project-record.js
cat > "$TEST_TMP/parity.md" <<'MD'
# Backlog

<!-- next-id: BL-0010 -->

### Peer row
- **Id**: BL-0001
- **Status**: open
- **Since**: 2026-10-01
- **Origin**: peer
- **Reporter**: cuda
- **Report**: 2026-10-01 fleet
- **Reply**: none
- **Problem**: A peer asked.
- **Impact**: Blocked.
- **Trigger**: when asked
- **Trigger-Type**: peer
- **Effort**: S
- **Source**: PEER-REPORTED cuda 2026-10-01
- **Pointer**: none

### Dated owner row
- **Id**: BL-0002
- **Status**: open
- **Since**: 2026-10-02
- **Origin**: owner
- **Problem**: Wait for the date.
- **Impact**: Late.
- **Trigger**: on the date
- **Trigger-Type**: date:2026-12-01
- **Effort**: L
- **Source**: owner 2026-10-02
- **Pointer**: none
- **Context**: some context

### Replaced row
- **Id**: BL-0003
- **Status**: dropped 2026-10-06
- **Since**: 2026-10-05
- **Origin**: self
- **Problem**: Replaced by another.
- **Impact**: None.
- **Trigger**: now
- **Trigger-Type**: ready
- **Effort**: M!
- **Source**: self 2026-10-05
- **Pointer**: none
MD
R_PX="$(hs_mkrepo parx store)"; R_PY="$(hs_mkrepo pary store)"
H "$R_PX" import --from autopilot-backlog "$TEST_TMP/parity.md" >/dev/null; eq 0 "$?" "parity: import into X"
PROJECT_RECORD_NOW=2026-10-01T09:00:00Z pr --target "$R_PY" backlog new --title "Peer row" --origin peer --reporter cuda --report "2026-10-01 fleet" --reply none --trigger "when asked" --trigger-type peer --effort S --source "PEER-REPORTED cuda 2026-10-01" --problem "A peer asked." --impact "Blocked."; eq 0 "$RC" "parity: peer row into Y"
PROJECT_RECORD_NOW=2026-10-02T09:00:00Z pr --target "$R_PY" backlog new --title "Dated owner row" --origin owner --trigger "on the date" --trigger-type "date:2026-12-01" --effort L --source "owner 2026-10-02" --problem "Wait for the date." --impact "Late." --context "some context"; eq 0 "$RC" "parity: dated row into Y"
PROJECT_RECORD_NOW=2026-10-05T09:00:00Z pr --target "$R_PY" --json backlog new --title "Replaced row" --origin self --trigger now --trigger-type ready --effort 'M!' --source "self 2026-10-05" --problem "Replaced by another." --impact "None."; eq 0 "$RC" "parity: urgent row into Y"
RID="$(printf '%s' "$OUT" | jf d.id)"
pr --target "$R_PY" backlog close "$RID" cancelled; eq 0 "$RC" "parity: close the replaced row"
parity_dump() { # <repo>: per-title normalised show --json
  local repo="$1" ids id
  ids="$(H "$repo" list --history | jf 'd.data.records.map(r=>r.id).join(" ")')"
  for id in $ids; do H "$repo" show "$id"; done | node -e '
    const lines=require("fs").readFileSync(0,"utf8").trim().split("\n").map(l=>JSON.parse(l).data.record);
    const out={};
    for (const r of lines) {
      for (const k of ["id","short","created","updated","closed","provenance","history","relations","blocked_by"]) delete r[k];
      r.tags=r.tags.filter(t=>!t.startsWith("key:"));
      out[r.title]=r;
    }
    console.log(JSON.stringify(Object.fromEntries(Object.keys(out).sort().map(k=>[k,out[k]])),null,1));'
}
PX="$(parity_dump "$R_PX")"; PY="$(parity_dump "$R_PY")"
eq "$PX" "$PY" "parity: show --json equal except id/created/updated/closed/provenance/key tag"
[ "$PX" = "$PY" ] || diff <(printf '%s\n' "$PX") <(printf '%s\n' "$PY") >&2

# --- fault reruns
fault_run() { # fault_run <point> <args...>: runs with PROJECT_RECORD_FAULT, expects exit 70, leaves KEY
  PROJECT_RECORD_FAULT="$1" pr "${@:2}"
  eq 70 "$RC" "fault $1: exit 70"
  KEY="$(key_of)"
  [ -n "$KEY" ] || fail "fault $1: no record key was printed"
}
R_F="$(hs_mkrepo faults store)"
T1="$(new_issue "$R_F" "Target one")"; T2="$(new_issue "$R_F" "Target two")"
for P in after-create after-first-link; do
  fault_run "$P" --target "$R_F" backlog new --title "Fault row $P" --relates "$T1" --relates "$T2" "${BL_FLAGS[@]}"
  pr --target "$R_F" --key "$KEY" backlog new --title "Fault row $P" --relates "$T1" --relates "$T2" "${BL_FLAGS[@]}"
  eq 0 "$RC" "backlog new: rerun after $P succeeds"
  eq 1 "$(key_count "$R_F" "$KEY")" "backlog new: exactly one record after $P rerun"
  eq 2 "$(edges "$R_F" "$(key_id "$R_F" "$KEY")" relates_to)" "backlog new: both edges after $P rerun"
done
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_F" backlog new --title "Spooled row" --relates "$T1" --relates "$T2" "${BL_FLAGS[@]}"
KEY="$(key_of)"; eq 1 "$(spool_count "$R_F")" "before-spool-remove: write spooled"
PROJECT_RECORD_FAULT=before-spool-remove pr --target "$R_F" flush
eq 70 "$RC" "fault before-spool-remove: exit 70"
eq 1 "$(spool_count "$R_F")" "before-spool-remove: spool entry still there"
eq 1 "$(key_count "$R_F" "$KEY")" "before-spool-remove: record already created"
pr --target "$R_F" flush; eq 0 "$RC" "before-spool-remove: flush rerun succeeds"
eq 0 "$(spool_count "$R_F")" "before-spool-remove: spool empty"
eq 1 "$(key_count "$R_F" "$KEY")" "before-spool-remove: still exactly one record"
eq 2 "$(edges "$R_F" "$(key_id "$R_F" "$KEY")" relates_to)" "before-spool-remove: both edges"

for P in after-create after-first-link after-first-child; do
  fault_run "$P" --target "$R_F" handoff new --title "Fault handoff $P" --area proj --body-file "$TEST_TMP/handoff.md" --decision-file "$TEST_TMP/hd.md" --lesson-file "$TEST_TMP/hl.md"
  pr --target "$R_F" --key "$KEY" handoff new --title "Fault handoff $P" --area proj --body-file "$TEST_TMP/handoff.md" --decision-file "$TEST_TMP/hd.md" --lesson-file "$TEST_TMP/hl.md"
  eq 0 "$RC" "handoff new: rerun after $P succeeds"
  eq 1 "$(key_count "$R_F" "$KEY")" "handoff new: one note after $P rerun"
  eq 1 "$(key_count "$R_F" "$KEY.1")" "handoff new: first child once after $P rerun"
  eq 1 "$(key_count "$R_F" "$KEY.2")" "handoff new: second child once after $P rerun"
  eq 2 "$(edges "$R_F" "$(key_id "$R_F" "$KEY")" relates_to)" "handoff new: both child edges after $P rerun"
done
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_F" handoff new --title "Spooled handoff" --area proj --body-file "$TEST_TMP/handoff.md" --decision-file "$TEST_TMP/hd.md" --lesson-file "$TEST_TMP/hl.md"
KEY="$(key_of)"
PROJECT_RECORD_FAULT=before-spool-remove pr --target "$R_F" flush; eq 70 "$RC" "handoff: fault before-spool-remove exit 70"
pr --target "$R_F" flush; eq 0 "$RC" "handoff: flush rerun"
eq 111 "$(key_count "$R_F" "$KEY")$(key_count "$R_F" "$KEY.1")$(key_count "$R_F" "$KEY.2")" "handoff: before-spool-remove rerun ends with the exact set"

OLD="$(H "$R_F" new decision --title "Old decision" --status active | jf 'd.data.ids[0]')"
for P in after-create after-first-link; do
  fault_run "$P" --target "$R_F" decision supersede "$OLD" --title "New decision $P" --rationale-file "$TEST_TMP/why.md"
  pr --target "$R_F" --key "$KEY" decision supersede "$OLD" --title "New decision $P" --rationale-file "$TEST_TMP/why.md"
  eq 0 "$RC" "decision supersede: rerun after $P succeeds"
  eq 1 "$(key_count "$R_F" "$KEY")" "decision supersede: one new decision after $P rerun"
  eq 1 "$(edges "$R_F" "$(key_id "$R_F" "$KEY")" supersedes)" "decision supersede: supersedes edge after $P rerun"
  eq superseded "$(H "$R_F" show "$OLD" | jf d.data.record.status)" "decision supersede: old closed after $P rerun"
  OLD="$(H "$R_F" new decision --title "Old decision $P" --status active | jf 'd.data.ids[0]')"
done
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_F" decision supersede "$OLD" --title "Spooled decision" --rationale-file "$TEST_TMP/why.md"
KEY="$(key_of)"
PROJECT_RECORD_FAULT=before-spool-remove pr --target "$R_F" flush; eq 70 "$RC" "decision supersede: fault before-spool-remove exit 70"
pr --target "$R_F" flush; eq 0 "$RC" "decision supersede: flush rerun"
eq 1 "$(key_count "$R_F" "$KEY")" "decision supersede: one decision after the flush rerun"
eq superseded "$(H "$R_F" show "$OLD" | jf d.data.record.status)" "decision supersede: old closed after the flush rerun"

# --- a refused child: the note and the first child stay, a --key retry creates only the second child
R_RC="$(hs_mkrepo refusedchild store)"
printf 'first lesson fine\n' > "$TEST_TMP/l1.md"; printf 'second lesson hostx-zz9 leaks\n' > "$TEST_TMP/l2.md"; printf 'second lesson fixed\n' > "$TEST_TMP/l2ok.md"
hs_leak_guard
pr --target "$R_RC" handoff new --title "Refused child" --area proj --body-file "$TEST_TMP/handoff.md" --lesson-file "$TEST_TMP/l1.md" --lesson-file "$TEST_TMP/l2.md"
eq 3 "$RC" "refused child: exit 3"
KEY="$(key_of)"
assert_contains "$ERR" "step 3 (create) failed: exit 3" "refused child: the failed step is printed"
assert_contains "$ERR" "created so far:" "refused child: created ids are printed"
assert_contains "$ERR" "retry with --key $KEY" "refused child: retry key printed"
eq 1 "$(key_count "$R_RC" "$KEY")" "refused child: the note exists"
eq 1 "$(key_count "$R_RC" "$KEY.1")" "refused child: first child exists"
eq 0 "$(key_count "$R_RC" "$KEY.2")" "refused child: second child absent"
C1="$(key_id "$R_RC" "$KEY.1")"
pr --target "$R_RC" --key "$KEY" handoff new --title "Refused child" --area proj --body-file "$TEST_TMP/handoff.md" --lesson-file "$TEST_TMP/l1.md" --lesson-file "$TEST_TMP/l2ok.md"
eq 0 "$RC" "refused child: --key retry succeeds"
eq 1 "$(key_count "$R_RC" "$KEY")" "refused child: still one note"
eq "$C1" "$(key_id "$R_RC" "$KEY.1")" "refused child: first child unchanged"
eq 1 "$(key_count "$R_RC" "$KEY.2")" "refused child: second child created"
eq 3 "$(all_count "$R_RC")" "refused child: three records in all"
rm -f "$HIPPO_CONFIG_DIR/leak-guard.toml"

# --- --target refusal, plugin-dir refusal on a temp copy of the plugin tree
mkdir -p "$TEST_TMP/plain"
pr --target "$TEST_TMP/plain" backlog new --title T "${BL_FLAGS[@]}"; eq 2 "$RC" "--target that is not a git work tree -> exit 2"
pr --target "$TEST_TMP/missing-dir" where; eq 2 "$RC" "--target that does not exist -> exit 2"
COPY="$TEST_TMP/plugin-copy"; mkdir -p "$COPY"
cp -r "$PLUGIN/scripts" "$COPY/scripts"
git -C "$COPY" init -q; git -C "$COPY" add -A >/dev/null; git -C "$COPY" commit -q -m copy
ECOPY="$(cd "$TEST_TMP" && node "$COPY/scripts/project-record.js" --target "$COPY" backlog new --title T "${BL_FLAGS[@]}" 2>&1)"; RCC=$?
eq 2 "$RCC" "plugin install dir as --target -> exit 2"
assert_contains "$ECOPY" "plugin's own install directory" "plugin-dir refusal is named"
ECOPY="$(cd "$COPY" && node "$COPY/scripts/project-record.js" backlog new --title T "${BL_FLAGS[@]}" 2>&1)"; RCC=$?
eq 2 "$RCC" "plugin install dir as cwd -> exit 2"
eq "" "$(git -C "$COPY" status --porcelain)" "plugin-dir refusal writes nothing"

# --- read commands leave the working tree alone
R_RD="$(mk_fixture reads store)"
S0="$(git -C "$R_RD" status --porcelain)"
pr --target "$R_RD" where; eq 0 "$RC" "where -> exit 0"
pr --target "$R_RD" --json where; eq hippo "$(printf '%s' "$OUT" | jf d.state)" "where --json names the state"
pr --target "$R_RD" flush; eq 0 "$RC" "flush with an empty spool -> exit 0"
bash "$PLUGIN/scripts/resolve-project-paths.sh" --target "$R_RD" >/dev/null
bash "$PLUGIN/scripts/resolve-knowledge-routing.sh" --target "$R_RD" >/dev/null
eq "$S0" "$(git -C "$R_RD" status --porcelain)" "read commands leave git status unchanged"

# --- record_store in the resolvers, project-detect and the session-start spool line
R_RS_F="$(mk_fixture rs-files)"; R_RS_H="$(mk_fixture rs-hippo store)"
eq files "$(bash "$PLUGIN/scripts/resolve-project-paths.sh" --target "$R_RS_F" --field record_store)" "resolve-project-paths: files"
eq hippo "$(bash "$PLUGIN/scripts/resolve-project-paths.sh" --target "$R_RS_H" --field record_store)" "resolve-project-paths: hippo"
eq hippo "$(bash "$PLUGIN/scripts/resolve-project-paths.sh" --target "$R_RS_H" | jf d.record_store)" "resolve-project-paths: JSON carries record_store"
eq files "$(bash "$PLUGIN/scripts/resolve-knowledge-routing.sh" --target "$R_RS_F" --field record_store)" "resolve-knowledge-routing: files"
eq hippo "$(bash "$PLUGIN/scripts/resolve-knowledge-routing.sh" --target "$R_RS_H" | jf d.record_store)" "resolve-knowledge-routing: JSON carries record_store"
eq hippo "$(node "$PLUGIN/scripts/project-detect.js" "$R_RS_H" | jf d.record_store)" "project-detect: hippo"
eq files "$(node "$PLUGIN/scripts/project-detect.js" "$R_RS_F" | jf d.record_store)" "project-detect: files"
eq spool "$(HIPPO_BIN="$HS_ROOT/does-not-exist" bash "$PLUGIN/scripts/resolve-project-paths.sh" --target "$R_RS_H" --field record_store)" "resolve-project-paths: spool when the binary is missing"

SSROOT="$TEST_TMP/ssroot"; mkdir -p "$SSROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.1"}' > "$SSROOT/.claude-plugin/plugin.json"
printf '## v3.0.1 - Something\n' > "$SSROOT/CHANGELOG.md"
mkdir -p "$HOME/.autopilot"; printf '%s' "3.0.1" > "$HOME/.autopilot/last-seen-version"
ss_ctx() { # <cwd> <source>
  printf '{"source":"%s","cwd":"%s"}' "$2" "$1" | env -u CLAUDE_PROJECT_DIR HOME="$HOME" CLAUDE_PLUGIN_ROOT="$SSROOT" AUTOPILOT_ONBOARD_HINT=0 \
    node "$PLUGIN/hooks/session-start.js" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'
}
assert_not_contains "$(ss_ctx "$R_RS_H" startup)" "spooled write(s) waiting" "session-start: empty spool -> no spool line"
HIPPO_BIN="$HS_ROOT/does-not-exist" pr --target "$R_RS_H" lesson new --title L --category build --body-file "$TEST_TMP/lesson.md"
for SRC in startup resume clear; do
  OUTS="$(ss_ctx "$R_RS_H" "$SRC")"
  assert_contains "$OUTS" "record store: 1 spooled write(s) waiting" "session-start ($SRC): spool line with the count"
  eq 1 "$(printf '%s\n' "$OUTS" | grep -c 'spooled write(s) waiting' || true)" "session-start ($SRC): one line"
done
assert_not_contains "$(ss_ctx "$R_RS_F" startup)" "spooled write(s) waiting" "session-start: another repo with no spool -> no line"

hs_exit_check
finalize_test
