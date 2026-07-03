#!/usr/bin/env bash
# check-canonical-invariants.sh — guard cross-file invariants that the byte-for-byte
# mirror checks (sync-version.js --check, sync-agent-bodies.sh --check) CANNOT see,
# because the files involved are intentionally NOT byte-equal.
#
# Two modes, both seeded from an INLINE table below (no separate data file — with a
# handful of seeds a TSV would be an orphan with no CLAUDE.md home; ponytail's own
# check-rule-copies.js inlines its table for the same reason):
#
#   repeat    — a pinned VERBATIM phrase must co-exist in EVERY listed file. Use when
#               two or more files independently RESTATE the same rule (e.g. the unified
#               severity vocabulary). Deleting the phrase from any one file → exit 1
#               naming that file + the phrase.
#
#   reference — file A REFERENCES a section in file B (A does not repeat B's body). Assert
#               (1) A still contains the exact cross-ref anchor string, AND (2) the
#               referenced heading still exists in B. Catches the STRUCTURAL break — anchor
#               renamed/deleted, or heading renamed/deleted — in the correct direction.
#               KNOWN LIMIT: it does NOT catch a body-reword of B's section while the
#               heading stays put. That residual is a human-review concern, not a silent
#               over-claim (see the plan's KR2 scope note).
#
# ── SAME-COMMIT UPDATE RITUAL (read before you reword a guarded rule) ──────────────
#   Any edit to a rule-text that this script pins MUST update the inline seed in the
#   SAME commit. Otherwise the gate is noise: a legitimate reword trips exit 1, the
#   author bypasses the hook "just this once", and the gate is dead. The negative test
#   for a reword is "reword + update the seed in one commit → exit 0". If you find
#   yourself wanting to bypass this hook, update the seed instead.
#
# USAGE:  scripts/check-canonical-invariants.sh
# OUTPUT: one line per checked invariant; ERROR lines for failures.
# EXIT:   0 = all invariants hold
#         1 = at least one invariant broken (each printed with the file + phrase)
#         2 = usage / environment error (e.g. a seeded file path does not exist)

set -uo pipefail

case "${1:-}" in
  --help|-h)
    sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

FAILS=0
ENV_ERR=0

ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1" >&2; FAILS=$((FAILS + 1)); }
envx() { echo "  ! $1" >&2; ENV_ERR=1; }

# ── repeat-mode invariant ──────────────────────────────────────────────────────────
# A pinned verbatim phrase that must appear in every listed file. fgrep (-F) so glyphs
# and slashes are matched literally, never as a regex.
check_repeat() {
  local label="$1"; local phrase="$2"; shift 2
  local file missing=0
  for file in "$@"; do
    if [ ! -f "$file" ]; then
      envx "repeat[$label]: seeded file does not exist: $file"
      missing=1
      continue
    fi
    if ! grep -Fq -- "$phrase" "$file"; then
      bad "repeat[$label]: missing verbatim phrase in $file"
      echo "      phrase: $phrase" >&2
      missing=1
    fi
  done
  [ "$missing" = "0" ] && ok "repeat[$label]: present in all ${#} files"
}

# ── reference-mode invariant ───────────────────────────────────────────────────────
# referencing_file must contain anchor_in_referrer; canonical_file must contain
# heading_in_canonical. Both are fixed-string matches.
check_reference() {
  local label="$1"
  local referencing_file="$2" anchor_in_referrer="$3"
  local canonical_file="$4" heading_in_canonical="$5"
  local broke=0

  if [ ! -f "$referencing_file" ]; then
    envx "reference[$label]: referencing file does not exist: $referencing_file"; return
  fi
  if [ ! -f "$canonical_file" ]; then
    envx "reference[$label]: canonical file does not exist: $canonical_file"; return
  fi

  if ! grep -Fq -- "$anchor_in_referrer" "$referencing_file"; then
    bad "reference[$label]: $referencing_file lost the cross-ref anchor"
    echo "      anchor: $anchor_in_referrer" >&2
    broke=1
  fi
  if ! grep -Fxq -- "$heading_in_canonical" "$canonical_file"; then
    bad "reference[$label]: $canonical_file lost the referenced heading (structural rename/deletion)"
    echo "      heading: $heading_in_canonical" >&2
    broke=1
  fi
  [ "$broke" = "0" ] && ok "reference[$label]: anchor + heading both intact"
}

echo "check-canonical-invariants — cross-file invariant gate"
echo ""

# ════════════════════════════════════════════════════════════════════════════════════
# INLINE SEED TABLE — keep in lockstep with the guarded rule text (same-commit ritual).
# ════════════════════════════════════════════════════════════════════════════════════

# repeat #1 — unified severity vocabulary line. Every file that independently restates
# the 4-tier vocabulary must carry it verbatim. If you change the vocabulary, change it
# here AND in every listed file in the same commit.
check_repeat "severity-vocab" \
  "🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion" \
  "CLAUDE.md" \
  "agents/reviewer.md" \
  "references/blind-dispatch.md" \
  "skills/quality-pipeline/_base/prohibited-behaviors.md" \
  "skills/quality-pipeline/references/code-review.md"

# repeat #2 — the /l4 /l5 width-fan-out disjointness carve-out. This single sentence is
# LOAD-BEARING: it states the gate certifies FILES ONLY (not behavior), so the green
# disjointness stamp must never shrink the depth-0 qc. If either doc drops/rewords it the
# safety invariant silently erodes. Reword ritual: change the sentence here AND in both
# files in one commit.
check_repeat "disjointness-carve-out" \
  "The disjointness gate certifies files only, not behavior." \
  "references/blind-dispatch.md" \
  "skills/ceo-agent/references/level-front-door.md"

# reference #1 — reviewer.md REFERENCES code-review.md's Invocation section (it does not
# repeat the body). Assert reviewer.md still names the canonical anchor AND the heading
# still exists in code-review.md. Catches a structural rename/deletion of "## Invocation".
check_reference "reviewer→code-review/Invocation" \
  "agents/reviewer.md"                               "code-review.md) Invocation §" \
  "skills/quality-pipeline/references/code-review.md" "## Invocation"

# repeat #3 — S-scope-gate block invariants. Seed the TaskCreate title line, the three
# indicator lines, and the "Mark this task ONLY when" line across dev-flow and ceo-agent.
check_repeat "s-scope-gate-title" \
  'TaskCreate: "S-scope-gate: Evaluate scope before every commit"' \
  "skills/dev-flow/SKILL.md" \
  "skills/ceo-agent/SKILL.md"

check_repeat "s-scope-gate-ind1" \
  '    (1) Fewer than 3 commits on this task so far?' \
  "skills/dev-flow/SKILL.md" \
  "skills/ceo-agent/SKILL.md"

check_repeat "s-scope-gate-ind2" \
  '    (2) Fewer than 3 different modules touched?' \
  "skills/dev-flow/SKILL.md" \
  "skills/ceo-agent/SKILL.md"

check_repeat "s-scope-gate-ind3" \
  '    (3) No features added beyond original goal?' \
  "skills/dev-flow/SKILL.md" \
  "skills/ceo-agent/SKILL.md"

check_repeat "s-scope-gate-mark" \
  '  Mark this task ONLY when: work is complete AND scope stayed S throughout (all YES),' \
  "skills/dev-flow/SKILL.md" \
  "skills/ceo-agent/SKILL.md"

# reference #2 — ceo-agent references dev-flow's canonical Scope Completeness Audit heading.
check_reference "ceo-agent→dev-flow/ScopeCompletenessAudit" \
  "skills/ceo-agent/SKILL.md" "**Scope Completeness Audit**" \
  "skills/dev-flow/SKILL.md" "#### Scope Completeness Audit (MANDATORY before phase TaskCreate)"

echo ""
if [ "$ENV_ERR" = "1" ]; then
  echo "❌ environment error — a seeded path is wrong (fix the seed table)" >&2
  exit 2
fi
if [ "$FAILS" -eq 0 ]; then
  echo "✅ all canonical invariants hold"
  exit 0
else
  echo "❌ $FAILS canonical invariant(s) broken" >&2
  exit 1
fi
