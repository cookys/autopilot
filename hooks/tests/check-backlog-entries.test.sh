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
printf '%s\n' '### Bad effort row' '- **Status**: open' '- **Trigger**: when tests run' '- **Effort**: XL' '- **Source**: suite' '- **Pointer**: docs/plans/ok.md' > "$d/docs/BACKLOG.md"
code_case bad_effort "$d"

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

mut="$TEST_TMP/check-mut.js"
sed "s/Status: 'pending'/Status: 'open'/" "$GATE" > "$mut"
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

finalize_test
