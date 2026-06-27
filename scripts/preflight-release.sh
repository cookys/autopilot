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

echo "preflight-release — autopilot release-hygiene gate"
echo ""

run_check "canonical version parseable from .claude-plugin/plugin.json" check_canonical_version
run_check "CHANGELOG.md has a '## v$VERSION' entry" check_changelog_entry
run_check "version mirrors in sync (sync-version.js --check)" check_version_mirrors
run_check "docs/projects/INDEX.md references v$VERSION" check_index_has_version
run_check "all project README links in INDEX resolve to existing files" check_index_links_resolve
run_check "opt-in change is named in the CHANGELOG" check_optin_changelog

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
