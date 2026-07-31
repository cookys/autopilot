#!/usr/bin/env bash
# preflight-release.sh — release-hygiene gate. Run before tagging / announcing a
# release (and ideally in finish-flow) to catch the doc-drift class of problem
# that bit v2.7.3: a canonical version bump with no matching CHANGELOG entry,
# stale mirrors, or an INDEX row pointing at a missing project README.
#
# Distinct from preflight-portability.sh (which checks runtime/cross-agent
# behavior). This one checks that the RELEASE DOCS are self-consistent with the
# canonical version in .claude-plugin/plugin.json.
#
# Exits 0 if all checks pass; otherwise prints one ✗ per failure and exits with
# the failure count.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

ONLY_SLASH_PROBE=0

case "${1:-}" in
  ""|--update-baseline) ;;
  --only-slash-probe)
    ONLY_SLASH_PROBE=1
    ;;
  --help|-h)
    echo "usage: $0 [--update-baseline]"
    echo "  (no args)          run the full release-hygiene gate — NOTE: check 7 runs 5 real"
    echo "                     LLM slash-entry probes; skip with AUTOPILOT_SKIP_SLASH_PROBE=1"
    echo "  --only-slash-probe  run only the slash-entry probe gate (plus skip knob)"
    echo "  --update-baseline  recompute + write docs/metrics/surface-lines.json, then exit"
    exit 0
    ;;
  *)
    echo "unknown argument: $1 (see --help)" >&2
    exit 2
    ;;
esac

if [ "${1:-}" = "--update-baseline" ]; then
  V=$(grep -oE '"version":[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' .claude-plugin/plugin.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  P=$(find skills references -name '*.md' -type f | sort -u | xargs cat | wc -l)
  E=$(find src -name '*.js' -type f | sort -u | xargs cat | wc -l)
  mkdir -p docs/metrics
  printf '{\n  "version": "%s",\n  "prose": %s,\n  "engine": %s,\n  "note": "north-star baseline (prose down, engine up) — refreshed at each release via preflight-release.sh --update-baseline; formula: find skills references -name *.md -type f | sort -u | xargs cat | wc -l (R1-F6 dedup, symlinks excluded by -type f)"\n}\n' "$V" "$P" "$E" > docs/metrics/surface-lines.json
  echo "baseline updated: v$V prose=$P engine=$E → docs/metrics/surface-lines.json"
  exit 0
fi

CANONICAL=".claude-plugin/plugin.json"
CHANGELOG="CHANGELOG.md"
INDEX="docs/projects/INDEX.md"

FAILS=0
TOTAL=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILS=$((FAILS + 1)); }

run_check() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  echo "[$TOTAL] $name"
  if "$@"; then pass "$name"; else fail "$name"; fi
}

# Resolve canonical version up-front (used by several checks).
VERSION=""
if [ -f "$CANONICAL" ]; then
  VERSION=$(grep -oE '"version":[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$CANONICAL" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
fi

# ─── 1. canonical version parseable ───
check_canonical_version() {
  [ -n "$VERSION" ] || { echo "    (could not parse version from $CANONICAL)" >&2; return 1; }
  echo "    canonical version: $VERSION"
}

# ─── 2. CHANGELOG has an entry for the canonical version ───
check_changelog_entry() {
  [ -n "$VERSION" ] || return 1
  # Match a heading like "## v2.7.3 — ..." (allow trailing text)
  grep -qE "^##[[:space:]]+v${VERSION//./\\.}( |\$|[^0-9])" "$CHANGELOG"
}

# ─── 3. version mirrors in sync with canonical ───
check_version_mirrors() {
  node scripts/sync-version.js --check >/dev/null 2>&1
}

# ─── 4. INDEX references the canonical version ───
check_index_has_version() {
  [ -f "$INDEX" ] || return 1
  grep -qE "v${VERSION//./\\.}( |\||\$|[^0-9])" "$INDEX"
}

# ─── 5. every project README linked from INDEX exists ───
# Catches the "INDEX row points at a missing/renamed project README" drift.
check_index_links_resolve() {
  [ -f "$INDEX" ] || return 1
  local missing=0
  # Extract markdown link targets that look like project README paths.
  while IFS= read -r target; do
    # Strip anchor (#...)
    local clean="${target%%#*}"
    [ -z "$clean" ] && continue
    # Resolve relative to INDEX's own directory (docs/projects/) so that both
    # bare `<name>/README.md` and `../<name>/README.md` forms work. Using
    # realpath-style resolution instead of excluding `../` links (which would
    # silently skip — and thus pass — a genuinely broken parent-relative link).
    local resolved
    resolved="$(cd "docs/projects" 2>/dev/null && readlink -m "$clean")"
    if [ -z "$resolved" ] || [ ! -e "$resolved" ]; then
      echo "    missing: $clean (from INDEX link $target)" >&2
      missing=$((missing + 1))
    fi
  done < <(grep -oE '\]\([^)]*README\.md[^)]*\)' "$INDEX" | sed -E 's/^\]\(//; s/\)$//' | grep -vE '^https?://')
  [ "$missing" -eq 0 ]
}

# ─── 6. opt-in CHANGELOG gate: set change ⇒ named in section ───
check_optin_changelog() {
  node scripts/check-optin-changelog.js
}

# ─── 7. slash-entry thin-shell behavioral probe (B1/B2 release gate) ───
# 5 real LLM probes (l3/l4/l5/l6/think-tank-dialectic): each entry must Read its
# MUST-READ reference(s) — evidence is stream-json tool_use artifacts, never
# self-report. Release-time only by design (LLM cost — plan 2026-07-04
# surface-area-reduction B1). Skip knob: AUTOPILOT_SKIP_SLASH_PROBE=1 (loud).
check_slash_entry_probe() {
  if [ "${AUTOPILOT_SKIP_SLASH_PROBE:-0}" = "1" ]; then
    echo "    SKIPPED by AUTOPILOT_SKIP_SLASH_PROBE=1 (thin-shell wiring NOT verified this release)"
    return 0
  fi

  local probe_model="${SLASH_PROBE_MODEL:-claude-sonnet-5}"
  local probe_status
  local probe_state

  probe_state="$(node scripts/engine-capability-state.js current --runner claude --model "$probe_model" --role probe)"
  probe_status="$(printf '%s' "$probe_state" | node -e 'const fs = require("fs"); const payload = fs.readFileSync(0, "utf8").trim(); if (!payload) process.exit(0); try { const data = JSON.parse(payload); process.stdout.write((data && data.capability && data.capability.quota && data.capability.quota.status) || ""); } catch { process.exit(0); }')"

  if [ "$probe_status" = "exhausted" ]; then
    echo "    UNAVAILABLE: slash probe model '$probe_model' has exhausted quota; refusing to run."
    return 1
  fi

  AUTOPILOT_SLASH_PROBE=1 bash hooks/tests/slash-entry-probe.test.sh
}

# ─── 8. north-star surface measurement (prose↓ engine↑) ───
# Plan 2026-07-04 surface-area-reduction §4 (R1-F6: -type f dedup formula + a real
# threshold, else theater). Prints prose/engine line counts + delta vs the tracked
# baseline (docs/metrics/surface-lines.json). SOFT-HARD gate: prose +5% over baseline
# is allowed ONLY with a CHANGELOG justification line ("prose-justification:") in the
# current version's section — missing justification fails this release check.
# Seed/refresh baseline: scripts/preflight-release.sh --update-baseline (run at each
# release AFTER the gate passes, so the next release diffs against this one).
SURFACE_BASELINE="docs/metrics/surface-lines.json"

measure_surface() {
  SURF_PROSE=$(find skills references -name '*.md' -type f | sort -u | xargs cat | wc -l)
  SURF_ENGINE=$(find src -name '*.js' -type f | sort -u | xargs cat | wc -l)
}

changelog_version_section() {
  local changelog="$1"
  local version="$2"
  awk -v target="$version" '
    /^##[[:space:]]+v/ {
      if (inside) exit
      heading = $0
      sub(/^##[[:space:]]+v/, "", heading)
      sub(/[[:space:]].*$/, "", heading)
      if (heading == target) {
        inside = 1
        found = 1
      }
      next
    }
    inside { print }
    END { if (!found) exit 1 }
  ' "$changelog"
}

current_changelog_has_justification() {
  local changelog="$1"
  local version="$2"
  local section=""
  if ! section="$(changelog_version_section "$changelog" "$version")"; then
    return 1
  fi
  grep -qE "prose-justification:" <<<"$section"
}

check_north_star() {
  measure_surface
  if [ ! -f "$SURFACE_BASELINE" ]; then
    echo "    prose=$SURF_PROSE engine=$SURF_ENGINE (no baseline yet — seed with: scripts/preflight-release.sh --update-baseline)"
    return 0
  fi
  local base_prose base_engine base_version
  # process.stdout.write(String(..)) — console.log colorizes numbers under
  # FORCE_COLOR (ANSI codes break the -gt test → false "baseline unparseable")
  base_prose=$(node -e "process.stdout.write(String(require('./$SURFACE_BASELINE').prose))" 2>/dev/null)
  base_engine=$(node -e "process.stdout.write(String(require('./$SURFACE_BASELINE').engine))" 2>/dev/null)
  base_version=$(node -e "process.stdout.write(String(require('./$SURFACE_BASELINE').version))" 2>/dev/null)
  if ! [ "$base_prose" -gt 0 ] 2>/dev/null; then
    echo "    baseline unparseable ($SURFACE_BASELINE) — re-seed with --update-baseline" >&2
    return 1
  fi
  local d_prose=$((SURF_PROSE - base_prose)) d_engine=$((SURF_ENGINE - base_engine))
  local pct=$(( d_prose * 100 / base_prose ))
  echo "    prose=$SURF_PROSE engine=$SURF_ENGINE (baseline v$base_version: prose=$base_prose engine=$base_engine; Δprose=$d_prose (${pct}%), Δengine=$d_engine)"
  local limit=$(( base_prose * 105 / 100 ))
  if [ "$SURF_PROSE" -gt "$limit" ]; then
    if current_changelog_has_justification "$CHANGELOG" "$VERSION"; then
      echo "    WARNING: prose grew >+5% vs baseline — current-version CHANGELOG justification found, allowed"
      return 0
    fi
    echo "    prose grew >+5% vs baseline ($base_prose → $SURF_PROSE) with NO 'prose-justification:' line in the v$VERSION section of $CHANGELOG" >&2
    echo "    north star is prose↓ engine↑ — justify the growth in the CHANGELOG or reduce it" >&2
    return 1
  fi
  return 0
}

if [ "$ONLY_SLASH_PROBE" = "1" ]; then
  if check_slash_entry_probe; then
    exit 0
  else
    exit 1
  fi
fi

echo "preflight-release — autopilot release-hygiene gate"
echo ""

run_check "canonical version parseable from .claude-plugin/plugin.json" check_canonical_version
run_check "CHANGELOG.md has a '## v$VERSION' entry" check_changelog_entry
run_check "version mirrors in sync (sync-version.js --check)" check_version_mirrors
run_check "docs/projects/INDEX.md references v$VERSION" check_index_has_version
run_check "all project README links in INDEX resolve to existing files" check_index_links_resolve
run_check "opt-in change is named in the CHANGELOG" check_optin_changelog
run_check "slash-entry thin-shell probe (5 entries, LLM; skip: AUTOPILOT_SKIP_SLASH_PROBE=1)" check_slash_entry_probe
run_check "north-star surface lines (prose↓ engine↑; +5% needs CHANGELOG justification)" check_north_star

# ─── advisory: roster-field report ───────────────────────────────────────────
# NOT a check and NOT counted in $FAILS — it prints the roster's
# no-detected-modeled-match bucket so the owner sees it at release prep. Its exit
# code is deliberately ignored: this is the presentation step the plan requires
# (docs/plans/2026-07-25-roster-field-report.md §4.1 step 4). If it cannot run it
# says REPORT-HEALTH on stderr; that is a broken tool, not a release blocker.
echo ""
echo "── advisory: roster fields with no detected modeled match ──"
node scripts/report-roster-field-consumers.js 2>&1 | sed -n '/no detected modeled match/,$p' || true

echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "✅ RELEASE DOCS CONSISTENT for v$VERSION ($TOTAL/$TOTAL)"
  exit 0
else
  echo "❌ $FAILS / $TOTAL release-hygiene checks FAILED for v$VERSION"
  echo "   Fix: ensure CHANGELOG entry + INDEX row + project README exist for the"
  echo "   canonical version, and run scripts/sync-version.js to align mirrors."
  exit "$FAILS"
fi
