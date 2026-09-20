#!/usr/bin/env bash
# check-plan-graduation.test.sh — red-first suite for the plan-graduation lifecycle gate.
#
# BACKLOG is a queue; a plan is the project for campaign work; a 🔵 finding never
# becomes a BACKLOG row. Each fixture is a throwaway `git init` repo under $TEST_TMP —
# never the real repo's docs/BACKLOG.md, docs/plans/, or CHANGELOG.md.

. "$(dirname "$0")/lib.sh"

GATE="$REPO_ROOT/scripts/check-plan-graduation.js"

# fixture_repo <name> — a fresh git repo with the minimum plan-graduation shape.
fixture_repo() {
  local d="$TEST_TMP/$1"
  mkdir -p "$d/docs/plans/evidence" "$d/docs/projects"
  git -C "$d" init -q >/dev/null
  cat > "$d/docs/BACKLOG.md" <<'MD'
# BACKLOG
MD
  cat > "$d/CHANGELOG.md" <<'MD'
# Changelog
MD
  echo "$d"
}

backlog_row() {
  # backlog_row <file> <title> <status> <pointer>
  local file="$1" title="$2" status="$3" pointer="$4"
  {
    printf '\n### %s\n' "$title"
    printf -- '- **Status**: %s\n' "$status"
    printf -- '- **Trigger**: when tests run\n'
    printf -- '- **Effort**: S\n'
    printf -- '- **Source**: suite\n'
    printf -- '- **Pointer**: %s\n' "$pointer"
  } >> "$file"
}

json_exit() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).exit))}catch(e){process.stdout.write("x")}})'
}

json_count() {
  printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(d).counts['$2']||0))}catch(e){process.stdout.write('x')}})"
}

# --- clean repo: exit 0 ---
d="$(fixture_repo clean)"
backlog_row "$d/docs/BACKLOG.md" "Untouched open row" "open" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_exit "$out")" "0" "clean fixture exits 0"
assert_contains "$out" '"ok":true' "clean fixture reports ok:true"

# --- backlog_row_has_plan: Pointer resolves to an existing docs/plans/*.md ---
d="$(fixture_repo has-plan)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
backlog_row "$d/docs/BACKLOG.md" "Widget row" "open" "docs/plans/2026-01-01-widget.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_exit "$out")" "1" "backlog_row_has_plan blocks"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "1" "backlog_row_has_plan fires once"

# ...also counts an archived plan ("archived or not")
d="$(fixture_repo has-plan-archived)"
mkdir -p "$d/docs/plans/_archive"
printf '# Plan\n' > "$d/docs/plans/_archive/2026-01-01-widget.md"
backlog_row "$d/docs/BACKLOG.md" "Widget row" "open" "docs/plans/_archive/2026-01-01-widget.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "1" "backlog_row_has_plan counts an archived plan too"

# --- word-boundary: a Pointer into an evidence subpath (not the plan file itself)
#     must NOT trigger backlog_row_has_plan ---
d="$(fixture_repo evidence-pointer)"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/notes.md"
backlog_row "$d/docs/BACKLOG.md" "Widget evidence row" "open" "docs/plans/evidence/2026-01-01-widget/notes.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "0" \
  "a pointer into an evidence subpath is not itself docs/plans/*.md"

# --- backlog_row_done: Status starts with shipped/dropped ---
d="$(fixture_repo done-shipped)"
backlog_row "$d/docs/BACKLOG.md" "Shipped row" "shipped v1.0.0 2020-01-01" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_done)" "1" "shipped row is backlog_row_done"

d="$(fixture_repo done-dropped)"
backlog_row "$d/docs/BACKLOG.md" "Dropped row" "dropped 2020-01-01" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_done)" "1" "dropped row is backlog_row_done"

# A done row that ALSO has a plan-file pointer is reported once, as backlog_row_done —
# it will be deleted either way, so it is not double-counted under both codes.
d="$(fixture_repo done-and-has-plan)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
backlog_row "$d/docs/BACKLOG.md" "Shipped widget row" "shipped v1.0.0 2020-01-01" "docs/plans/2026-01-01-widget.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_done)" "1" "done-and-has-plan counts once as backlog_row_done"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "0" "done-and-has-plan does not double-count backlog_row_has_plan"

# --- backlog_title_closed_status_open ---
d="$(fixture_repo title-closed)"
backlog_row "$d/docs/BACKLOG.md" 'A CLOSED-looking title' "open" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_title_closed_status_open)" "1" "CLOSED marker with open status fires"

d="$(fixture_repo title-tilde)"
backlog_row "$d/docs/BACKLOG.md" '~~A struck-through title~~' "open" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_title_closed_status_open)" "1" "~~ marker with open status fires"

d="$(fixture_repo title-fixedv)"
backlog_row "$d/docs/BACKLOG.md" 'Bug — FIXED v2.0.0' "open" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_title_closed_status_open)" "1" "FIXED v marker with open status fires"

# A SHIPPED-looking title whose Status is ALREADY shipped is backlog_row_done, not
# backlog_title_closed_status_open (the code is specifically about the open/title
# MISMATCH, not about the marker alone).
d="$(fixture_repo title-shipped-status-shipped)"
backlog_row "$d/docs/BACKLOG.md" 'Feature SHIPPED v1.0.0' "shipped v1.0.0 2020-01-01" "none"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_title_closed_status_open)" "0" \
  "a shipped-status row is not also flagged as title/status mismatch"
assert_eq "$(json_count "$out" backlog_row_done)" "1" "...it is backlog_row_done instead"

# --- plan_released_not_archived + word-boundary slug matching ---
d="$(fixture_repo released)"
printf '# Plan\n' > "$d/docs/plans/2026-09-19-blind-review-2d-overlap.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships blind-review-2d-overlap

- landed the thing.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "1" "released plan is flagged"

# RED at base: a naive `.includes(slug)` substring match would ALSO fire on an
# unrelated word that merely CONTAINS the slug's letters with no separator (e.g.
# "review" inside "reviewed") — word-boundary matching must not, per the "foo must
# not match foobar" rule.
d="$(fixture_repo boundary)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-review.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.0.0 — this was reviewed by two engines

- unrelated feature.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "0" \
  "RED: slug 'review' must not match inside 'reviewed' (word boundary)"

# --- allowlist excludes a plan stem from plan_released_not_archived and plan_orphan ---
d="$(fixture_repo allowlisted)"
printf '# Plan\n' > "$d/docs/plans/2026-09-19-blind-review-2d-overlap.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships blind-review-2d-overlap

- landed the thing.
MD
printf '["2026-09-19-blind-review-2d-overlap"]' > "$d/allowlist.json"
out="$(node "$GATE" --repo-root "$d" --allowlist "$d/allowlist.json" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "0" "allowlisted stem is excluded from plan_released_not_archived"
assert_eq "$(json_count "$out" plan_orphan)" "0" "allowlisted stem is also excluded from plan_orphan"
assert_eq "$(json_exit "$out")" "0" "allowlisted-only repo exits 0"

# --- plan_orphan: report-only, never blocks on its own ---
d="$(fixture_repo orphan)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_orphan)" "1" "an unreferenced plan is plan_orphan"
assert_eq "$(json_exit "$out")" "0" "plan_orphan alone does not block (exit 0)"

# A plan mentioned in docs/BACKLOG.md is not orphaned.
d="$(fixture_repo orphan-in-backlog)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
backlog_row "$d/docs/BACKLOG.md" "Row pointing elsewhere" "open" "none"
printf '\nsee docs/plans/2026-01-01-forgotten.md\n' >> "$d/docs/BACKLOG.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_orphan)" "0" "a plan mentioned in BACKLOG.md is not orphaned"

# A plan named as a docs/plans/evidence/ dir is not orphaned.
d="$(fixture_repo orphan-in-evidence)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
mkdir -p "$d/docs/plans/evidence/2026-01-01-forgotten"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_orphan)" "0" "a plan named as an evidence/ dir is not orphaned"

# A sidecar (<same stem>.rubric.md) is never independently checked — it rides with
# its primary plan and is not itself scanned for plan_orphan / plan_released_not_archived.
d="$(fixture_repo sidecar-ignored)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
printf '# Rubric\n' > "$d/docs/plans/2026-01-01-forgotten.rubric.md"
backlog_row "$d/docs/BACKLOG.md" "Row pointing elsewhere" "open" "none"
printf '\nsee docs/plans/2026-01-01-forgotten.md\n' >> "$d/docs/BACKLOG.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_orphan)" "0" "sidecar is not independently reported orphan (primary is referenced)"

# --- --fix: deletes doomed BACKLOG rows and moves plan+sidecar+evidence to _archive ---
d="$(fixture_repo fix-all)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
printf '# Rubric\n' > "$d/docs/plans/2026-01-01-widget.rubric.md"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/README.md"
backlog_row "$d/docs/BACKLOG.md" "Keep me" "open" "none"
backlog_row "$d/docs/BACKLOG.md" "Widget has-plan row" "open" "docs/plans/2026-01-01-widget.md"
backlog_row "$d/docs/BACKLOG.md" "Old shipped row" "shipped v1.0.0 2020-01-01" "none"
backlog_row "$d/docs/BACKLOG.md" 'MAIN CLAIM CLOSED but still open' "open" "none"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships widget

- landed the thing.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --fix --json)"
assert_eq "$(json_exit "$out")" "1" "--fix still reports the exit code of what it found (unfixed report_only items aside, run pre-fix state)"
assert_contains "$(cat "$d/docs/BACKLOG.md")" "Keep me" "surviving row is kept"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "Widget has-plan row" "backlog_row_has_plan row is deleted"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "Old shipped row" "backlog_row_done row is deleted"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "MAIN CLAIM CLOSED but still open" "backlog_title_closed_status_open row is deleted"
assert_file_absent "$d/docs/plans/2026-01-01-widget.md" "released plan is moved out of docs/plans/"
assert_file_exists "$d/docs/plans/_archive/2026-01-01-widget.md" "released plan lands in _archive"
assert_file_exists "$d/docs/plans/_archive/2026-01-01-widget.rubric.md" "sidecar moves with its primary plan"
assert_file_exists "$d/docs/plans/_archive/evidence/2026-01-01-widget/README.md" "evidence dir moves with its primary plan"

# A second run against the now-fixed repo is clean.
out2="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_exit "$out2")" "0" "a fixed repo re-checks clean"

# --fix never touches plan_orphan (report-only, non-blocking, --fix is silent on it).
d="$(fixture_repo fix-orphan-untouched)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_file_exists "$d/docs/plans/2026-01-01-forgotten.md" "--fix never moves an orphaned plan"

# --- usage / exit codes ---
set +e
node "$GATE" --nonsense-flag >/dev/null 2>&1
rc=$?
set -e
assert_eq "$rc" "2" "an unknown flag exits 2 (usage)"

finalize_test
