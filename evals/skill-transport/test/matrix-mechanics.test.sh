#!/usr/bin/env bash
# matrix-mechanics.test.sh — Phase-0 proof that run-matrix.sh + report.js compute correctly,
# using the deterministic stub-dispatch fixture (NO spend). Asserts: resume-by-cell,
# shuffled-seed recording, no_verdict fail-closed accounting, per-arm/per-case format-conflict
# guard, discordant-pair + placebo computation, token extraction plumbing.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ST="$HERE/.."
STUB="$HERE/stub-dispatch.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAILN=0
ok(){ PASS=$((PASS+1)); }
bad(){ FAILN=$((FAILN+1)); echo "FAIL: $*" >&2; }
jqf(){ node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=process.argv[2].split(".");let v=o;for(const k of p)v=v[k];process.stdout.write(String(v))' "$1" "$2"; }

# ---- scenario delta2 ----
OUT="$TMP/delta2.jsonl"
DISPATCH_REVIEW_CMD="$STUB" STUB_SCENARIO=delta2 \
  bash "$ST/run-matrix.sh" --engine stub --runner claude-native --model stub \
  --k 3 --arms nopack,pack,placebo --out "$OUT" --seed 4242 >/dev/null 2>&1
ROWS=$(wc -l < "$OUT")
[ "$ROWS" = "216" ] && ok || bad "delta2 rows expected 216 got $ROWS"
[ -f "$OUT.stub.seed" ] && [ "$(cat "$OUT.stub.seed")" = "4242" ] && ok || bad "seed not recorded"

# resume adds 0
DISPATCH_REVIEW_CMD="$STUB" STUB_SCENARIO=delta2 \
  bash "$ST/run-matrix.sh" --engine stub --runner claude-native --model stub \
  --k 3 --arms nopack,pack,placebo --out "$OUT" >/dev/null 2>&1
[ "$(wc -l < "$OUT")" = "216" ] && ok || bad "resume changed row count"

REP="$TMP/delta2.report.json"
node "$ST/report.js" --in "$OUT" --json > "$REP" 2>/dev/null
[ "$(jqf "$REP" engines.stub.discordant_pack_vs_nopack.delta)" = "2" ] && ok || bad "delta2 delta expected 2 got $(jqf "$REP" engines.stub.discordant_pack_vs_nopack.delta)"
[ "$(jqf "$REP" engines.stub.discordant_placebo_vs_nopack.delta)" = "0" ] && ok || bad "placebo delta expected 0"
[ "$(jqf "$REP" engines.stub.format_conflict)" = "false" ] && ok || bad "delta2 format_conflict should be false"
[ "$(jqf "$REP" engines.stub.arms.pack.caught)" = "13" ] && ok || bad "pack caught expected 13 got $(jqf "$REP" engines.stub.arms.pack.caught)"
[ "$(jqf "$REP" engines.stub.arms.nopack.caught)" = "11" ] && ok || bad "nopack caught expected 11 got $(jqf "$REP" engines.stub.arms.nopack.caught)"
[ "$(jqf "$REP" engines.stub.arms.nopack.false_pass_on_major)" = "2" ] && ok || bad "nopack fp_major expected 2"
[ "$(jqf "$REP" engines.stub.arms.pack.clean_overflag)" = "0" ] && ok || bad "pack over-flag expected 0"
[ "$(jqf "$REP" engines.stub.arms.pack.specificity)" = "1" ] && ok || bad "pack specificity expected 1"
[ "$(jqf "$REP" engines.stub.flip_band_pack)" = "0" ] && ok || bad "flip band expected 0 (k=3 unanimous)"
# token extraction plumbed (stub writes usage 120+45=165)
TOK=$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(x=>x);console.log(JSON.parse(l[0]).tokens)' "$OUT")
[ "$TOK" = "165" ] && ok || bad "token extraction expected 165 got $TOK"

# ---- scenario format_conflict ----
OUT2="$TMP/fc.jsonl"
DISPATCH_REVIEW_CMD="$STUB" STUB_SCENARIO=format_conflict \
  bash "$ST/run-matrix.sh" --engine stub2 --runner claude-native --model stub \
  --k 3 --arms nopack,pack --out "$OUT2" --seed 99 >/dev/null 2>&1
REP2="$TMP/fc.report.json"
node "$ST/report.js" --in "$OUT2" --json > "$REP2" 2>/dev/null
[ "$(jqf "$REP2" engines.stub2.format_conflict)" = "true" ] && ok || bad "format_conflict expected true"
[ "$(jqf "$REP2" engines.stub2.format_conflict_detail.pack_no_verdict_cases)" = "2" ] && ok || bad "pack nv cases expected 2"
[ "$(jqf "$REP2" engines.stub2.format_conflict_detail.nopack_no_verdict_cases)" = "0" ] && ok || bad "nopack nv cases expected 0"

echo "matrix-mechanics: PASS=$PASS FAIL=$FAILN"
[ "$FAILN" -eq 0 ]