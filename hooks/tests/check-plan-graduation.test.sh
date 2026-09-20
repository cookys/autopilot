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
assert_file_exists "$d/docs/plans/_archive/evidence/2026-01-01-widget/README.md" \
  "the evidence dir still moves to _archive/"
bgate_out="$(node "$REPO_ROOT/scripts/check-backlog-entries.js" --backlog "$d/docs/BACKLOG.md" --json)"
assert_not_contains "$bgate_out" '"pointer_unresolved"' \
  "no row survives to report pointer_unresolved"

# --- 🟠 fix: gitMv fallback must never clobber an existing destination; a stem's move is
#     all-or-nothing (a pre-existing _archive/<stem>.md stops the WHOLE stem's move, not
#     just that one file) ---
d="$(fixture_repo archive-destination-exists)"
printf '# Plan (current)\n' > "$d/docs/plans/2026-01-01-widget.md"
printf '# Rubric\n' > "$d/docs/plans/2026-01-01-widget.rubric.md"
mkdir -p "$d/docs/plans/_archive"
printf '# Plan (STALE, pre-existing)\n' > "$d/docs/plans/_archive/2026-01-01-widget.md"
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
assert_contains "$(cat "$d/docs/plans/_archive/2026-01-01-widget.md")" "STALE, pre-existing" \
  "the pre-existing archive destination is untouched (not clobbered)"
assert_file_exists "$d/docs/plans/2026-01-01-widget.md" \
  "the plan itself was NOT moved (all-or-nothing: the clash blocks the whole stem)"
assert_file_exists "$d/docs/plans/2026-01-01-widget.rubric.md" \
  "the sidecar was NOT moved either (all-or-nothing, not just the clashing file)"
assert_file_absent "$d/docs/plans/_archive/2026-01-01-widget.rubric.md" \
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
  "docs/plans/_archive/2026-01-01-widget.md" \
  "a skill doc's link to the plan is rewritten to the _archive/ path"
assert_contains "$(cat "$d/references/contract.md")" \
  "docs/plans/_archive/2026-01-01-widget.md" \
  "a reference doc's mention is also rewritten"
assert_contains "$(cat "$d/CHANGELOG.md")" \
  "docs/plans/2026-01-01-widget.md" \
  "CHANGELOG.md is NOT rewritten (history)"
assert_contains "$(cat "$d/docs/BACKLOG.md")" \
  "docs/plans/2026-01-01-widget.md for history" \
  "docs/BACKLOG.md is NOT rewritten (history)"
assert_contains "$out" '"references_rewritten"' "the fix payload reports which files were rewritten"

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
  "docs/plans/_archive/evidence/2026-01-01-widget/README.md" \
  "RED: a doc linking docs/plans/evidence/<stem>/... is rewritten to the _archive/evidence/ path"
assert_not_contains "$(cat "$d/skills/some-skill/SKILL.md")" \
  "](../../docs/plans/evidence/2026-01-01-widget/README.md)" \
  "the stale (pre-move) evidence link no longer appears"
assert_file_exists "$d/docs/plans/_archive/evidence/2026-01-01-widget/README.md" \
  "the evidence dir itself moved to _archive/evidence/"

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

finalize_test
