#!/usr/bin/env bash
# check-backlog-entries.test.sh — red-first suite for the backlog-entry gate.

. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-backlog-entries.js"

repo() {
  local d="$TEST_TMP/$1"
  mkdir -p "$d/docs/plans" "$d/docs/projects" "$d/docs/backlog" "$d/.claude"
  git -C "$d" init -q >/dev/null
  printf '# ok\n' > "$d/docs/plans/ok.md"
  echo "$d"
}

json_exit() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).exit))}catch(e){process.stdout.write("x")}})'
}

json_has_code() {
  printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.stdout.write(j.violations.some(v=>v.code==='$2')?'yes':'no')}catch(e){process.stdout.write('no')}})"
}

CJK41="$(python3 -c 'print("中"*41)')"
T240="$(python3 -c 'print("t"*240)')"
S160="$(python3 -c 'print("s"*160)')"
C120="$(python3 -c 'print("c"*120)')"

R="$(repo main)"
printf '%s\n' \
  '### Gate fixture row' \
  '- **Status**: open' \
  '- **Trigger**: when tests run' \
  '- **Effort**: S' \
  '- **Source**: suite' \
  '- **Pointer**: docs/plans/ok.md' \
  > "$R/docs/BACKLOG.md"

out="$(node "$GATE" --backlog "$R/docs/BACKLOG.md" --json)" || true
assert_eq "$(json_exit "$out")" "0" "clean heading exits 0 in JSON"
assert_contains "$out" '"style":"heading"' "clean heading style"

code_case() {
  local code="$1"
  local d="$2"
  local o
  o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json --config "$d/.claude/backlog-config.md" 2>/dev/null || true)"
  if [ ! -s "$d/.claude/backlog-config.md" ]; then
    o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
  fi
  assert_eq "$(json_has_code "$o" "$code")" "yes" "code $code fires"
}

d="$(repo c-missing)"
printf '%s\n' '### Missing trigger row' '- **Status**: open' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case missing_field "$d"

d="$(repo c-cap)"
printf '%s\n' "### $CJK41" '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case cap_exceeded "$d"

d="$(repo c-st)"
printf '%s\n' '### Bad status row' '- **Status**: pending' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case bad_status "$d"

d="$(repo c-eff)"
printf '%s\n' '### Bad effort row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: Fix' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case bad_effort "$d"
out="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json 2>/dev/null || true)"
assert_contains "$out" "Fix→S" "Fix rejection names the mapping"
assert_contains "$out" "migrate-backlog-entries.js" "Fix rejection names the migration command"
printf '%s\n' '### Bad effort row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: H' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
out="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json 2>/dev/null || true)"
assert_contains "$out" "H→S!" "H rejection names the mapping"
for ev in XS S M L XL 'S!' 'M急' 'XL!'; do
  printf '%s\n' '### Good effort row' '- **Status**: open' '- **Trigger**: when tests run' "- **Effort**: $ev" '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
  out="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json 2>/dev/null || true)"
  case "$out" in *bad_effort*) assert_eq "rejected" "accepted" "effort $ev is valid" ;; *) assert_eq "ok" "ok" "effort $ev is valid" ;; esac
done

d="$(repo c-pm)"
printf '%s\n' '### No pointer row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' > "$d/docs/BACKLOG.md"
code_case pointer_missing "$d"

d="$(repo c-pu)"
printf '%s\n' '### Missing path row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/nope.md' > "$d/docs/BACKLOG.md"
code_case pointer_unresolved "$d"

d="$(repo c-pr)"
printf '%s\n' '### Fat none row' '- **Status**: open' "- **Trigger**: $T240" '- **Effort**: S' "- **Source**: $S160" '- **Pointer**: none' "- **Context**: $C120" > "$d/docs/BACKLOG.md"
code_case pointer_required "$d"

d="$(repo c-ex)"
printf '%s\n' '### Fence row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '```' 'code' '```' > "$d/docs/BACKLOG.md"
code_case extra_content "$d"

d="$(repo c-done)"
printf '%s\n' '### Old dropped row' '- **Status**: dropped 2020-01-01' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case done_not_moved "$d"

# RED at pre-plan-graduation base (done_retention_days default was 30): a `shipped` row
# dated today would NOT have fired done_not_moved for another 30 days. BACKLOG is a
# queue now — a shipped/dropped row is done_not_moved on sight, no default grace.
TODAY="$(date -u +%Y-%m-%d)"
d="$(repo c-done-today)"
printf '%s\n' '### Shipped today row' "- **Status**: shipped v9.9.9 $TODAY" '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case done_not_moved "$d"

# --- done_retention_days is still an override knob: a consumer config may raise it ---
d="$(repo c-done-override)"
printf '%s\n' '### Shipped today, retained row' "- **Status**: shipped v9.9.9 $TODAY" '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
printf '%s\n' 'style: heading' 'done_retention_days: 30' > "$d/.claude/backlog-config.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json --config "$d/.claude/backlog-config.md")"
assert_eq "$(json_has_code "$o" "done_not_moved")" "no" \
  "an explicit done_retention_days override still grants a grace window"

d="$(repo c-unp)"
printf '%s\n' '- **Status**: open' '- **Trigger**: x' > "$d/docs/BACKLOG.md"
code_case unparseable_entry "$d"

d="$(repo c-dup-t)"
printf '%s\n' '### Same Title' '- **Status**: open' '- **Trigger**: when a' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' '### Same Title' '- **Status**: open' '- **Trigger**: when b' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case duplicate_title "$d"

d="$(repo c-dup-id)"
printf '%s\n' \
  '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |' \
  '| --- | --- | --- | --- | --- | --- | --- | --- |' \
  '| 0001 | Alpha row | open | when a | S | suite | docs/plans/ok.md | |' \
  '| 0001 | Beta row | open | when b | S | suite | docs/plans/ok.md | |' \
  > "$d/docs/BACKLOG.md"
printf '%s\n' 'style: table' 'id_pattern: ^\d{4}$' > "$d/.claude/backlog-config.md"
code_case duplicate_id "$d"

d="$(repo c-raise)"
cp "$R/docs/BACKLOG.md" "$d/docs/BACKLOG.md"
printf '%s\n' 'style: heading' '- Title: 999' > "$d/.claude/backlog-config.md"
code_case config_raises_cap "$d"

# --- three styles ---
d="$(repo style-table)"
printf '%s\n' \
  '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |' \
  '| --- | --- | --- | --- | --- | --- | --- | --- |' \
  '| 0001 | Table style row | open | when tests run | S | suite | docs/plans/ok.md | |' \
  > "$d/docs/BACKLOG.md"
printf '%s\n' 'style: table' 'id_pattern: ^\d{4}$' > "$d/.claude/backlog-config.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json --config "$d/.claude/backlog-config.md")"
assert_contains "$o" '"style":"table"' "table style parsed"
assert_eq "$(json_exit "$o")" "0" "table style clean"

# --- table style: several tables (one per ## section) and an escaped pipe inside a cell ---
# RED at base f1f32640: the second table's header was read as an entry (Title "Title") and
# `\|` split the row into the wrong number of cells (unparseable).
d="$(repo style-table-multi)"
printf '%s\n' \
  '## A' \
  '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |' \
  '| --- | --- | --- | --- | --- | --- | --- | --- |' \
  '| 0001 | First table row | open | when tests run | S | suite | docs/plans/ok.md | |' \
  '' \
  '## B' \
  '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |' \
  '| --- | --- | --- | --- | --- | --- | --- | --- |' \
  '| 0002 | Row with a \| pipe | open | when a \| b | S | suite | docs/plans/ok.md | |' \
  > "$d/docs/BACKLOG.md"
printf '%s\n' 'style: table' 'id_pattern: ^\d{4}$' > "$d/.claude/backlog-config.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json --config "$d/.claude/backlog-config.md")"
assert_eq "$(json_exit "$o")" "0" "multi-table: repeated header is not an entry and \\| stays inside its cell"
assert_contains "$o" '"entries":2' "multi-table: exactly two entries"

d="$(repo style-check)"
printf '%s\n' \
  '- [ ] [Minor] Checklist style row' \
  '  - Status: open' \
  '  - Trigger: when tests run' \
  '  - Effort: S' \
  '  - Source: suite' \
  '  - Pointer: docs/plans/ok.md' \
  > "$d/docs/BACKLOG.md"
printf '%s\n' 'style: checklist' > "$d/.claude/backlog-config.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json --config "$d/.claude/backlog-config.md")"
assert_contains "$o" '"style":"checklist"' "checklist style parsed"

# --- ratchet ---
d="$(repo ratchet)"
printf '%s\n' \
  '### Ratchet row' \
  '- **Status**: pending' \
  '- **Trigger**: when tests run' \
  '- **Effort**: S' \
  '- **Source**: suite' \
  '- **Pointer**: docs/plans/ok.md' \
  > "$d/docs/BACKLOG.md"
al="$d/.claude/backlog-debt.json"
printf '%s\n' '{"schema":1,"entries":[]}' > "$al"
set +e
node "$GATE" --backlog "$d/docs/BACKLOG.md" --allowlist "$al" --update-allowlist --mode warn >/dev/null 2>"$TEST_TMP/ratchet.err"
rc=$?
set -e
assert_eq "$rc" "1" "update-allowlist refuses to add"
assert_contains "$(cat "$TEST_TMP/ratchet.err")" "would_add" "would-add pairs printed"

fp="$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update("heading:ratchet row").digest("hex"))')"
printf '%s\n' "{\"schema\":1,\"entries\":[{\"fingerprint\":\"$fp\",\"codes\":[\"bad_status\",\"missing_field\"]}]}" > "$al"
set +e
node "$GATE" --backlog "$d/docs/BACKLOG.md" --allowlist "$al" --update-allowlist --json >/dev/null
rc=$?
set -e
assert_eq "$rc" "0" "update-allowlist removes a fixed pair"
assert_contains "$(cat "$al")" "bad_status" "kept still-violating code"
assert_not_contains "$(cat "$al")" "missing_field" "removed fixed code"

# --- pointer vs cwd ---
d="$(repo cwd-ptr)"
printf '%s\n' \
  '### Cwd pointer row' \
  '- **Status**: open' \
  '- **Trigger**: when tests run' \
  '- **Effort**: S' \
  '- **Source**: suite' \
  '- **Pointer**: docs/plans/ok.md' \
  > "$d/docs/BACKLOG.md"
elsewhere="$TEST_TMP/elsewhere"
mkdir -p "$elsewhere"
o="$(cd "$elsewhere" && node "$GATE" --backlog "$d/docs/BACKLOG.md" --json)"
n="$(json_has_code "$o" "pointer_unresolved")"
assert_eq "$n" "no" "pointer resolves against repo root not cwd"

# --- UTF-8 ---
d="$(repo utf8)"
printf '%s\n' "### $CJK41" '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json || true)"
assert_eq "$(json_has_code "$o" "cap_exceeded")" "yes" "CJK 3-byte cap"

set +e
node "$GATE" --self-test >/dev/null
rc=$?
set -e
assert_eq "$rc" "0" "--self-test exits 0"

mkdir -p "$TEST_TMP/mutroot/scripts/lib" "$TEST_TMP/mutroot/references"
cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$TEST_TMP/mutroot/scripts/lib/"   # the mutants load the layout registry beside them
cp "$REPO_ROOT/scripts/lib/backlog-rules.js" "$TEST_TMP/mutroot/scripts/lib/"   # the extracted field/peer rules the gate requires
cp "$REPO_ROOT/references/stage-graph.json" "$TEST_TMP/mutroot/references/"
mut="$TEST_TMP/mutroot/scripts/check-mut.js"
sed_mutant "$GATE" "$mut" "s/Status: 'pending'/Status: 'open'/"
set +e
node "$mut" --self-test >/dev/null 2>/dev/null
rc=$?
set -e
assert_eq "$rc" "2" "mutated self-test fixture exits 2"

d="$(repo warn)"
printf '%s\n' '### Warn row' '- **Status**: pending' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
set +e
node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode warn --json >/dev/null
rc=$?
set -e
assert_eq "$rc" "0" "warn mode exits 0 with violations"

set +e
node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json >/dev/null
rc=$?
set -e
assert_eq "$rc" "1" "block mode exits 1 with new violations"

# =============================================================================================
# Reporter fields (Id / Since / Origin / Reporter / Report / Reply / Problem / Impact).

codes_of() { # <json> -> "code:field:title|..." in report order
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.violations.map(v=>v.code+":"+v.field+":"+v.title).join("|"))}catch(e){process.stdout.write("unparsable")}})'
}
level_of() { # <json> <code>
  printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const v=JSON.parse(d).violations.find(x=>x.code==='$2');process.stdout.write(v?v.level:'none')}catch(e){process.stdout.write('x')}})"
}
gate_run() { # <gate> <repo> [extra args] -> json; exit code in GATE_RC
  local g="$1" d="$2"; shift 2
  set +e
  GATE_OUT="$(node "$g" --backlog "$d/docs/BACKLOG.md" --mode block --json "$@" 2>/dev/null)"
  GATE_RC=$?
  set -e
}

# --- legacy rows, no config: the result is pinned to what the pre-reporter-field gate returned on
# the same fixture (old and new gate compared byte-for-byte when this golden was taken).
T230="$(python3 -c 'print("t"*230)')"
S150="$(python3 -c 'print("s"*150)')"
C230="$(python3 -c 'print("c"*230)')"
d="$(repo golden)"
printf '%s\n' '# BACKLOG' '' \
  '### Golden clean row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' \
  '### Golden broken row' '- **Status**: pending' '- **Trigger**: when tests run' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' '' \
  '### Golden long row' '- **Status**: open' "- **Trigger**: $T230" '- **Effort**: S' "- **Source**: $S150" '- **Pointer**: docs/plans/ok.md' "- **Context**: $C230" "- **Context**: $C230" '' \
  '### Golden unpointed row' '- **Status**: open' "- **Trigger**: $T230" '- **Effort**: S' "- **Source**: $S150" '- **Pointer**: none' "- **Context**: $C120" '' \
  '### Golden short unpointed row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: none' '' \
  '### Golden broken row' '- **Status**: dropped 2020-01-01' '- **Trigger**: when tests run' '- **Effort**: M' '- **Source**: suite' '- **Pointer**: docs/plans/gone.md' '' \
  > "$d/docs/BACKLOG.md"
GOLDEN='missing_field:Effort:Golden broken row|bad_status:Status:Golden broken row|extra_content::Golden long row|cap_exceeded:entry:Golden long row|pointer_required:Pointer:Golden unpointed row|duplicate_title:Title:Golden broken row|pointer_unresolved:Pointer:Golden broken row|done_not_moved:Status:Golden broken row'
gate_run "$GATE" "$d"
assert_eq "$GATE_RC" "1" "legacy golden: exit unchanged"
assert_eq "$(codes_of "$GATE_OUT")" "$GOLDEN" "legacy golden: violations unchanged (no config)"
gate_run "$GATE" "$d" --config /dev/null
assert_eq "$(codes_of "$GATE_OUT")" "$GOLDEN" "legacy golden: violations unchanged (empty config)"

# --- a well-formed peer row; each red case below edits exactly one line of it.
prow() { # [title] -> a clean peer row
  printf '%s\n' "### ${1:-Peer reported row}" '- **Id**: BL-0001' '- **Status**: open' '- **Since**: 2026-09-05' \
    '- **Origin**: peer' '- **Reporter**: cuda' '- **Report**: 2026-09-05 fleet' '- **Reply**: none' \
    '- **Problem**: 回報者在某情況下遇到問題' '- **Impact**: 不修會一直重複發生' \
    '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' ''
}
put() { # <repo> <row text> [next-id number]
  printf '# BACKLOG\n\n<!-- next-id: BL-%04d -->\n\n%s\n' "${3:-2}" "$2" > "$1/docs/BACKLOG.md"
}
edit_row() { # <sed expr> -> the clean peer row with one edit
  prow | sed "$1"
}

d="$(repo r-ok)"
put "$d" "$(prow)"
gate_run "$GATE" "$d"
assert_eq "$GATE_RC" "0" "reporter fields: a clean peer row passes in block mode"
assert_eq "$(codes_of "$GATE_OUT")" "" "reporter fields: no violations on the clean row"

red_case() { # <code> <name> <row text> [next-id] [extra gate args...]
  local code="$1" name="$2" text="$3" n="${4:-2}"; shift 4 2>/dev/null || shift $#
  local d; d="$(repo "r-$name")"
  put "$d" "$text" "$n"
  gate_run "$GATE" "$d" "$@"
  assert_eq "$(json_has_code "$GATE_OUT" "$code")" "yes" "red: $code fires ($name)"
}
red_case bad_since since "$(edit_row 's/^- \*\*Since\*\*: .*/- **Since**: 2026-13-40/')" 2
red_case bad_origin origin "$(edit_row 's/^- \*\*Origin\*\*: .*/- **Origin**: external/')" 2
red_case bad_reply reply "$(edit_row 's/^- \*\*Reply\*\*: .*/- **Reply**: replied/')" 2
red_case peer_field_missing trio "$(edit_row '/^- \*\*Reply\*\*:/d')" 2
red_case peer_field_missing count "$(edit_row 's/^- \*\*Reporter\*\*: .*/- **Reporter**: cuda；openclaw/')" 2
red_case bad_id id-format "$(edit_row 's/^- \*\*Id\*\*: .*/- **Id**: BL-1/')" 2
red_case bad_id id-at-next "$(prow)" 1
red_case duplicate_id dup "$(prow 'First row')"$'\n\n'"$(prow 'Second row')" 2
red_case peer_closed_unanswered closed "$(edit_row 's/^- \*\*Status\*\*: .*/- **Status**: dropped 2026-10-01/')" 2

# Green twins.
d="$(repo g-closed)"
put "$d" "$(edit_row 's/^- \*\*Status\*\*: .*/- **Status**: dropped 2026-10-01/' | sed 's/^- \*\*Reply\*\*: .*/- **Reply**: 2026-10-01 msg_01R/')"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" peer_closed_unanswered)" "no" "green: a closed peer row with a dated Reply is not peer_closed_unanswered"
d="$(repo g-dup)"
put "$d" "$(prow 'First row')"$'\n\n'"$(prow 'Second row' | sed 's/BL-0001/BL-0002/')" 3
gate_run "$GATE" "$d"
assert_eq "$GATE_RC" "0" "green: two unique Ids below next-id pass"
d="$(repo g-self)"
put "$d" "$(edit_row 's/^- \*\*Origin\*\*: .*/- **Origin**: self/' | sed '/^- \*\*Report/d; /^- \*\*Reply/d')"
gate_run "$GATE" "$d"
assert_eq "$GATE_RC" "0" "green: Origin self needs no Reporter/Report/Reply"

# problem_has_identifier is a warning: reported, never blocks.
d="$(repo r-ident)"
put "$d" "$(edit_row 's/^- \*\*Problem\*\*: .*/- **Problem**: 改 `scripts\/x.js` 才會好/')"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" problem_has_identifier)" "yes" "red: problem_has_identifier fires"
assert_eq "$(level_of "$GATE_OUT" problem_has_identifier)" "warn" "problem_has_identifier is level warn"
assert_eq "$GATE_RC" "0" "problem_has_identifier does not block in block mode"
IDENT_DIR="$d"

# --- required_fields config: optional by default, required when the config names them.
LEGACY_ROW="$(printf '%s\n' '### Legacy only row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md')"
d="$(repo req-kv)"
printf '%s\n' "$LEGACY_ROW" > "$d/docs/BACKLOG.md"
printf '%s\n' '## Mode' '- mode: block' '- required_fields: Id, Since' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "missing_field:Id:Legacy only row" "required_fields kv: Id required"
assert_contains "$(codes_of "$GATE_OUT")" "missing_field:Since:Legacy only row" "required_fields kv: Since required"
assert_not_contains "$(codes_of "$GATE_OUT")" "missing_field:Origin" "required_fields kv: unnamed fields stay optional"
REQ_DIR="$d"
d="$(repo req-list)"
printf '%s\n' "$LEGACY_ROW" > "$d/docs/BACKLOG.md"
printf '%s\n' '## Mode' '- mode: block' '' '## Required Fields' '- Problem' '- Impact' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "missing_field:Problem:Legacy only row" "required_fields section: Problem required"
assert_contains "$(codes_of "$GATE_OUT")" "missing_field:Impact:Legacy only row" "required_fields section: Impact required"
d="$(repo req-none)"
printf '%s\n' "$LEGACY_ROW" > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$GATE_RC" "0" "no required_fields: a legacy row with no reporter field passes"

# --- R1: the pointer threshold measures only the legacy fields.
C200="$(python3 -c 'print("c"*200)')"
R1_ROW="$(printf '%s\n' '### Pointer threshold row' '- **Id**: BL-0001' '- **Status**: open' '- **Since**: 2026-09-05' '- **Origin**: self' \
  "- **Problem**: $(python3 -c 'print("問"*90)')" "- **Impact**: $(python3 -c 'print("影"*45)')" \
  "- **Trigger**: $T230" '- **Effort**: S' "- **Source**: $S150" '- **Pointer**: none' "- **Context**: $(python3 -c 'print("c"*60)')")"
d="$(repo r1-green)"
put "$d" "$R1_ROW"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" pointer_required)" "no" "R1: reporter fields do not count toward the 600 B pointer threshold"
R1_DIR="$d"
d="$(repo r1-red)"
put "$d" "$(printf '%s\n' "$R1_ROW" | sed "s/^- \*\*Context\*\*: .*/- **Context**: $C200/")"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" pointer_required)" "yes" "R1: legacy fields over 600 B still need a Pointer"

# --- R2: a row with reporter fields is capped at 1600 B; a legacy row stays at 900 B.
P290="$(python3 -c 'print("問"*96)')"
I150="$(python3 -c 'print("影"*50)')"
R2_ROW="$(printf '%s\n' '### Row cap row' '- **Id**: BL-0001' '- **Status**: open' '- **Since**: 2026-09-05' '- **Origin**: self' \
  "- **Problem**: $P290" "- **Impact**: $I150" "- **Trigger**: $T230" '- **Effort**: S' "- **Source**: $S150" \
  '- **Pointer**: docs/plans/ok.md' "- **Context**: $C230")"
d="$(repo r2-green)"
put "$d" "$R2_ROW"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" cap_exceeded)" "no" "R2: a ~1.3 KB row carrying reporter fields is under the 1600 B row cap"
R2_DIR="$d"
d="$(repo r2-red)"
put "$d" "$(printf '%s\n' "$R2_ROW" | sed 's/^- \*\*Origin\*\*: self/- **Origin**: peer\n- **Reporter**: '"$(python3 -c 'print("r"*150)')"'\n- **Report**: '"$(python3 -c 'print("p"*150)')"'\n- **Reply**: none/')"
gate_run "$GATE" "$d"
assert_contains "$(codes_of "$GATE_OUT")" "cap_exceeded:row:Row cap row" "R2: over 1600 B is cap_exceeded on row"

# --- Id compatibility: the old gate accepted any Id in heading and checklist rows. BL-NNNN is
# enforced only when required_fields names Id or the file carries a next-id mark.
idc_heading() { # <repo> <id> [mark]
  { printf '# BACKLOG\n\n'; [ -n "${3:-}" ] && printf '<!-- next-id: BL-0100 -->\n\n'
    printf '%s\n' '### Own numbered row' "- **Id**: $2" '- **Status**: open' '- **Trigger**: when tests run' \
      '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md'; } > "$1/docs/BACKLOG.md"
}
idc_checklist() { # <repo> <id>
  printf '%s\n' '# BACKLOG' '' '- [ ] [Minor] Own numbered checklist row' "  - Id: $2" '  - Status: open' \
    '  - Trigger: when tests run' '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' > "$1/docs/BACKLOG.md"
}
d="$(repo idc-h-nocfg)"
idc_heading "$d" 25
gate_run "$GATE" "$d"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: heading 'Id: 25' with no config passes, as before"
IDC_H_DIR="$d"
d="$(repo idc-h-cfg)"
idc_heading "$d" 25
printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: heading 'Id: 25' with a config that does not require Id passes"
d="$(repo idc-h-bl-nomark)"
idc_heading "$d" BL-0007
gate_run "$GATE" "$d"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: a BL Id with no next-id mark and no required Id passes"
IDC_NOMARK_DIR="$d"
d="$(repo idc-h-dup)"
{ idc_heading "$d" 25; printf '\n'; printf '%s\n' '### Second numbered row' '- **Id**: 25' '- **Status**: open' '- **Trigger**: when tests run' \
    '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' >> "$d/docs/BACKLOG.md"; }
gate_run "$GATE" "$d"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: a repeated legacy Id with no opt-in is not duplicate_id, as before"
IDC_DUP_DIR="$d"
# A checklist Id was always read by the old gate, so a repeated one stays duplicate_id.
d="$(repo idc-c-dup)"
{ idc_checklist "$d" T-12; printf '\n'; printf '%s\n' '- [ ] [Minor] Second numbered checklist row' '  - Id: T-12' '  - Status: open' \
    '  - Trigger: when tests run' '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' >> "$d/docs/BACKLOG.md"; }
printf '%s\n' '## Style' '- style: checklist' '## Mode' '- mode: block' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "1:duplicate_id:Id:Second numbered checklist row" "Id compat: a repeated checklist Id is duplicate_id, as before"
IDC_CDUP_DIR="$d"
d="$(repo idc-c-uniq)"
{ idc_checklist "$d" T-12; printf '\n'; printf '%s\n' '- [ ] [Minor] Second numbered checklist row' '  - Id: T-13' '  - Status: open' \
    '  - Trigger: when tests run' '  - Effort: S' '  - Source: suite' '  - Pointer: docs/plans/ok.md' >> "$d/docs/BACKLOG.md"; }
printf '%s\n' '## Style' '- style: checklist' '## Mode' '- mode: block' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: distinct checklist Ids pass"
d="$(repo idc-c-nocfg)"
idc_checklist "$d" T-12
printf '%s\n' '## Style' '- style: checklist' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "Id compat: checklist 'Id: T-12' with a style-only config passes"
d="$(repo idc-c-cfg)"
idc_checklist "$d" T-12
printf '%s\n' '## Style' '- style: checklist' '## Mode' '- mode: block' '- required_fields: Since' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" bad_id)" "no" "Id compat: checklist 'Id: T-12' is not bad_id when the config requires other fields only"
# Opted in: the same rows are bad_id once Id is required or the file has a next-id mark.
d="$(repo idc-h-req)"
idc_heading "$d" 25
printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' '- required_fields: Id' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "bad_id:Id:Own numbered row" "Id opt-in: required_fields Id enforces BL-NNNN (heading)"
IDC_REQ_DIR="$d"
d="$(repo idc-h-mark)"
idc_heading "$d" 25 mark
gate_run "$GATE" "$d"
assert_contains "$(codes_of "$GATE_OUT")" "bad_id:Id:Own numbered row" "Id opt-in: a next-id mark enforces BL-NNNN (heading)"
d="$(repo idc-c-req)"
idc_checklist "$d" T-12
printf '%s\n' '## Style' '- style: checklist' '## Mode' '- mode: block' '- required_fields: Id' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "bad_id:Id:Own numbered checklist row" "Id opt-in: required_fields Id enforces BL-NNNN (checklist)"
d="$(repo idc-bl-req-nomark)"
idc_heading "$d" BL-0007
printf '%s\n' '## Mode' '- mode: block' '- required_fields: Id' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" bad_id)" "yes" "Id opt-in: required Id with BL Ids and no next-id mark is bad_id"

# --- table compatibility: a column that happens to be named Origin/Since/Problem/Reply/… was never
# read by the old gate; it is checked only once the file opts in (next-id mark or required_fields).
P395="$(python3 -c 'print("問"*131 + "xx")')"
tcol() { # <repo> <extra headers> <extra cells> [mark] [required_fields]
  { printf '# BACKLOG\n\n'; [ -n "${4:-}" ] && printf '<!-- next-id: BL-0001 -->\n\n'
    printf '| Title | Status | Trigger | Effort | Source | Pointer |%s\n' "$2"
    printf '| --- | --- | --- | --- | --- | --- |%s\n' "$(printf '%s' "$2" | sed 's/[^|]*|/ --- |/g')"
    printf '| Table row | open | when it fires | S | suite | none |%s\n' "$3"; } > "$1/docs/BACKLOG.md"
  { printf '%s\n' '## Style' '- style: table' '## Mode' '- mode: block'; if [ -n "${5:-}" ]; then printf -- '- required_fields: %s\n' "$5"; fi; } > "$1/.claude/backlog-config.md"
}
d="$(repo tc-origin)"; tcol "$d" ' Origin |' ' external |'
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "table compat: an Origin column valued 'external' is not read without opt-in, as before"
TC_ORIGIN_DIR="$d"
d="$(repo tc-since)"; tcol "$d" ' Since |' ' last week |'
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "table compat: a Since column valued 'last week' is not read without opt-in, as before"
d="$(repo tc-prob)"; tcol "$d" ' Problem | Reply |' " $P395 | will look next week |"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "table compat: a 395 B Problem and a free-text Reply are not read without opt-in, as before"
# Opted in: the same columns are checked.
d="$(repo tc-origin-mark)"; tcol "$d" ' Origin |' ' external |' mark
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "1:bad_origin:Origin:Table row" "table opt-in: with a next-id mark the Origin column is checked"
d="$(repo tc-since-req)"; tcol "$d" ' Since |' ' last week |' '' Since
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "1:bad_since:Since:Table row" "table opt-in: Since in required_fields checks the Since column"
TC_SINCE_REQ_DIR="$d"
# Opted in: a row whose Problem/Impact columns carry it past 900 B (under 1600 B) is a reporter row,
# so the row cap applies; the parse layer recounts the new-column bytes for it.
d="$(repo tc-rowcap)"
TC_T="$(python3 -c 'print("題"*39)')"; TC_TR="$(python3 -c 'print("觸"*79)')"; TC_S="$(python3 -c 'print("源"*53)')"
TC_P="$(python3 -c 'print("問"*99)')"; TC_I="$(python3 -c 'print("響"*50)')"
{ printf '# BACKLOG\n\n<!-- next-id: BL-0001 -->\n\n'
  printf '%s\n' '| Title | Status | Trigger | Effort | Source | Pointer | Problem | Impact |' '| --- | --- | --- | --- | --- | --- | --- | --- |'
  printf '| %s | open | %s | S | %s | none | %s | %s |\n' "$TC_T" "$TC_TR" "$TC_S" "$TC_P" "$TC_I"; } > "$d/docs/BACKLOG.md"
printf '%s\n' '## Style' '- style: table' '## Mode' '- mode: block' > "$d/.claude/backlog-config.md"
TC_ROWB="$(tail -n1 "$d/docs/BACKLOG.md" | wc -c)"
assert_eq "$([ "$TC_ROWB" -gt 901 ] && [ "$TC_ROWB" -lt 1600 ] && echo in-band)" "in-band" "table row cap fixture: the row is between 900 B and 1600 B ($TC_ROWB)"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "table opt-in: Problem/Impact columns past 900 B take the 1600 B row cap"
TC_ROWCAP_DIR="$d"
# Origin in required_fields brings Reporter/Report/Reply along: a valid peer row passes.
d="$(repo tc-origin-peer)"; tcol "$d" ' Origin | Reporter | Report | Reply |' ' peer | cuda | ticket 12 | 2026-10-01 msg_01R |' '' Origin
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "table opt-in: required Origin also reads the Reporter/Report/Reply columns"
TC_ORIGIN_PEER_DIR="$d"

# --- mutation proofs: each rule's test goes red when the rule is removed from the gate.
# The rule code lives in scripts/lib/backlog-rules.js (shared with the writer), the parsing in the gate: the expression is applied to
# both copies, in a tree of its own per mutant, and must bite in at least one.
mutate() { # <name> <sed expr> -> path of a mutated gate copy (fails the test if sed did not bite)
  local d="$TEST_TMP/mutroot/m-$1" m
  mkdir -p "$d/scripts/lib" "$d/references"
  cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$d/scripts/lib/"
  cp "$REPO_ROOT/references/stage-graph.json" "$d/references/"
  m="$d/scripts/check-$1.js"
  sed "$2" "$GATE" > "$m"
  sed "$2" "$REPO_ROOT/scripts/lib/backlog-rules.js" > "$d/scripts/lib/backlog-rules.js"
  if cmp -s "$GATE" "$m" && cmp -s "$REPO_ROOT/scripts/lib/backlog-rules.js" "$d/scripts/lib/backlog-rules.js"; then fail "mutation $1 did not apply (pattern drifted)"; fi
  echo "$m"
}
m="$(mutate r1 's/const lb = legacyBytes(entry);/const lb = byteLen(entry.text);/')"
gate_run "$m" "$R1_DIR"
assert_eq "$(json_has_code "$GATE_OUT" pointer_required)" "yes" "R1 mutation: counting the whole row trips the threshold (the suite can tell)"
m="$(mutate r2 "s/hasNewFields(entry) ? 'row' : 'entry'/'entry'/")"
gate_run "$m" "$R2_DIR"
assert_eq "$(json_has_code "$GATE_OUT" cap_exceeded)" "yes" "R2 mutation: the 900 B cap on a reporter row is caught"
m="$(mutate req 's/for (const f of cfg.required_fields || \[\])/for (const f of [])/')"
gate_run "$m" "$REQ_DIR" --config "$REQ_DIR/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" missing_field)" "no" "required_fields mutation: ignoring the config is caught"
m="$(mutate warn "s/, level: 'warn' });/ });/; s/new Set(\['problem_has_identifier'\])/new Set([])/")"
gate_run "$m" "$IDENT_DIR"
assert_eq "$GATE_RC" "1" "warn-level mutation: a blocking problem_has_identifier is caught"

m="$(mutate idc "s/present('Id') && blIdEnforced(cfg)/present('Id')/")"
gate_run "$m" "$IDC_H_DIR"
assert_eq "$(json_has_code "$GATE_OUT" bad_id)" "yes" "Id compat mutation: enforcing BL-NNNN everywhere is caught"
m="$(mutate idc-mark "s/blIds.length \&\& blIdEnforced(cfg)/blIds.length/")"
gate_run "$m" "$IDC_NOMARK_DIR"
assert_eq "$(json_has_code "$GATE_OUT" bad_id)" "yes" "Id compat mutation: demanding a next-id mark everywhere is caught"
m="$(mutate idc-dup "s/if (ent.id \&\& (ent.tableId || style === 'checklist' || blIdEnforced(ecfg))) {/if (ent.id) {/")"
gate_run "$m" "$IDC_DUP_DIR"
assert_eq "$(json_has_code "$GATE_OUT" duplicate_id)" "yes" "Id compat mutation: duplicate_id on legacy Ids is caught"
m="$(mutate idc-cdup "s/(ent.tableId || style === 'checklist' || blIdEnforced(ecfg))/(ent.tableId || blIdEnforced(ecfg))/")"
gate_run "$m" "$IDC_CDUP_DIR" --config "$IDC_CDUP_DIR/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" duplicate_id)" "no" "Id compat mutation: dropping the checklist duplicate check is caught"
m="$(mutate idc-off "s/return Boolean(cfg \&\& (cfg.next_id_mark || (cfg.required_fields || \[\]).includes('Id')));/return false;/")"
gate_run "$m" "$IDC_REQ_DIR" --config "$IDC_REQ_DIR/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" bad_id)" "no" "Id opt-in mutation: never enforcing BL-NNNN is caught"

m="$(mutate tc-view "s/^        if (NEW_FIELDS.includes(f) \&\& !fieldOptedIn(ocfg, f)) continue;$/        ;/")"
gate_run "$m" "$TC_ORIGIN_DIR" --config "$TC_ORIGIN_DIR/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" bad_origin)" "yes" "table compat mutation: reading table reporter columns without opt-in is caught"
m="$(mutate tc-optin "s/^  return req.includes(f) || (PEER_FIELDS.includes(f) \&\& req.includes('Origin'));$/  return false;/")"
gate_run "$m" "$TC_SINCE_REQ_DIR" --config "$TC_SINCE_REQ_DIR/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" bad_since)" "no" "table opt-in mutation: ignoring required_fields for table columns is caught"
m="$(mutate tc-rowcap "s/^        if (NEW_FIELDS.includes(f)) newFieldBytes += byteLen(fields\[f\]) + 3;$/        ;/")"
gate_run "$m" "$TC_ROWCAP_DIR" --config "$TC_ROWCAP_DIR/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "cap_exceeded:entry:" "table row cap mutation: not recounting the new-column bytes drops the row to the 900 B cap (the suite can tell)"
m="$(mutate tc-peer "s/(PEER_FIELDS.includes(f) \&\& req.includes('Origin'))/false/")"
gate_run "$m" "$TC_ORIGIN_PEER_DIR" --config "$TC_ORIGIN_PEER_DIR/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "peer_field_missing:Reporter:" "table peer mutation: Origin alone without Reporter/Report/Reply reads as a peer row missing them (the suite can tell)"

# --- sidecar_orphan: a docs/backlog/*.md note no BACKLOG text mentions ---
sidecar_fixture() {
  local d; d="$(repo "$1")"
  printf '%s\n' '### Sidecar row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' "- **Pointer**: $2" > "$d/docs/BACKLOG.md"
  echo "$d"
}
d="$(sidecar_fixture sc-orphan docs/plans/ok.md)"
printf 'note\n' > "$d/docs/backlog/lonely-note.md"
printf '{}\n' > "$d/docs/backlog/data.json"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" sidecar_orphan)" "yes" "sidecar_orphan fires for an unmentioned docs/backlog note"
assert_eq "$(json_exit "$o")" "1" "sidecar_orphan blocks (exit 1)"
assert_contains "$o" "docs/backlog/lonely-note.md" "sidecar_orphan detail carries the path"
assert_not_contains "$o" "data.json" "non-.md files in docs/backlog are not checked"

d="$(sidecar_fixture sc-mentioned docs/backlog/kept-note.md)"
printf 'note\n' > "$d/docs/backlog/kept-note.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" sidecar_orphan)" "no" "a note a row mentions is not an orphan"

d="$(sidecar_fixture sc-nodir docs/plans/ok.md)"
rmdir "$d/docs/backlog"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" sidecar_orphan)" "no" "no docs/backlog dir: nothing to check"

# boundary: a row naming prefix-note.md must not excuse an orphan note.md
d="$(sidecar_fixture sc-boundary docs/backlog/kept-note.md)"
printf 'n\n' > "$d/docs/backlog/kept-note.md"
printf 'n\n' > "$d/docs/backlog/note.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" sidecar_orphan)" "yes" "note.md is an orphan though kept-note.md is mentioned"
assert_contains "$o" "docs/backlog/note.md" "the orphan reported is note.md"
assert_not_contains "$o" "docs/backlog/kept-note.md is" "kept-note.md is not reported"

# A backlog file that sits inside a directory named backlog/ (the relayout form): its notes are that directory's other .md files,
# and the backlog file is never its own orphan.
d="$(repo sc-inside)"; mkdir -p "$d/area/backlog"
printf '%s\n' '### Inside row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: none' > "$d/area/backlog/BACKLOG.md"
printf 'n\n' > "$d/area/backlog/lonely.md"
o="$(node "$GATE" --backlog "$d/area/backlog/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" sidecar_orphan)" "yes" "backlog file inside backlog/: an unmentioned sibling note is an orphan"
assert_contains "$o" "backlog/lonely.md" "the orphan reported is lonely.md"
assert_not_contains "$o" "backlog/BACKLOG.md is mentioned" "the backlog file is not reported as its own orphan"

# Trigger-Type (BL-0212). Required once a file uses the field; value and calendar date are separate codes.
# RED at 604b9ff14: 116 passed, 5 failed — missing_field/bad_trigger_type/bad_trigger_date absent (got 'no'), valid ready+date exited 1.
tt_row() { # <title> [trigger-type line or empty]
  printf '%s\n' "### $1" '- **Status**: open' '- **Trigger**: when tests run' ${2:+"$2"} '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md'
}
d="$(repo tt-missing)"
{ tt_row 'Has type' '- **Trigger-Type**: event'; printf '\n'; tt_row 'Lacks type'; } > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" missing_field)" "yes" "Trigger-Type missing once the file uses the field"
assert_contains "$o" "Lacks type" "missing Trigger-Type names the entry"
d="$(repo tt-bad)"
tt_row 'Bad type' '- **Trigger-Type**: soon' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" bad_trigger_type)" "yes" "Trigger-Type rejects a value outside the set"
d="$(repo tt-baddate)"
tt_row 'Bad date' '- **Trigger-Type**: date:2026-02-31' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" bad_trigger_date)" "yes" "date: Trigger-Type must be a real calendar date"
d="$(repo tt-ok)"
{ tt_row 'Ready row' '- **Trigger-Type**: ready'; printf '\n'; tt_row 'Dated row' '- **Trigger-Type**: date:2026-01-31'; } > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_exit "$o")" "0" "ready and a real date: Trigger-Type pass"

# required_fields may name Trigger-Type (REQUIRABLE). A file that never uses the field still blocks a row that lacks it.
# RED at fe2683ed1: required_fields Trigger-Type expected missing_field yes, got no; 'Config requires type' absent. 123 passed, 2 failed.
d="$(repo tt-required-config)"
printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' '- required_fields: Trigger-Type' > "$d/.claude/backlog-config.md"
tt_row 'Config requires type' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" missing_field)" "yes" "required_fields Trigger-Type blocks an entry that lacks it"
assert_contains "$o" "Config requires type" "required_fields Trigger-Type names the entry"

# Leap day: 2026 is not a leap year; 2028 is.
# green at fe2683ed1: date:2026-02-29 was already bad_trigger_date and date:2028-02-29 already exited 0 (both assertions were in the 123 passed). Locks the calendar check.
d="$(repo tt-leap-reject)"
tt_row 'Not a leap day' '- **Trigger-Type**: date:2026-02-29' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_has_code "$o" bad_trigger_date)" "yes" "date:2026-02-29 is not a calendar date"
d="$(repo tt-leap-accept)"
tt_row 'Leap day' '- **Trigger-Type**: date:2028-02-29' > "$d/docs/BACKLOG.md"
o="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --json 2>/dev/null || true)"
assert_eq "$(json_exit "$o")" "0" "date:2028-02-29 is a real calendar date"

# --- queue-form rows (heading only) and --ready ---
ready_count() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.ready_count))}catch(e){process.stdout.write("x")}})'
}
ready_ids() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write((j.ready||[]).map(r=>r.Id).join(","))}catch(e){process.stdout.write("x")}})'
}
has_ready_key() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(Object.prototype.hasOwnProperty.call(j,"ready")?"yes":"no")}catch(e){process.stdout.write("x")}})'
}
exact_line() { # <text> <line> -> yes/no. The line is the whole line, so an empty Feeds value stays visible.
  printf '%s\n' "$1" | grep -F -x -e "$2" >/dev/null && printf yes || printf no
}
qhead() { # <title> <id> — a valid queue-form code row, no after
  printf '%s\n' "### $1" "- **Id**: $2" \
    '- **Status**: open' \
    '- **Trigger**: when the fixture runs' \
    '- **Trigger-Type**: ready' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: docs/plans/ok.md' \
    '- **Done-Check**: `node scripts/check-backlog-entries.js --self-test`' \
    '- **Artifact**: code' \
    '- **Needs**: none' \
    '- **ms**: d1.queue' \
    '- **Used-by**: e2e' \
    '- **Queued-By**: ns/c/m self'
}

d="$(repo q-ready)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue code row' BL-0001; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$GATE_RC" "0" "valid queue-form code row exits 0"
assert_eq "$(codes_of "$GATE_OUT")" "" "valid queue-form code row has no violations"
assert_eq "$(ready_count "$GATE_OUT")" "1" "valid queue-form code row is READY"
assert_eq "$(ready_ids "$GATE_OUT")" "BL-0001" "--ready lists the code row Id"
assert_contains "$GATE_OUT" '"Artifact":"code"' "--ready prints Artifact"
assert_contains "$GATE_OUT" '"Needs":"none"' "--ready prints Needs"
assert_contains "$GATE_OUT" '"ms":"d1.queue"' "--ready prints ms"
assert_contains "$GATE_OUT" '"Feeds":""' "--ready prints Feeds"
gate_run "$GATE" "$d"
assert_eq "$(has_ready_key "$GATE_OUT")" "no" "without --ready the JSON has no ready key"
m="$(mutate qready 's/if (!queueReadyCore(entry, ctx)) return false;/return false;/')"
gate_run "$m" "$d" --ready
assert_eq "$(ready_count "$GATE_OUT")" "0" "READY mutation: the same row is not listed"
assert_eq "$(codes_of "$GATE_OUT")" "" "READY mutation: lint is unchanged"

# Non-JSON --ready. The six fields and ready_count are lines; the lint JSON stays the last line.
# Negative control. Those lines are absent when the printer call is skipped:
#   sed -i 's/if (args.ready && !args.json) printReadyText(report);/if (false) printReadyText(report);/' scripts/check-backlog-entries.js
d="$(repo q-ready-text)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue code row' BL-0001; } > "$d/docs/BACKLOG.md"
READY_TEXT_DIR="$d"
set +e
HUMAN_OUT="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --ready 2>/dev/null)"
HUMAN_RC=$?
set -e
assert_eq "$HUMAN_RC" "0" "non-JSON --ready keeps the lint exit"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Id BL-0001")" "yes" "non-JSON --ready prints Id"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Title Queue code row")" "yes" "non-JSON --ready prints Title"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Artifact code")" "yes" "non-JSON --ready prints Artifact"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Needs none")" "yes" "non-JSON --ready prints Needs"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.ms d1.queue")" "yes" "non-JSON --ready prints ms"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Feeds ")" "yes" "non-JSON --ready prints Feeds"
assert_eq "$(exact_line "$HUMAN_OUT" "ready_count 1")" "yes" "non-JSON --ready prints ready_count"
HUMAN_JSON="$(printf '%s\n' "$HUMAN_OUT" | tail -n 1)"
assert_eq "$(json_exit "$HUMAN_JSON")" "0" "non-JSON --ready keeps the lint JSON exit"
assert_eq "$(codes_of "$HUMAN_JSON")" "" "non-JSON --ready keeps the lint JSON violations"
assert_eq "$(ready_count "$HUMAN_JSON")" "1" "non-JSON --ready lint JSON still carries ready_count"
gate_run "$GATE" "$d" --ready
assert_eq "$(exact_line "$GATE_OUT" "ready.Id BL-0001")" "no" "--json --ready does not print ready.Id lines"
assert_eq "$(ready_count "$GATE_OUT")" "1" "--json --ready still reports ready_count"
d="$(repo q-ready-text-block)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue effort row' BL-0001 | sed 's/- \*\*Effort\*\*: S/- **Effort**: L/'; } > "$d/docs/BACKLOG.md"
set +e
HUMAN_OUT="$(node "$GATE" --backlog "$d/docs/BACKLOG.md" --mode block --ready 2>/dev/null)"
HUMAN_RC=$?
set -e
assert_eq "$HUMAN_RC" "1" "non-JSON --ready keeps a blocking lint exit"
assert_eq "$(exact_line "$HUMAN_OUT" "ready_count 0")" "yes" "non-JSON --ready prints ready_count 0"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Id BL-0001")" "no" "a blocked row is not printed as READY"
HUMAN_JSON="$(printf '%s\n' "$HUMAN_OUT" | tail -n 1)"
assert_eq "$(json_has_code "$HUMAN_JSON" effort_too_large)" "yes" "non-JSON --ready keeps the lint violation in the JSON"
m="$(mutate qready-human 's/if (args.ready \&\& !args.json) printReadyText(report);/if (false) printReadyText(report);/')"
set +e
HUMAN_OUT="$(node "$m" --backlog "$READY_TEXT_DIR/docs/BACKLOG.md" --mode block --ready 2>/dev/null)"
HUMAN_RC=$?
set -e
assert_eq "$HUMAN_RC" "0" "printer skipped: lint exit stays 0"
assert_eq "$(exact_line "$HUMAN_OUT" "ready.Id BL-0001")" "no" "printer skipped: Id line is gone"
assert_eq "$(exact_line "$HUMAN_OUT" "ready_count 1")" "no" "printer skipped: ready_count line is gone"
HUMAN_JSON="$(printf '%s\n' "$HUMAN_OUT" | tail -n 1)"
assert_eq "$(ready_count "$HUMAN_JSON")" "1" "printer skipped: JSON ready_count remains"
assert_eq "$(codes_of "$HUMAN_JSON")" "" "printer skipped: lint JSON is unchanged"

d="$(repo q-effort)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue effort row' BL-0001 | sed 's/- \*\*Effort\*\*: S/- **Effort**: L/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "effort_too_large:Effort:Queue effort row" "Effort L is effort_too_large"
m="$(mutate q-effort "s/push('effort_too_large'/push('effort_too_large_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" effort_too_large)" "no" "effort_too_large mutation: the code is gone"

d="$(repo q-tbd)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue tbd row' BL-0001 | sed 's/- \*\*Done-Check\*\*: `node scripts\/check-backlog-entries.js --self-test`/- **Done-Check**: TBD/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "done_check_unrunnable:Done-Check:Queue tbd row" "Done-Check TBD is unrunnable"
m="$(mutate q-tbd "s/push('done_check_unrunnable'/push('done_check_unrunnable_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" done_check_unrunnable)" "no" "done_check_unrunnable mutation: the code is gone"

d="$(repo q-artifact)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue artifact row' BL-0001 | sed 's/- \*\*Artifact\*\*: code/- **Artifact**: widget/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_artifact)" "yes" "Artifact widget is bad_artifact"
m="$(mutate q-artifact "s/push('bad_artifact'/push('bad_artifact_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_artifact)" "no" "bad_artifact mutation: the code is gone"

d="$(repo q-needs)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue needs row' BL-0001 | sed 's/- \*\*Needs\*\*: none/- **Needs**: later/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_needs)" "yes" "Needs later is bad_needs"
m="$(mutate q-needs "s/push('bad_needs'/push('bad_needs_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_needs)" "no" "bad_needs mutation: the code is gone"

d="$(repo q-ms)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue ms row' BL-0001 | sed 's/- \*\*ms\*\*: d1.queue/- **ms**: Step/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_ms)" "yes" "ms Step is bad_ms"
m="$(mutate q-ms "s/push('bad_ms'/push('bad_ms_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_ms)" "no" "bad_ms mutation: the code is gone"

d="$(repo q-used)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue used row' BL-0001 | sed 's/- \*\*Used-by\*\*: e2e/- **Used-by**: n\/a short/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_used_by)" "yes" "Used-by n/a short is bad_used_by"
m="$(mutate q-used "s/push('bad_used_by'/push('bad_used_by_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_used_by)" "no" "bad_used_by mutation: the code is gone"

d="$(repo q-queued)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue queued row' BL-0001 | sed 's/- \*\*Queued-By\*\*: ns\/c\/m self/- **Queued-By**: ns\/c\/m/'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_queued_by)" "yes" "Queued-By with no message id is bad_queued_by"
m="$(mutate q-queued "s/push('bad_queued_by'/push('bad_queued_by_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" bad_queued_by)" "no" "bad_queued_by mutation: the code is gone"

d="$(repo q-text)"
cat > "$d/docs/BACKLOG.md" <<'EOF'
<!-- next-id: BL-0003 -->

### Host legacy row
- **Id**: BL-0001
- **Status**: open
- **Trigger**: when the fixture runs
- **Trigger-Type**: event
- **Effort**: S
- **Source**: suite
- **Pointer**: docs/plans/ok.md

### Queue text row
- **Id**: BL-0002
- **Status**: open
- **Trigger**: when the fixture runs
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: suite
- **Pointer**: docs/plans/ok.md
- **Done-Check**: `node scripts/check-backlog-entries.js --self-test`
- **Artifact**: text
- **Needs**: none
- **ms**: d1.queue
- **Used-by**: e2e
- **Queued-By**: ns/c/m self
- **Prompt**: docs/plans/ok.md
- **Feeds**: BL-0001
EOF
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "text_row_missing_inputs:Inputs:Queue text row" "text row without Inputs is text_row_missing_inputs"
m="$(mutate q-text "s/push('text_row_missing_inputs'/push('text_row_missing_inputs_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" text_row_missing_inputs)" "no" "text_row_missing_inputs mutation: the code is gone"

d="$(repo q-feeds)"
cat > "$d/docs/BACKLOG.md" <<'EOF'
<!-- next-id: BL-0003 -->

### Host legacy row
- **Id**: BL-0001
- **Status**: open
- **Trigger**: when the fixture runs
- **Trigger-Type**: event
- **Effort**: S
- **Source**: suite
- **Pointer**: docs/plans/ok.md

### Queue feeds row
- **Id**: BL-0002
- **Status**: open
- **Trigger**: when the fixture runs
- **Trigger-Type**: ready
- **Effort**: S
- **Source**: suite
- **Pointer**: docs/plans/ok.md
- **Done-Check**: `node scripts/check-backlog-entries.js --self-test`
- **Artifact**: text
- **Needs**: none
- **ms**: d1.queue
- **Used-by**: e2e
- **Queued-By**: ns/c/m self
- **Prompt**: docs/plans/ok.md
- **Inputs**: docs/plans/ok.md
- **Feeds**: BL-0099
EOF
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "feeds_broken:Feeds:Queue feeds row" "Feeds of a missing id is feeds_broken"
m="$(mutate q-feeds "s/code: 'feeds_broken'/code: 'feeds_broken_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" feeds_broken)" "no" "feeds_broken mutation: the code is gone"

d="$(repo q-cycle)"
{
  printf '<!-- next-id: BL-0004 -->\n\n'
  qhead 'Queue cycle a' BL-0002
  printf '%s\n' '- **after**: BL-0003' ''
  qhead 'Queue cycle b' BL-0003
  printf '%s\n' '- **after**: BL-0002'
} > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" after_cycle)" "yes" "BL-0002 <-> BL-0003 is after_cycle"
assert_contains "$GATE_OUT" "BL-0002 -> BL-0003 -> BL-0002" "after_cycle names the cycle"
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "no" "a live cycle is not after_broken"
m="$(mutate q-cycle "s/code: 'after_cycle'/code: 'after_cycle_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" after_cycle)" "no" "after_cycle mutation: the code is gone"

d="$(repo q-self)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue self row' BL-0001; printf '%s\n' '- **after**: BL-0001'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "after_cycle:after:Queue self row" "self-reference is after_cycle"
assert_contains "$GATE_OUT" "BL-0001 -> BL-0001" "self-reference names the cycle"

d="$(repo q-ge)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue future row' BL-0001; printf '%s\n' '- **after**: BL-0099'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(codes_of "$GATE_OUT")" "after_broken:after:Queue future row" "after BL-0099 >= next-id is after_broken"
m="$(mutate q-ge "s/code: 'after_broken'/code: 'after_broken_off'/")"
gate_run "$m" "$d"
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "no" "after_broken mutation: the code is gone"

d="$(repo q-absent)"
{ printf '<!-- next-id: BL-0003 -->\n\n'; qhead 'Queue depends absent' BL-0002; printf '%s\n' '- **after**: BL-0001'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$GATE_RC" "0" "absent after id below the mark does not block"
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "no" "absent below the mark is not after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "BL-0002" "absent below the mark leaves B READY"

d="$(repo q-open)"
{
  printf '<!-- next-id: BL-0003 -->\n\n'
  printf '%s\n' '### Open pred' '- **Id**: BL-0001' '- **Status**: open' '- **Trigger**: when the fixture runs' '- **Trigger-Type**: event' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' ''
  qhead 'Queue depends open' BL-0002
  printf '%s\n' '- **after**: BL-0001'
} > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$GATE_RC" "0" "an open predecessor is not a lint failure"
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "no" "an open predecessor is not after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "" "an open predecessor leaves B not READY"

d="$(repo q-prompt)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue prompt row' BL-0001; printf '%s\n' '- **Prompt**: docs/plans/ok.md'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" extra_content)" "yes" "Prompt on a code row is extra_content"

# Empty after segments and empty Prompt/Inputs/Feeds bullets are not READY.
# Negative control for after. Restoring filter(Boolean) drops the empty segment and the row is READY:
#   sed -i "s/return String(raw).split(';').map((s) => s.trim());/return String(raw).split(';').map((s) => s.trim()).filter(Boolean);/" scripts/lib/backlog-rules.js
d="$(repo q-after-empty)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue empty after' BL-0001; printf '%s\n' '- **after**:'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "yes" "empty after is after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "" "empty after is not READY"
d="$(repo q-after-semi)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue semi after' BL-0001; printf '%s\n' '- **after**: ;'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "yes" "after ';' is after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "" "after ';' is not READY"
d="$(repo q-after-trail)"
{
  printf '<!-- next-id: BL-0003 -->\n\n'
  printf '%s\n' '### Shipped pred' '- **Id**: BL-0001' '- **Status**: shipped v0 2020-01-01' '- **Trigger**: when the fixture runs' '- **Trigger-Type**: event' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' ''
  qhead 'Queue trail after' BL-0002
  printf '%s\n' '- **after**: BL-0001;'
} > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "yes" "after BL-0001; keeps the empty segment as after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "" "a satisfied id plus an empty segment is not READY"
m="$(mutate q-after-empty 's/return String(raw).split('"'"';'"'"').map((s) => s.trim());/return String(raw).split('"'"';'"'"').map((s) => s.trim()).filter(Boolean);/')"
gate_run "$m" "$d" --ready
assert_eq "$(json_has_code "$GATE_OUT" after_broken)" "no" "afterList filter(Boolean): the empty segment is not after_broken"
assert_eq "$(ready_ids "$GATE_OUT")" "BL-0002" "afterList filter(Boolean): the row is READY again"

# Negative control for text fields. queuePresent treats an empty bullet as absent:
#   sed -i "s/if (fields\[f\] != null) push('extra_content'/if (queuePresent(fields, f)) push('extra_content'/" scripts/lib/backlog-rules.js
d="$(repo q-empty-prompt)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue empty prompt' BL-0001; printf '%s\n' '- **Prompt**:' '- **Inputs**:' '- **Feeds**:'; } > "$d/docs/BACKLOG.md"
EMPTY_TEXT_DIR="$d"
gate_run "$GATE" "$d" --ready
assert_contains "$(codes_of "$GATE_OUT")" "extra_content:Prompt:Queue empty prompt" "empty Prompt on a code row is extra_content"
assert_contains "$(codes_of "$GATE_OUT")" "extra_content:Inputs:Queue empty prompt" "empty Inputs on a code row is extra_content"
assert_contains "$(codes_of "$GATE_OUT")" "extra_content:Feeds:Queue empty prompt" "empty Feeds on a code row is extra_content"
assert_eq "$(ready_ids "$GATE_OUT")" "" "empty text fields on a code row are not READY"
d="$(repo q-empty-run)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue empty run' BL-0001 | sed 's/- \*\*Artifact\*\*: code/- **Artifact**: run/'; printf '%s\n' '- **Prompt**:'; } > "$d/docs/BACKLOG.md"
gate_run "$GATE" "$d" --ready
assert_eq "$(json_has_code "$GATE_OUT" extra_content)" "yes" "empty Prompt on a run row is extra_content"
assert_eq "$(ready_ids "$GATE_OUT")" "" "empty Prompt on a run row is not READY"
m="$(mutate q-empty-prompt 's/if (fields\[f\] != null) push('"'"'extra_content'"'"'/if (queuePresent(fields, f)) push('"'"'extra_content'"'"'/')"
gate_run "$m" "$EMPTY_TEXT_DIR" --ready
assert_eq "$(json_has_code "$GATE_OUT" extra_content)" "no" "queuePresent: an empty Prompt bullet is not extra_content"
assert_eq "$(ready_ids "$GATE_OUT")" "BL-0001" "queuePresent: an empty Prompt row is READY again"

d="$(repo q-caplow)"
{ printf '<!-- next-id: BL-0002 -->\n\n'; qhead 'Queue cap row' BL-0001; } > "$d/docs/BACKLOG.md"
printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' '## Caps' '- queue: 100' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_contains "$(codes_of "$GATE_OUT")" "cap_exceeded:queue:" "a config may lower the queue cap"
printf '%s\n' '## Style' '- style: heading' '## Mode' '- mode: block' '## Caps' '- queue: 2500' > "$d/.claude/backlog-config.md"
gate_run "$GATE" "$d" --config "$d/.claude/backlog-config.md"
assert_eq "$(json_has_code "$GATE_OUT" config_raises_cap)" "yes" "a config may not raise the queue cap"

# --- PADDED_DEADLINE (PM 01M78CC2) ---
# Hours come from EFFORT_HOURS. Due is measured from Since at UTC midnight.
# M * 2 is the exact boundary; one hour past it is the first case.
PD_RULES="$REPO_ROOT/scripts/lib/backlog-rules.js"
PD_LINE="$(node -e '
const { EFFORT_HOURS } = require(process.argv[1]);
const h = EFFORT_HOURS.M;
const start = Date.parse("2026-11-13T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");
process.stdout.write(String(h) + " " + iso(start + h * 2 * 3600000) + " " + iso(start + h * 2 * 3600000 + 3600000));
' "$PD_RULES")"
read -r PD_M_HOURS PD_EXACT PD_OVER <<<"$PD_LINE"
pd_file() { # <dir> <title> <effort> <due> <needs, empty omits the line> [trigger-type]
  local needs="$5" tt="${6:-ready}"
  {
    printf '<!-- next-id: BL-0002 -->\n\n'
    qhead "$2" BL-0001 | sed \
      -e "s/- \*\*Effort\*\*: S/- **Effort**: $3/" \
      -e "s/- \*\*Trigger-Type\*\*: ready/- **Trigger-Type**: $tt/" \
      -e '/- \*\*Needs\*\*: none/d'
    printf '%s\n' "- **Since**: 2026-11-13" "- **Due**: $4"
    if [ -n "$needs" ]; then printf '%s\n' "- **Needs**: $needs"; fi
  } > "$1/docs/BACKLOG.md"
}

d="$(repo pd-none)"
pd_file "$d" 'Padded no needs' M "$PD_OVER" ''
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" PADDED_DEADLINE)" "yes" "M due past 2x with no Needs is PADDED_DEADLINE (${PD_M_HOURS}h, due $PD_OVER)"
PD_FIRST="$d"
# Negative control. The first case is red only while PADDED_DEADLINE_MULTIPLIER is 2.
# Rewrite that one assignment to Infinity and the same row is not flagged, so the
# assertion above would go red. How:
#   sed -i 's/const PADDED_DEADLINE_MULTIPLIER = 2;/const PADDED_DEADLINE_MULTIPLIER = Infinity;/' scripts/lib/backlog-rules.js
m="$(mutate padded 's/const PADDED_DEADLINE_MULTIPLIER = 2;/const PADDED_DEADLINE_MULTIPLIER = Infinity;/')"
gate_run "$m" "$PD_FIRST"
assert_eq "$(json_has_code "$GATE_OUT" PADDED_DEADLINE)" "no" "Infinity multiplier: the first case is not flagged"

d="$(repo pd-bl)"
pd_file "$d" 'Padded backlog dep' M "$PD_OVER" 'BL-0123'
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" PADDED_DEADLINE)" "no" "Needs: BL-0123 is a checkable dependency, so PADDED_DEADLINE is absent"
assert_eq "$(json_has_code "$GATE_OUT" bad_needs)" "yes" "Needs: BL-0123 stays bad_needs; the dependency rule does not widen needsOk"

d="$(repo pd-tomorrow)"
pd_file "$d" 'Padded tomorrow' M "$PD_OVER" '"tomorrow"'
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" PADDED_DEADLINE)" "yes" "Needs: \"tomorrow\" is not a checkable dependency"

d="$(repo pd-exact)"
pd_file "$d" 'Exact two times' M "$PD_EXACT" 'none'
gate_run "$GATE" "$d"
assert_eq "$GATE_RC:$(codes_of "$GATE_OUT")" "0:" "exactly 2x (${PD_EXACT}) with Needs: none is clean"

d="$(repo pd-event)"
pd_file "$d" 'Event due' M "$PD_OVER" 'none' event
gate_run "$GATE" "$d"
assert_eq "$(json_has_code "$GATE_OUT" PADDED_DEADLINE)" "no" "Trigger-Type event is not a READY row, so the same due is not flagged"

pd_fn="$(node - "$PD_RULES" "$PD_EXACT" "$PD_OVER" <<'NODE'
const { paddedDeadline, EFFORT_HOURS, PADDED_DEADLINE_MULTIPLIER } = require(process.argv[2]);
const exact = process.argv[3];
const over = process.argv[4];
const limit = EFFORT_HOURS.M * PADDED_DEADLINE_MULTIPLIER;
const fails = [];
function check(cond, msg) { if (!cond) fails.push(msg); }
const brief = paddedDeadline("Effort: M\nDue: " + (limit + 1) + "h\n");
check(brief && brief.code === "PADDED_DEADLINE" && String(brief.detail).indexOf(limit + "h") >= 0, "padded brief");
check(paddedDeadline("Effort: M\nDue: " + (limit + 1) + "h\nNeeds: BL-0123\n") == null, "brief Needs BL-0123");
check(paddedDeadline("Effort: M\nDue: " + (limit + 1) + "h\nNeeds: \"tomorrow\"\n") != null, "brief Needs tomorrow");
check(paddedDeadline("Effort: M\nSince: 2026-11-13\nDue: " + exact + "\n") == null, "brief exactly 2x");
const reply = paddedDeadline("Effort: M\nStart: 2026-11-13T00:00:00Z\nDeadline: " + over + "\n");
check(reply && reply.code === "PADDED_DEADLINE", "fleet reply uses paddedDeadline");
check(paddedDeadline("Effort: M\nDue: " + (limit + 1) + "h\nafter: BL-0123\n") == null, "after BL-0123");
process.stdout.write(fails.join("|"));
NODE
)"
assert_eq "$pd_fn" "" "paddedDeadline on a brief and a fleet reply ($pd_fn)"

pd_brief="$TEST_TMP/padded-brief.txt"
node -e '
const { EFFORT_HOURS, PADDED_DEADLINE_MULTIPLIER } = require(process.argv[1]);
const limit = EFFORT_HOURS.M * PADDED_DEADLINE_MULTIPLIER;
require("fs").writeFileSync(process.argv[2], "Effort: M\nDue: " + (limit + 1) + "h\n");
' "$PD_RULES" "$pd_brief"
set +e
pd_out="$(timeout 30 "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch bl/padded-deadline-probe --prompt-file "$pd_brief" 2>&1)"
pd_rc=$?
set -e
assert_eq "$pd_rc" "2" "dispatch guard refuses a padded brief (exit $pd_rc)"
assert_contains "$pd_out" "PADDED_DEADLINE" "dispatch guard returns the rule name"
PD_LIMIT=$((PD_M_HOURS * 2))
assert_contains "$pd_out" "(${PD_LIMIT}h)" "dispatch guard detail is the computed 2x budget (${PD_LIMIT}h), not a hardcoded die"
assert_contains "$pd_out" "2x" "dispatch guard detail names the 2x multiple"
assert_contains "$pd_out" '"status": "precondition_failed"' "padded brief is precondition_failed"
assert_contains "$pd_out" '"dispatcher_called": false' "padded brief is returned to the dispatcher"
assert_contains "$pd_out" '"model_calls": 0' "padded brief does not reach a model call"

# The record-files fixture, resolved from this repo root (the sidecar path is not under the fixture dir).
FIX="$REPO_ROOT/hooks/tests/fixtures/record-files/base/docs/BACKLOG.md"
set +e
o="$(node "$GATE" --backlog "$FIX" --mode block --json 2>/dev/null)"
rc=$?
set -e
assert_eq "$rc" "1" "legacy fixture exit unchanged"
assert_eq "$(codes_of "$o")" "pointer_unresolved:Pointer:Row with a sidecar note" "legacy fixture violations unchanged"
assert_contains "$o" "docs/backlog/side-note.md" "legacy fixture pointer detail unchanged"
assert_eq "$(has_ready_key "$o")" "no" "legacy fixture lint JSON has no ready key"
set +e
o="$(node "$GATE" --backlog "$FIX" --mode block --json --ready 2>/dev/null)"
rc=$?
set -e
assert_eq "$rc" "1" "legacy fixture --ready keeps the lint exit"
assert_eq "$(ready_count "$o")" "0" "legacy rows are not READY"

finalize_test
