#!/usr/bin/env bash
# assert-instruments.sh — Phase 0 acceptance gate for the skill-transport A/B instruments.
# Deterministic, no LLM, no spend. Asserts, and fails closed (exit 1) on any violation:
#   (1) every pack fixture body is free of output-format directives (Global Constraint #1);
#   (2) every <case>.match.json parses and has >=1 any_of group;
#   (3) each predicate's all_of literal set is DISJOINT from the reviewer-pack vocabulary
#       (oracle-leakage gate — the pack must not hand the reviewer the words the predicate
#        looks for);
#   (4) the reviewer pack body does not contain any case's sidecar-specific defect anchor
#       (predicate literals double as the sidecar-specific keyword set — §6 leakage check).
# Usage: assert-instruments.sh [--match-dir <d>] [--packs-dir <d>]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MATCH_DIR="$HERE/match"
PACKS_DIR="$HERE/packs"
while [ $# -gt 0 ]; do case "$1" in
  --match-dir) MATCH_DIR="$2"; shift 2 ;;
  --packs-dir) PACKS_DIR="$2"; shift 2 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac; done

FAIL=0
note() { printf '%s\n' "$*"; }

# Strip the HTML comment header from a pack so meta-documentation ("no output contract")
# is not mistaken for an actual directive.
pack_body() { sed '/<!--/,/-->/d' "$1"; }

FORMAT_DIRECTIVE_RE='VERDICT:|FINDINGS:|SHIP-AS-IS|FIX-THEN-SHIP|Handoff|Verified Clean|output contract|Next consumer|🔴|🟠|🟡|🔵'

note "== (1) packs free of output-format directives =="
for p in "$PACKS_DIR"/*.md; do
  [ -f "$p" ] || continue
  hit="$(pack_body "$p" | grep -nEi "$FORMAT_DIRECTIVE_RE" || true)"
  if [ -n "$hit" ]; then note "  FAIL $(basename "$p"): $hit"; FAIL=1; else note "  ok   $(basename "$p")"; fi
done

REV_PACK_BODY="$(pack_body "$PACKS_DIR/reviewer-pack.md" | tr '[:upper:]' '[:lower:]')"

note "== (2)(3)(4) predicates parse, non-empty, pack-disjoint =="
for m in "$MATCH_DIR"/*.match.json; do
  [ -f "$m" ] || continue
  cid="$(basename "$m" .match.json)"
  # (2) parse + any_of non-empty (match-eval literals throws if malformed/empty)
  lits="$(node "$HERE/match-eval.js" literals --case "$cid" --match-dir "$MATCH_DIR" 2>/tmp/mel.$$)" || {
    note "  FAIL $cid: predicate parse error: $(cat /tmp/mel.$$)"; FAIL=1; rm -f /tmp/mel.$$; continue; }
  rm -f /tmp/mel.$$
  # (3)+(4) each all_of literal must NOT appear in the reviewer pack body
  # Word-boundary disjointness: a predicate term collides only when the pack uses it as a
  # WHOLE word (vocabulary leakage), not when it is an incidental substring of an unrelated
  # word (e.g. "race" inside "trace"). Symbol/multiword terms (|| true, ../, >=) never match.
  coll=""
  while IFS= read -r term; do
    [ -z "$term" ] && continue
    if printf '%s' "$REV_PACK_BODY" | grep -iqwF -- "$term" 2>/dev/null; then
      coll="$coll [$term]"
    fi
  done <<< "$lits"
  if [ -n "$coll" ]; then note "  FAIL $cid: literal(s) collide with pack vocabulary:$coll"; FAIL=1; else note "  ok   $cid"; fi
done

if [ "$FAIL" -ne 0 ]; then note "ASSERT-INSTRUMENTS: FAIL"; exit 1; fi
note "ASSERT-INSTRUMENTS: PASS"
