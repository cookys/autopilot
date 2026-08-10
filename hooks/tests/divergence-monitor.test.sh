#!/usr/bin/env bash
# Shadow-vs-legacy divergence monitor. The property that matters most is what it refuses:
# absence of evidence must never read as agreement. A monitor that treated an unexercised
# path as "no disagreements observed" would carry the authority of a measurement while
# measuring nothing — worse than having no monitor at all.
. "$(dirname "$0")/lib.sh"

MON="$REPO_ROOT/scripts/divergence-monitor.js"
STORE="$(mktemp -d)/observations.jsonl"
trap 'rm -rf "$(dirname "$STORE")"' EXIT

rec() { node "$MON" record --store "$STORE" "$@" >/dev/null; }
sum() { node "$MON" report --store "$STORE" --json "$@" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log([o.samples,o.agreements,o.divergences,o.unexplained,o.shadow_only].join('|'))})"; }

# --- 1. zero observations is NOT READY, and says why ------------------------------
OUT="$(node "$MON" promotion-readiness --path /l5 --store "$STORE" 2>&1)"
assert_contains "$OUT" "NOT READY" "an unexercised path must not be promotion-ready"
assert_contains "$OUT" "zero samples cannot fund a promotion" "the reason must name the absence of evidence"
node "$MON" promotion-readiness --path /l5 --store "$STORE" >/dev/null 2>&1
assert_eq "1" "$?" "zero samples must exit non-zero"

# --- 2. shadow-only observations fund nothing --------------------------------------
rec --path /l5 --shadow accept
rec --path /l5 --shadow accept
rec --path /l5 --shadow reject
assert_eq "0|0|0|0|3" "$(sum --path /l5)" "shadow-only rows must not count as samples"
node "$MON" promotion-readiness --path /l5 --store "$STORE" >/dev/null 2>&1
assert_eq "1" "$?" "three shadow-only observations must still not be ready"

# --- 3. paired agreement counts ------------------------------------------------------
rec --path /l5 --shadow accept --legacy accept
rec --path /l5 --shadow reject --legacy reject
assert_eq "2|2|0|0|3" "$(sum --path /l5)" "paired matching decisions must count as agreements"
node "$MON" promotion-readiness --path /l5 --store "$STORE" >/dev/null 2>&1
assert_eq "0" "$?" "paired agreement with nothing unexplained must be ready"

# --- 4. an unexplained divergence blocks --------------------------------------------
rec --path /l5 --shadow accept --legacy reject
assert_eq "3|2|1|1|3" "$(sum --path /l5)" "a divergence with no reason must count as unexplained"
OUT="$(node "$MON" promotion-readiness --path /l5 --store "$STORE" 2>&1)"
assert_contains "$OUT" "NOT READY" "an unexplained divergence must block promotion"
assert_contains "$OUT" "unexplained divergence" "the reason must name the unexplained divergence"

# --- 5. an explained divergence is counted but does not block ------------------------
STORE2="$(dirname "$STORE")/explained.jsonl"
node "$MON" record --store "$STORE2" --path /l6 --shadow accept --legacy accept >/dev/null
node "$MON" record --store "$STORE2" --path /l6 --shadow accept --legacy reject --reason "legacy applied a stale policy hash" >/dev/null
SUM2="$(node "$MON" report --store "$STORE2" --path /l6 --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log([o.samples,o.divergences,o.unexplained].join('|'))})")"
assert_eq "2|1|0" "$SUM2" "a divergence with a recorded reason must be explained, not unexplained"
node "$MON" promotion-readiness --path /l6 --store "$STORE2" >/dev/null 2>&1
assert_eq "0" "$?" "an explained divergence must not block"

# --- 6. the monitor never invents an explanation -------------------------------------
# An empty-string reason is not a reason. Accepting it would let a caller silence a real
# disagreement by passing nothing meaningful.
STORE3="$(dirname "$STORE")/empty-reason.jsonl"
node "$MON" record --store "$STORE3" --path /l4 --shadow accept --legacy reject --reason "" >/dev/null 2>&1 || true
SUM3="$(node "$MON" report --store "$STORE3" --path /l4 --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(o.unexplained)}catch(e){console.log('0')}})")"
assert_eq "1" "$SUM3" "an empty reason must not count as an explanation"

# --- 7. corrupt rows are surfaced, never silently dropped ----------------------------
# Dropping them would shrink the denominator and make agreement look better than it is.
STORE4="$(dirname "$STORE")/corrupt.jsonl"
node "$MON" record --store "$STORE4" --path /l3 --shadow accept --legacy accept >/dev/null
printf 'this is not json\n' >> "$STORE4"
CORRUPT="$(node "$MON" report --store "$STORE4" --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.corrupt_rows)})")"
assert_eq "1" "$CORRUPT" "a corrupt row must be counted, not skipped"
node "$MON" promotion-readiness --path /l3 --store "$STORE4" >/dev/null 2>&1
assert_eq "1" "$?" "an untrustworthy denominator must block promotion"

# --- 8. paths are isolated -----------------------------------------------------------
assert_eq "2|1|0" "$(node "$MON" report --store "$STORE2" --path /l6 --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log([o.samples,o.divergences,o.unexplained].join('|'))})")" "one path's rows must not leak into another"
assert_eq "0|0|0|0|0" "$(sum --path /nonexistent)" "an unknown path must report zeros, not an error"

finalize_test
