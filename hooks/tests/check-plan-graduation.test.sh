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

# --- backlog_row_has_plan is broadened: ANY path whose stem belongs to an existing plan —
#     the plan file, a sidecar, or anything under its evidence dir — counts, not just a
#     direct docs/plans/<stem>.md pointer. ---

# ...a pointer into the plan's evidence dir counts.
d="$(fixture_repo evidence-pointer)"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/notes.md"
backlog_row "$d/docs/BACKLOG.md" "Widget evidence row" "open" "docs/plans/evidence/2026-01-01-widget/notes.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "1" \
  "a pointer into the plan's evidence dir counts as backlog_row_has_plan"
assert_contains "$out" '"stem":"2026-01-01-widget"' \
  "the violation reports the matched plan stem (evidence-dir pointer)"

# ...a pointer at one of the plan's sidecars counts.
d="$(fixture_repo sidecar-pointer)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
printf '# Rubric\n' > "$d/docs/plans/2026-01-01-widget.rubric.md"
backlog_row "$d/docs/BACKLOG.md" "Widget sidecar row" "open" "docs/plans/2026-01-01-widget.rubric.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "1" \
  "a pointer at the plan's sidecar counts as backlog_row_has_plan"
assert_contains "$out" '"stem":"2026-01-01-widget"' \
  "the violation reports the matched plan stem (sidecar pointer)"

# ...but a pointer into an evidence dir whose OWN stem has no plan file does NOT count —
# stem extraction is not enough; the plan itself must exist.
d="$(fixture_repo evidence-pointer-no-plan)"
mkdir -p "$d/docs/plans/evidence/2026-01-01-orphan-evidence"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-orphan-evidence/notes.md"
backlog_row "$d/docs/BACKLOG.md" "Orphan evidence row" "open" "docs/plans/evidence/2026-01-01-orphan-evidence/notes.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "0" \
  "an evidence-dir pointer with no matching plan file is not backlog_row_has_plan"

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

# RED: `\b` treats `-` as a boundary, so a naive `\bslug\b` regex WOULD match
# "foreman-rail" inside "foreman-rail-gaps" (the "-" right after "rail" satisfies `\b`).
# The match must be bounded by a character outside [A-Za-z0-9-] on both sides.
d="$(fixture_repo hyphen-boundary)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-foreman-rail.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.0.0 — closes foreman-rail-gaps entirely

- unrelated feature.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "0" \
  "RED: slug 'foreman-rail' must not match inside 'foreman-rail-gaps' (hyphen boundary)"

# ...but a real, cleanly-bounded mention of the slug DOES still fire.
d="$(fixture_repo hyphen-boundary-real-hit)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-foreman-rail.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.0.0 — ships foreman-rail (the whole thing, no more)

- landed it.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "1" \
  "a cleanly-bounded mention of the slug still fires"

# The full <date>-<slug> stem is also accepted, boundary-matched, not just the bare slug.
d="$(fixture_repo full-stem-match)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-foreman-rail.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.0.0 — see 2026-01-01-foreman-rail for detail

- landed it.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "1" \
  "the full <date>-<slug> stem, boundary-matched, also fires"

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
# 🟡 fix: --fix re-runs the check against the POST-fix state and derives exit/ok from
# that, not the pre-fix snapshot — everything this fixture set up is fixable, so exit 0.
assert_eq "$(json_exit "$out")" "0" "--fix derives exit/ok from the post-fix state"
assert_contains "$out" '"fixed":[' "the pre-fix violations are kept under the fixed key"
assert_contains "$out" '"backlog_row_has_plan"' "the fixed key's content is the pre-fix violation set"
assert_contains "$(cat "$d/docs/BACKLOG.md")" "Keep me" "surviving row is kept"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "Widget has-plan row" "backlog_row_has_plan row is deleted"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "Old shipped row" "backlog_row_done row is deleted"
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "MAIN CLAIM CLOSED but still open" "backlog_title_closed_status_open row is deleted"
assert_file_absent "$d/docs/plans/2026-01-01-widget.md" "released plan is moved out of docs/plans/"
assert_file_exists "$d/docs/plans/_archive/2026/01/2026-01-01-widget.md" "released plan lands in the dated _archive/YYYY/MM"
assert_file_exists "$d/docs/plans/_archive/2026/01/2026-01-01-widget.rubric.md" "sidecar moves with its primary plan"
assert_file_exists "$d/docs/plans/_archive/2026/01/evidence/2026-01-01-widget/README.md" "evidence dir moves with its primary plan"

# A second run against the now-fixed repo is clean.
out2="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_exit "$out2")" "0" "a fixed repo re-checks clean"

# --fix never touches plan_orphan (report-only, non-blocking, --fix is silent on it).
d="$(fixture_repo fix-orphan-untouched)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-forgotten.md"
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_file_exists "$d/docs/plans/2026-01-01-forgotten.md" "--fix never moves an orphaned plan"

# A row pointing INTO a released plan's evidence dir is caught by the broadened
# backlog_row_has_plan and deleted by --fix BEFORE the evidence dir itself moves to
# _archive/ — so nothing survives to dangle as pointer_unresolved.
d="$(fixture_repo fix-deletes-evidence-pointer-row)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/README.md"
backlog_row "$d/docs/BACKLOG.md" "Widget evidence row" "open" "docs/plans/evidence/2026-01-01-widget/README.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships widget

- landed the thing.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_not_contains "$(cat "$d/docs/BACKLOG.md")" "Widget evidence row" \
  "the evidence-pointing row is deleted, not left to dangle"
assert_file_exists "$d/docs/plans/_archive/2026/01/evidence/2026-01-01-widget/README.md" \
  "the evidence dir still moves to the dated _archive/YYYY/MM/evidence/"
bgate_out="$(node "$REPO_ROOT/scripts/check-backlog-entries.js" --backlog "$d/docs/BACKLOG.md" --json)"
assert_not_contains "$bgate_out" '"pointer_unresolved"' \
  "no row survives to report pointer_unresolved"

# --- 🟠 fix: gitMv fallback must never clobber an existing destination; a stem's move is
#     all-or-nothing (a pre-existing _archive/<stem>.md stops the WHOLE stem's move, not
#     just that one file) ---
d="$(fixture_repo archive-destination-exists)"
printf '# Plan (current)\n' > "$d/docs/plans/2026-01-01-widget.md"
printf '# Rubric\n' > "$d/docs/plans/2026-01-01-widget.rubric.md"
mkdir -p "$d/docs/plans/_archive/2026/01"
printf '# Plan (STALE, pre-existing)\n' > "$d/docs/plans/_archive/2026/01/2026-01-01-widget.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships widget

- landed the thing.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --fix --json)"
assert_eq "$(json_exit "$out")" "1" "archive_destination_exists blocks (post-fix exit stays 1)"
assert_eq "$(json_count "$out" archive_destination_exists)" "1" "the clash is reported by name"
assert_contains "$(cat "$d/docs/plans/_archive/2026/01/2026-01-01-widget.md")" "STALE, pre-existing" \
  "the pre-existing archive destination is untouched (not clobbered)"
assert_file_exists "$d/docs/plans/2026-01-01-widget.md" \
  "the plan itself was NOT moved (all-or-nothing: the clash blocks the whole stem)"
assert_file_exists "$d/docs/plans/2026-01-01-widget.rubric.md" \
  "the sidecar was NOT moved either (all-or-nothing, not just the clashing file)"
assert_file_absent "$d/docs/plans/_archive/2026/01/2026-01-01-widget.rubric.md" \
  "the sidecar did not land in _archive (nothing partially moved)"

# --- 🟡 fix: Unreleased-section fixtures — a slug only under ## Unreleased never fires;
#     the SAME slug also mentioned under a real ## v… section fires once ---
d="$(fixture_repo unreleased-only)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## Unreleased

- ships widget (still cooking)
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "0" \
  "a slug mentioned only under ## Unreleased is not released"

d="$(fixture_repo unreleased-then-released)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## Unreleased

- next up: widget follow-on work

## v1.0.0 — ships widget

- landed it.
MD
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "1" \
  "the same slug under Unreleased AND a real ## v… section fires once (the real section counts)"

# --- Hardening A: a plan named by .claude/mission-routing-config.json's sources manifest
#     is an active lineage — excluded from plan_released_not_archived, reported as
#     plan_active_lineage (non-blocking), and never a --fix move candidate ---
d="$(fixture_repo active-lineage)"
printf '# Plan\n' > "$d/docs/plans/2026-09-19-blind-review-2d-overlap.md"
printf '# Rubric\n' > "$d/docs/plans/2026-09-19-blind-review-2d-overlap.rubric.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships blind-review-2d-overlap

- landed the thing.
MD
mkdir -p "$d/.claude"
cat > "$d/.claude/mission-routing-config.json" <<'JSON'
{
  "schema_version": 1,
  "graph_path": "docs/mission-x-execution-graph.json",
  "sources_path": "docs/mission-x-sources.json"
}
JSON
cat > "$d/docs/mission-x-sources.json" <<'JSON'
{
  "schema_version": 1,
  "sources": [
    {
      "plan_path": "plans/2026-09-19-blind-review-2d-overlap.md",
      "rubric_path": "plans/2026-09-19-blind-review-2d-overlap.rubric.md"
    }
  ]
}
JSON
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_released_not_archived)" "0" \
  "an active-lineage plan is excluded from plan_released_not_archived despite being released"
assert_eq "$(json_count "$out" plan_active_lineage)" "1" "it is reported as plan_active_lineage instead"
assert_eq "$(json_exit "$out")" "0" "plan_active_lineage alone does not block (report-only)"
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_file_exists "$d/docs/plans/2026-09-19-blind-review-2d-overlap.md" \
  "--fix never moves an active-lineage plan (defense in depth even if somehow doomed)"

# --- Hardening B: --fix rewrites docs/plans/<stem> references in OTHER tracked text
#     files (a skill doc linking the plan), except CHANGELOG.md and docs/BACKLOG.md ---
d="$(fixture_repo rewrite-references)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
mkdir -p "$d/skills/some-skill" "$d/references"
cat > "$d/skills/some-skill/SKILL.md" <<'MD'
# Some Skill

See [the widget plan](../../docs/plans/2026-01-01-widget.md) for context.
MD
printf 'Contract: docs/plans/2026-01-01-widget.md\n' > "$d/references/contract.md"
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships widget

- landed the thing. See docs/plans/2026-01-01-widget.md.
MD
backlog_row "$d/docs/BACKLOG.md" "Historical widget mention" "open" "none"
printf '\nsee docs/plans/2026-01-01-widget.md for history\n' >> "$d/docs/BACKLOG.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --fix --json)"
assert_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "docs/plans/_archive/2026/01/2026-01-01-widget.md" \
  "a skill doc's link to the plan is rewritten to the dated _archive/ path"
assert_contains "$(cat "$d/references/contract.md")" \
  "docs/plans/_archive/2026/01/2026-01-01-widget.md" \
  "a reference doc's mention is also rewritten"
assert_contains "$(cat "$d/CHANGELOG.md")" \
  "docs/plans/2026-01-01-widget.md" \
  "CHANGELOG.md is NOT rewritten (history)"
assert_contains "$(cat "$d/docs/BACKLOG.md")" \
  "docs/plans/2026-01-01-widget.md for history" \
  "docs/BACKLOG.md is NOT rewritten (history)"
assert_contains "$out" '"references_rewritten"' "the fix payload reports which files were rewritten"

# --- Frozen assets: a sealed file (a *.seal.json's spec_path) and the seal itself are NEVER
#     rewritten, even when they mention the moved plan. v2.36.78/v2.36.80 rewrote six sealed eval
#     assets and reddened every qualification seal check (restored 2026-09-23). A normal doc in the
#     same repo must still be rewritten, so this cannot pass by the rewrite being off entirely. ---
d="$(fixture_repo rewrite-skips-frozen)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
mkdir -p "$d/evals" "$d/references"
printf 'Frozen rubric. Source plan: docs/plans/2026-01-01-widget.md\n' > "$d/evals/x-rubric.md"
sha="$(sha256sum "$d/evals/x-rubric.md" | cut -d' ' -f1)"
printf '{\n  "spec_path": "evals/x-rubric.md",\n  "spec_sha256": "%s",\n  "note": "see docs/plans/2026-01-01-widget.md"\n}\n' "$sha" > "$d/evals/x-rubric.seal.json"
printf 'Contract: docs/plans/2026-01-01-widget.md\n' > "$d/references/contract.md"
# graduation trigger (same as the Hardening B case): a released CHANGELOG section names the plan
printf '# Changelog\n\n## v1.2.3 — ships widget\n\n- landed. See docs/plans/2026-01-01-widget.md.\n' > "$d/CHANGELOG.md"
cp "$d/evals/x-rubric.md" "$TEST_TMP/frozen-rubric.before"
cp "$d/evals/x-rubric.seal.json" "$TEST_TMP/frozen-seal.before"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_contains "$(cat "$d/references/contract.md")" \
  "docs/plans/_archive/2026/01/2026-01-01-widget.md" \
  "control: an ordinary doc in the same repo IS rewritten"
if cmp -s "$d/evals/x-rubric.md" "$TEST_TMP/frozen-rubric.before"; then r=same; else r=changed; fi
assert_eq "$r" "same" "a sealed spec_path file is byte-identical after --fix"
if cmp -s "$d/evals/x-rubric.seal.json" "$TEST_TMP/frozen-seal.before"; then r=same; else r=changed; fi
assert_eq "$r" "same" "the *.seal.json itself is byte-identical after --fix"

# --- 🟡 fix (delta review): --fix must ALSO rewrite docs/plans/evidence/<stem> references,
#     not just docs/plans/<stem> ones — planPathPrefixRegExp alone never matches the
#     evidence shape, so a link INTO a moved evidence dir used to go stale. ---
d="$(fixture_repo rewrite-evidence-references)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget" "$d/skills/some-skill"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/README.md"
cat > "$d/skills/some-skill/SKILL.md" <<'MD'
# Some Skill

Evidence: [the widget evidence](../../docs/plans/evidence/2026-01-01-widget/README.md).
MD
cat > "$d/CHANGELOG.md" <<'MD'
# Changelog

## v1.2.3 — ships widget

- landed the thing.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --fix --json >/dev/null
assert_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "docs/plans/_archive/2026/01/evidence/2026-01-01-widget/README.md" \
  "RED: a doc linking docs/plans/evidence/<stem>/... is rewritten to the dated _archive/evidence/ path"
assert_not_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "](../../docs/plans/evidence/2026-01-01-widget/README.md)" \
  "the stale (pre-move) evidence link no longer appears"
assert_file_exists "$d/docs/plans/_archive/2026/01/evidence/2026-01-01-widget/README.md" \
  "the evidence dir itself moved to the dated _archive/evidence/"

# --- Hardening B: plan_reference_dangling (report-only) — a tracked file references a
#     bare docs/plans/<stem> path that exists in neither active nor archived location ---
d="$(fixture_repo dangling-reference)"
mkdir -p "$d/skills/some-skill"
cat > "$d/skills/some-skill/SKILL.md" <<'MD'
# Some Skill

See docs/plans/2026-01-01-vanished.md — it never landed on disk here.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_reference_dangling)" "1" \
  "a reference to a nonexistent plan stem is plan_reference_dangling"
assert_eq "$(json_exit "$out")" "0" "plan_reference_dangling alone does not block (report-only)"

# ...but a reference to a plan that DOES exist (active or archived) is not dangling.
d="$(fixture_repo not-dangling-reference)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
mkdir -p "$d/skills/some-skill"
printf 'See docs/plans/2026-01-01-widget.md.\n' > "$d/skills/some-skill/SKILL.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_reference_dangling)" "0" \
  "a reference to an EXISTING plan is not dangling"

# --- 🟡 fix (delta review): plan_reference_dangling must ALSO scan
#     docs/plans/evidence/<stem> references — the original digit-after-docs/plans/ pattern
#     never matched "evidence/<stem>" (the char right after docs/plans/ is not a digit). ---
d="$(fixture_repo dangling-evidence-reference)"
mkdir -p "$d/skills/some-skill"
cat > "$d/skills/some-skill/SKILL.md" <<'MD'
# Some Skill

See docs/plans/evidence/2026-01-01-vanished/README.md — no such evidence dir exists here.
MD
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_reference_dangling)" "1" \
  "RED: a reference to a nonexistent docs/plans/evidence/<stem> dir is plan_reference_dangling"
assert_contains "$out" '"path_prefix":"docs/plans/evidence/"' \
  "the violation names the evidence path prefix"
assert_eq "$(json_exit "$out")" "0" "plan_reference_dangling alone does not block, evidence shape included"

# ...but a reference to an evidence dir that DOES exist (active or archived) is not dangling.
d="$(fixture_repo not-dangling-evidence-reference)"
mkdir -p "$d/docs/plans/evidence/2026-01-01-widget" "$d/skills/some-skill"
printf 'notes\n' > "$d/docs/plans/evidence/2026-01-01-widget/README.md"
printf 'See docs/plans/evidence/2026-01-01-widget/README.md.\n' > "$d/skills/some-skill/SKILL.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_reference_dangling)" "0" \
  "a reference to an EXISTING evidence dir is not dangling"

# --- usage / exit codes ---
set +e
node "$GATE" --nonsense-flag >/dev/null 2>&1
rc=$?
set -e
assert_eq "$rc" "2" "an unknown flag exits 2 (usage)"
# set -e stays on from the toggle above for the rest of the file (matching every other gate
# suite's convention) — turn it back off here since the rest of THIS file (like the 76
# assertions above it) relies on `out="$(node ... --json)"` capturing a non-zero (blocking)
# exit without aborting the script.
set +e

# fixture_repo_with_index <name> — same as fixture_repo but also seeds a minimal
# docs/projects/INDEX.md with the registry table shape (In Progress: Date | Project |
# Version | Merge | Plan) so plan_unregistered has something to check against.
fixture_repo_with_index() {
  local d
  d="$(fixture_repo "$1")"
  cat > "$d/docs/projects/INDEX.md" <<'MD'
# Index

## 進行中 (In Progress)

| Date | Project | Version | Merge | Plan |
|------|---------|---------|-------|------|

## 已完成 (Completed)

| Date | Project | Version | Merge | Plan |
|------|---------|---------|-------|------|
MD
  echo "$d"
}

# --- plan_unregistered: blocking, requires an INDEX row with Version "active" ---

# No docs/projects/INDEX.md at all -> auto-allowed, never fires (consumer-repo case).
d="$(fixture_repo unregistered-no-index)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_unregistered)" "0" "no INDEX.md at all auto-allows plan_unregistered"
assert_eq "$(json_exit "$out")" "0" "…and does not block"

# INDEX.md exists but has no row for the plan at all -> blocks.
d="$(fixture_repo_with_index unregistered-no-row)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_unregistered)" "1" "a plan with no INDEX row at all is plan_unregistered"
assert_eq "$(json_exit "$out")" "1" "plan_unregistered blocks"
assert_contains "$out" 'paste: | 2026-01-01 |' "the violation detail carries the exact row to paste"

# A row references the plan but its Version column is a real version, not "active" ->
# still unregistered (the design requires the literal active row).
d="$(fixture_repo_with_index unregistered-wrong-version)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-01-01 | [widget](../plans/2026-01-01-widget.md) | v1.0.0 | abc | [plan](../plans/2026-01-01-widget.md) |\n"
)
open(p, "w").write(s)
PY
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_unregistered)" "1" \
  "a row whose Version isn't literally active does not count as registered"

# A row with Version "active" referencing the plan by its ../plans/<stem>.md link ->
# registered, clean.
d="$(fixture_repo_with_index registered-active)"
printf '# Plan\n' > "$d/docs/plans/2026-01-01-widget.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-01-01 | [widget](../plans/2026-01-01-widget.md) | active | — | [plan](../plans/2026-01-01-widget.md) |\n"
)
open(p, "w").write(s)
PY
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_unregistered)" "0" "a row with Version active registers the plan"
assert_eq "$(json_exit "$out")" "0" "a registered repo is clean"

# --register-template prints the exact row to paste and writes nothing.
d="$(fixture_repo_with_index register-template)"
printf '# Plan — My Great Plan\n' > "$d/docs/plans/2026-03-04-my-plan.md"
before_hash="$(sha256sum "$d/docs/projects/INDEX.md" | awk '{print $1}')"
tmpl_out="$(node "$GATE" --repo-root "$d" --register-template 2026-03-04-my-plan)"
assert_contains "$tmpl_out" "| 2026-03-04 |" "the printed row carries the stem's own date"
assert_contains "$tmpl_out" "[My Great Plan](../plans/2026-03-04-my-plan.md)" \
  "the printed row's title comes from the plan's H1"
assert_contains "$tmpl_out" "| active |" "the printed row defaults Version to active"
after_hash="$(sha256sum "$d/docs/projects/INDEX.md" | awk '{print $1}')"
assert_eq "$after_hash" "$before_hash" "--register-template never writes INDEX.md (does not invent a row)"

# --- --archive <stem> [--shipped-in <v>]: explicit archive for a verified-shipped plan
#     whose slug never made it into CHANGELOG (plan_released_not_archived can't catch it) ---

# A REGISTERED (active) plan: archiving flips its INDEX row's Version and moves it dated.
d="$(fixture_repo_with_index archive-registered)"
printf '# Plan — Archive Me\n' > "$d/docs/plans/2026-04-05-archive-me.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-04-05 | [archive-me](../plans/2026-04-05-archive-me.md) | active | — | [plan](../plans/2026-04-05-archive-me.md) |\n"
)
open(p, "w").write(s)
PY
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --archive 2026-04-05-archive-me --shipped-in v9.9.9 >/dev/null
assert_file_absent "$d/docs/plans/2026-04-05-archive-me.md" "archived plan leaves docs/plans/"
assert_file_exists "$d/docs/plans/_archive/2026/04/2026-04-05-archive-me.md" \
  "--archive uses the dated destination"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" "| v9.9.9 |" \
  "--archive flips the registered row's Version to --shipped-in"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" \
  "../plans/_archive/2026/04/2026-04-05-archive-me.md" \
  "--archive rewrites the row's own plan link to the dated path"

# An UNREGISTERED plan (no INDEX row at all): --archive appends one instead of inventing
# nothing — the whole point is "this WAS shipped, record it."
d="$(fixture_repo_with_index archive-unregistered)"
printf '# Plan — Never Registered\n' > "$d/docs/plans/2026-05-06-never-registered.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --archive 2026-05-06-never-registered >/dev/null
assert_file_exists "$d/docs/plans/_archive/2026/05/2026-05-06-never-registered.md" \
  "an unregistered plan is still archived"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" "2026-05-06-never-registered" \
  "--archive appends a row when none existed"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" "| shipped |" \
  "--archive defaults Version to literal shipped when --shipped-in is omitted"

# --archive refuses when the (dated) destination already exists — same no-clobber rule
# as --fix, all-or-nothing.
d="$(fixture_repo_with_index archive-destination-exists-explicit)"
printf '# Plan\n' > "$d/docs/plans/2026-06-07-clashing.md"
mkdir -p "$d/docs/plans/_archive/2026/06"
printf '# Plan (STALE)\n' > "$d/docs/plans/_archive/2026/06/2026-06-07-clashing.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --archive 2026-06-07-clashing --json >/tmp/archive-clash-out.$$ 2>/dev/null
rc=$?
assert_eq "$rc" "1" "--archive refuses (exit 1) when the destination already exists"
assert_contains "$(cat /tmp/archive-clash-out.$$)" "archive_destination_exists" \
  "the refusal names archive_destination_exists"
rm -f "/tmp/archive-clash-out.$$"
assert_file_exists "$d/docs/plans/2026-06-07-clashing.md" \
  "the clashing plan was NOT moved (refused before any move)"
assert_contains "$(cat "$d/docs/plans/_archive/2026/06/2026-06-07-clashing.md")" "STALE" \
  "the pre-existing dated destination is untouched"

# --- dated archive layout: --fix also reads/writes it, and legacy-flat archives still
#     satisfy existence checks (no false archive_destination_exists against a legacy path
#     that isn't the actual move target) ---
d="$(fixture_repo_with_index legacy-archive-satisfies-backlog-check)"
mkdir -p "$d/docs/plans/_archive"
printf '# Plan\n' > "$d/docs/plans/_archive/2026-07-08-legacy.md"
backlog_row "$d/docs/BACKLOG.md" "Legacy row" "open" "docs/plans/_archive/2026-07-08-legacy.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" backlog_row_has_plan)" "1" \
  "a legacy FLAT archived plan (pre-dated-layout) still satisfies backlog_row_has_plan"

# --- --migrate-archive-layout: moves every legacy-flat archived plan (+sidecar+evidence)
#     into the dated layout, and every dated docs/projects/_archive/<date>-<name>/ project
#     dir, rewriting references (both the docs/projects/_archive/<name> and INDEX.md's own
#     bare _archive/<name> link shapes) as it goes — never touches CHANGELOG/BACKLOG. ---
d="$(fixture_repo_with_index migrate-layout)"
mkdir -p "$d/docs/plans/_archive/evidence/2026-08-09-legacy" "$d/docs/projects/_archive/2026-08-09-legacy-proj" "$d/skills/some-skill"
printf '# Plan\n' > "$d/docs/plans/_archive/2026-08-09-legacy.md"
printf 'notes\n' > "$d/docs/plans/_archive/evidence/2026-08-09-legacy/notes.md"
printf '# README\n' > "$d/docs/projects/_archive/2026-08-09-legacy-proj/README.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-08-09 | [legacy-proj](_archive/2026-08-09-legacy-proj/README.md) | v1.0.0 | abc | [plan](../plans/_archive/2026-08-09-legacy.md) |\n"
)
# 🟡 index-rewrite-single-row (migrate case): a SECOND row also links the same
# already-archived (legacy-flat) plan — e.g. a follow-up fix row citing it. Both rows'
# stale legacy-flat path must be rewritten by --migrate-archive-layout, not just one.
s = s.replace(
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-08-10 | a follow-up also citing the plan | active | — | [plan](../plans/_archive/2026-08-09-legacy.md) |\n"
)
open(p, "w").write(s)
PY
printf 'See docs/plans/_archive/2026-08-09-legacy.md and docs/plans/_archive/evidence/2026-08-09-legacy/notes.md.\n' \
  > "$d/skills/some-skill/SKILL.md"
printf '## v1.0.0\n\n- mentions docs/plans/_archive/2026-08-09-legacy.md (history, must NOT be rewritten)\n' >> "$d/CHANGELOG.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --migrate-archive-layout --json)"
assert_file_absent "$d/docs/plans/_archive/2026-08-09-legacy.md" "legacy flat plan file is moved"
assert_file_exists "$d/docs/plans/_archive/2026/08/2026-08-09-legacy.md" "…into the dated layout"
assert_file_exists "$d/docs/plans/_archive/2026/08/evidence/2026-08-09-legacy/notes.md" \
  "…and its evidence dir too"
assert_file_absent "$d/docs/projects/_archive/2026-08-09-legacy-proj" "legacy flat project dir is moved"
assert_file_exists "$d/docs/projects/_archive/2026/08/2026-08-09-legacy-proj/README.md" \
  "…into the dated layout"
assert_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "docs/plans/_archive/2026/08/2026-08-09-legacy.md" "a skill doc's legacy link is rewritten to dated"
assert_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "docs/plans/_archive/2026/08/evidence/2026-08-09-legacy/notes.md" \
  "…and its evidence-path legacy link too"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" \
  "_archive/2026/08/2026-08-09-legacy-proj/README.md" \
  "INDEX.md's own bare _archive/<name> project link is rewritten"
assert_contains "$(cat "$d/docs/projects/INDEX.md")" \
  "../plans/_archive/2026/08/2026-08-09-legacy.md" \
  "INDEX.md's own plan link is rewritten too"
# 🟡 index-rewrite-single-row: the SECOND INDEX row that also links this plan (the
# 進行中 follow-up row) must have its path rewritten too, not just the first-matched row.
assert_eq "$(grep -c '\.\./plans/_archive/2026-08-09-legacy\.md' "$d/docs/projects/INDEX.md")" "0" \
  "no INDEX row still links the stale legacy-flat path — every matched row was rewritten"
assert_eq "$(grep -c '\.\./plans/_archive/2026/08/2026-08-09-legacy\.md' "$d/docs/projects/INDEX.md")" "2" \
  "both the 已完成 row and the 進行中 follow-up row now point at the dated path"
assert_contains "$(cat "$d/CHANGELOG.md")" "docs/plans/_archive/2026-08-09-legacy.md" \
  "CHANGELOG.md is NOT rewritten (history, same exclusion as --fix)"
assert_contains "$out" '"plansMoved"' "the migrate payload reports what moved"

# --migrate-archive-layout refuses (all-or-nothing) when a dated destination already exists.
d="$(fixture_repo_with_index migrate-layout-clash)"
mkdir -p "$d/docs/plans/_archive/2026/09" "$d/docs/plans/_archive"
printf '# Plan (dated, pre-existing)\n' > "$d/docs/plans/_archive/2026/09/2026-09-10-clash.md"
printf '# Plan (legacy flat)\n' > "$d/docs/plans/_archive/2026-09-10-clash.md"
out="$(node "$GATE" --repo-root "$d" --migrate-archive-layout --json)"
assert_contains "$out" '"archive_destination_exists"' "migrate reports the clash by name"
assert_file_exists "$d/docs/plans/_archive/2026-09-10-clash.md" \
  "the legacy flat file is left in place (all-or-nothing, nothing partially moved)"

# --- 🟠 index-row-match-any-cell: planIndexRegistration must match the stem against the
#     Plan-column cell only, not the whole raw row — otherwise plan Y merely MENTIONED in
#     plan X's Project-cell prose counts Y as registered via X's row, and archiving Y would
#     then rewrite/flip X's row instead of leaving it alone. ---
d="$(fixture_repo_with_index index-row-match-any-cell)"
printf '# Plan — X\n' > "$d/docs/plans/2026-01-01-planx.md"
printf '# Plan — Y\n' > "$d/docs/plans/2026-02-02-plany.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-01-01 | X — see also ../plans/2026-02-02-plany.md for context | active | — | [plan](../plans/2026-01-01-planx.md) |\n"
)
open(p, "w").write(s)
PY
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_unregistered)" "1" \
  "Y is plan_unregistered despite being MENTIONED in X's Project-cell prose"
assert_contains "$out" '"stem":"2026-02-02-plany"' "the violation names Y, not X"
# Archiving Y must leave X's row completely untouched.
before_x_row="$(grep 'planx' "$d/docs/projects/INDEX.md")"
node "$GATE" --repo-root "$d" --archive 2026-02-02-plany --shipped-in v1.0.0 >/dev/null
after_x_row="$(grep 'planx' "$d/docs/projects/INDEX.md")"
assert_eq "$after_x_row" "$before_x_row" \
  "archiving Y does not rewrite or flip X's row (X's row never matched Y's stem)"

# --- 🟠 malformed-date-stem-misfiled ---

# A stem with an out-of-range month/day (month 13, day 99) is plan_stem_malformed, blocking.
d="$(fixture_repo_with_index malformed-month-day)"
printf '# Plan\n' > "$d/docs/plans/2026-13-99-bogus.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_stem_malformed)" "1" "month 13 / day 99 is plan_stem_malformed"
assert_eq "$(json_exit "$out")" "1" "plan_stem_malformed blocks"

# An undated stem is ALSO plan_stem_malformed (same code, same refusal).
d="$(fixture_repo_with_index undated-stem)"
printf '# Plan\n' > "$d/docs/plans/not-a-date-slug.md"
out="$(node "$GATE" --repo-root "$d" --json)"
assert_eq "$(json_count "$out" plan_stem_malformed)" "1" "an undated stem is also plan_stem_malformed"

# --archive on a malformed/undated stem refuses with stem_date_malformed, exit 2 — it must
# NOT silently misfile into the legacy flat archive.
d="$(fixture_repo_with_index archive-malformed-stem)"
printf '# Plan\n' > "$d/docs/plans/2026-13-99-bogus.md"
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --archive 2026-13-99-bogus --json >/tmp/archive-malformed-out.$$ 2>/dev/null
rc=$?
assert_eq "$rc" "2" "--archive on a malformed stem refuses (exit 2)"
assert_contains "$(cat /tmp/archive-malformed-out.$$)" "stem_date_malformed" \
  "the refusal names stem_date_malformed"
rm -f "/tmp/archive-malformed-out.$$"
assert_file_exists "$d/docs/plans/2026-13-99-bogus.md" "the malformed-stem plan was NOT moved at all"
assert_file_absent "$d/docs/plans/_archive/2026-13-99-bogus.md" \
  "…and specifically did NOT get misfiled into the legacy flat archive"

# planFileMoveSet itself (the move-set builder --fix and --archive both share) refuses to
# invent a legacy-flat destination for a malformed/undated stem — direct unit check.
move_set_check="$(node -e "
const gate = require('$GATE');
const moves = gate.planFileMoveSet('/nonexistent', '/nonexistent/docs/plans', '/nonexistent/docs/plans/_archive', '2026-13-99-bogus');
process.stdout.write(String(moves.length));
")"
assert_eq "$move_set_check" "0" "planFileMoveSet returns no moves for a malformed stem (no flat fallback)"

# --- 🟡 index-rewrite-single-row: two INDEX rows link the same plan; archiving must rewrite
#     the path in BOTH rows, flipping Version only on the active one. ---
d="$(fixture_repo_with_index index-rewrite-single-row)"
printf '# Plan — Two Rows\n' > "$d/docs/plans/2026-03-04-tworows.md"
python3 - "$d/docs/projects/INDEX.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace(
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 進行中 (In Progress)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-03-04 | tworows | active | — | [plan](../plans/2026-03-04-tworows.md) |\n"
)
s = s.replace(
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n",
  "## 已完成 (Completed)\n\n| Date | Project | Version | Merge | Plan |\n|------|---------|---------|-------|------|\n"
  "| 2026-03-05 | a follow-up fix that also references [plan](../plans/2026-03-04-tworows.md) | v0.0.1 | abc | [plan](../plans/2026-03-04-tworows.md) |\n"
)
open(p, "w").write(s)
PY
git -C "$d" add -A >/dev/null
git -C "$d" -c user.email=t@t -c user.name=t commit -q -m init >/dev/null
node "$GATE" --repo-root "$d" --archive 2026-03-04-tworows --shipped-in v2.0.0 >/dev/null
index_after="$(cat "$d/docs/projects/INDEX.md")"
assert_contains "$index_after" "../plans/_archive/2026/03/2026-03-04-tworows.md" \
  "the active row's path is rewritten"
assert_eq "$(printf '%s' "$index_after" | grep -c '\.\./plans/2026-03-04-tworows\.md')" "0" \
  "no row still links the stale pre-archive path — both matched rows were rewritten"
assert_contains "$index_after" "| v2.0.0 |" "the ACTIVE row's Version flips to --shipped-in"
assert_contains "$index_after" "| v0.0.1 |" "the OTHER (already-versioned) row's Version is untouched"

finalize_test
