#!/usr/bin/env bash
# Fixture coverage for scripts/resolve-scaffold-tier.js (four-layer D4 / KR3).
# The four T2 fail-closure cases (missing/unknown/stale/conflicting) each get a fixture,
# plus T0, T1, imported-priors, and malformed-line tolerance.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-scaffold-tier.js"
NOW="2026-08-16T00:00:00Z"
SC="$TEST_TMP/scorecard.jsonl"

resolve() { node "$SCRIPT" --runner grok --model grok-4.5 --role implementer --now "$NOW" --scorecard "$SC"; }
tier()    { resolve | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));'; }

row() { # $1 date, $2 corpus_pass, $3 false_pass_critical, $4 score, $5 extra-json
  printf '{"runner":"grok","model":"grok-4.5","role":"implementer","date":"%s","quality":{"corpus_pass":"%s","false_pass_critical":%s},"capability_score":%s%s}\n' \
    "$1" "$2" "$3" "$4" "${5:-}"
}

# ── T2: missing store ──
rm -f "$SC"
assert_eq "T2" "$(tier)" "missing scorecard store fails closed to T2"

# ── T2: unknown engine (store exists, no matching row) ──
printf '{"runner":"codex","model":"gpt-5.5","role":"reviewer","date":"2026-08-10","quality":{"corpus_pass":"5/5","false_pass_critical":0},"capability_score":1}\n' > "$SC"
assert_eq "T2" "$(tier)" "unknown engine (no matching row) fails closed to T2"

# ── T2: stale evidence (outside the frozen 30-day window) ──
row "2026-06-01" "40/40" 0 1 > "$SC"
assert_eq "T2" "$(tier)" "stale evidence (outside frozen window) fails closed to T2"

# ── T2: conflicting fresh records ──
{ row "2026-08-10" "40/40" 0 1; row "2026-08-12" "10/40" 3 0; } > "$SC"
OUT="$(resolve)"
assert_eq "T2" "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));')" \
  "conflicting fresh records fail closed to T2"
assert_contains "$OUT" '"line": 1' "conflict verdict records the first ref"
assert_contains "$OUT" '"line": 2' "conflict verdict records the second ref"

# ── T2: imported priors never lift ──
row "2026-08-10" "40/40" 0 1 ',"version_source":"imported"' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "imported priors alone stay T2"
assert_contains "$OUT" "priors never lift" "prior rationale named"

# ── T0: fresh + complete ──
row "2026-08-10" "40/40" 0 1 > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T0"' "fresh complete qualification resolves T0"
assert_contains "$OUT" '"evidence_refs"' "T0 verdict carries evidence refs"

# ── T1: fresh + partial ──
row "2026-08-10" "30/40" 0 1 > "$SC"
assert_eq "T1" "$(tier)" "fresh partial qualification resolves T1"

# ── Malformed lines tolerated, push only toward T2 ──
{ printf 'not json at all\n'; row "2026-08-10" "40/40" 0 1; } > "$SC"
assert_eq "T0" "$(tier)" "malformed line skipped; valid fresh row still resolves"
printf 'not json at all\n' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "only-malformed store fails closed to T2"
assert_contains "$OUT" "malformed line" "malformed count surfaces in rationale"

finalize_test
