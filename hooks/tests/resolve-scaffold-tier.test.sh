#!/usr/bin/env bash
# Fixture coverage for scripts/resolve-scaffold-tier.js (four-layer D4 / KR3).
# The four T2 fail-closure cases (missing/unknown/stale/conflicting) each get a fixture,
# plus T0, T1, imported-priors, supersession (latest fresh row wins), the
# expiry-less→stale rule from references/scaffold-tiers.md, and malformed-line tolerance.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-scaffold-tier.js"
NOW="2026-08-16T00:00:00Z"
SC="$TEST_TMP/scorecard.jsonl"

resolve() { node "$SCRIPT" --runner grok --model grok-4.5 --role implementer --now "$NOW" --scorecard "$SC"; }
tier()    { resolve | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));'; }

row() { # $1 date, $2 expires, $3 corpus_pass, $4 false_pass_critical, $5 score, $6 extra-json
  printf '{"runner":"grok","model":"grok-4.5","role":"implementer","date":"%s","expires":"%s","quality":{"corpus_pass":"%s","false_pass_critical":%s},"capability_score":%s%s}\n' \
    "$1" "$2" "$3" "$4" "$5" "${6:-}"
}

# ── T2: missing store ──
rm -f "$SC"
assert_eq "T2" "$(tier)" "missing scorecard store fails closed to T2"

# ── T2: unknown engine (store exists, no matching row) ──
printf '{"runner":"codex","model":"gpt-5.5","role":"reviewer","date":"2026-08-10","expires":"2026-09-10","quality":{"corpus_pass":"5/5","false_pass_critical":0},"capability_score":1}\n' > "$SC"
assert_eq "T2" "$(tier)" "unknown engine (no matching row) fails closed to T2"

# ── T2: stale evidence (record's own expires is past) ──
row "2026-06-01" "2026-06-15" "40/40" 0 1 > "$SC"
assert_eq "T2" "$(tier)" "expired record (past its own expires) fails closed to T2"

# ── T2: expiry-less record is stale (references/scaffold-tiers.md rule) ──
printf '{"runner":"grok","model":"grok-4.5","role":"implementer","date":"2026-08-10","quality":{"corpus_pass":"40/40","false_pass_critical":0},"capability_score":1}\n' > "$SC"
assert_eq "T2" "$(tier)" "expiry-less record is treated as stale and fails closed to T2"

# ── T2: latest fresh record is a failure (an older pass does not rescue it) ──
{ row "2026-08-10" "2026-09-10" "40/40" 0 1; row "2026-08-12" "2026-09-12" "10/40" 3 0; } > "$SC"
OUT="$(resolve)"
assert_eq "T2" "$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tier));')" \
  "latest fresh failure fails closed to T2 despite an older fresh pass"
assert_contains "$OUT" '"line": 2' "failure verdict cites the latest (authoritative) ref"

# ── Supersession: latest fresh row wins over an older fresh failure ──
{ row "2026-08-01" "2026-09-01" "10/40" 3 0; row "2026-08-12" "2026-09-12" "40/40" 0 1; } > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T0"' "latest fresh row supersedes an older fresh failure"
assert_contains "$OUT" '"line": 2' "supersession verdict cites the latest ref"

# ── T2: imported priors never lift ──
row "2026-08-10" "2026-09-10" "40/40" 0 1 ',"version_source":"imported"' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "imported priors alone stay T2"
assert_contains "$OUT" "priors never lift" "prior rationale named"

# ── T0: fresh + complete ──
row "2026-08-10" "2026-09-10" "40/40" 0 1 > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T0"' "fresh complete qualification resolves T0"
assert_contains "$OUT" '"evidence_refs"' "T0 verdict carries evidence refs"

# ── T1: fresh + partial ──
row "2026-08-10" "2026-09-10" "30/40" 0 1 > "$SC"
assert_eq "T1" "$(tier)" "fresh partial qualification resolves T1"

# ── Malformed lines tolerated, push only toward T2 ──
{ printf 'not json at all\n'; row "2026-08-10" "2026-09-10" "40/40" 0 1; } > "$SC"
assert_eq "T0" "$(tier)" "malformed line skipped; valid fresh row still resolves"
printf 'not json at all\n' > "$SC"
OUT="$(resolve)"
assert_contains "$OUT" '"tier": "T2"' "only-malformed store fails closed to T2"
assert_contains "$OUT" "malformed line" "malformed count surfaces in rationale"

finalize_test
