#!/usr/bin/env bash
# Red-case coverage for scripts/check-holdout-coverage.sh (four-layer D5 / KR5).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-holdout-coverage.sh"
chmod +x "$SCRIPT" 2>/dev/null || true

# Fixture repo with one commit range
FR="$TEST_TMP/holdout-repo"
mkdir -p "$FR" && ( cd "$FR" \
  && git init -q -b main && git config user.email t@t && git config user.name t \
  && echo base > f.txt && git add . && git commit -qm base \
  && echo change > f.txt && git commit -aqm change )
RANGE="HEAD~1..HEAD"
HEAD_SHA="$(git -C "$FR" rev-parse HEAD)"
EV="$TEST_TMP/holdout-evidence"; mkdir -p "$EV"

HIGH_RISK="$TEST_TMP/risk-high.json"; printf '{"adversarial_review": true}\n' > "$HIGH_RISK"
LOW_RISK="$TEST_TMP/risk-low.json";   printf '{"adversarial_review": false}\n' > "$LOW_RISK"

check() { bash "$SCRIPT" check --range "$RANGE" --repo "$FR" --evidence-dir "$EV" --risk-file "$1" 2>&1; }

# ── Low-risk diff: holdout not required ──
OUT="$(check "$LOW_RISK")"; EXIT=$?
assert_eq "0" "$EXIT" "low-risk diff passes without receipts"
assert_contains "$OUT" "not high-risk" "low-risk rationale stated"

# ── RED: high-risk with NO receipt fails closed ──
OUT="$(check "$HIGH_RISK")"; EXIT=$?
assert_eq "1" "$EXIT" "high-risk diff with no receipt fails closed"
assert_contains "$OUT" "NO holdout receipt" "absence named in failure"

# ── RED: malformed receipt fails closed ──
printf 'not json' > "$EV/holdout-mutation.json"
OUT="$(check "$HIGH_RISK")"; EXIT=$?
assert_eq "1" "$EXIT" "malformed receipt fails closed"
assert_contains "$OUT" "malformed" "malformation named"

# ── RED: stale receipt (wrong head SHA) fails closed ──
printf '{"instrument":"mutation","head_sha":"%s","exit_code":0,"passing":true}\n' \
  "0000000000000000000000000000000000000000" > "$EV/holdout-mutation.json"
OUT="$(check "$HIGH_RISK")"; EXIT=$?
assert_eq "1" "$EXIT" "stale receipt (wrong SHA) fails closed"
assert_contains "$OUT" "STALE" "staleness named"

# ── RED: failed-result receipt fails closed ──
printf '{"instrument":"mutation","head_sha":"%s","exit_code":1,"passing":false}\n' \
  "$HEAD_SHA" > "$EV/holdout-mutation.json"
OUT="$(check "$HIGH_RISK")"; EXIT=$?
assert_eq "1" "$EXIT" "failed-result receipt fails closed"
assert_contains "$OUT" "not passing" "failure result named"

# ── GREEN: bound passing receipt satisfies the gate ──
printf '{"instrument":"mutation","head_sha":"%s","exit_code":0,"passing":true}\n' \
  "$HEAD_SHA" > "$EV/holdout-mutation.json"
OUT="$(check "$HIGH_RISK")"; EXIT=$?
assert_eq "0" "$EXIT" "bound passing receipt satisfies the gate"
assert_contains "$OUT" "holdout satisfied" "satisfaction stated"

# ── run subcommand materializes a bound receipt from probe-mutation stdout ──
# Red-green probe pair: probe passes on the tree, mutate flips it, probe must then fail —
# a real (tiny) mutation-detection run through the actual instrument.
RUN_EV="$TEST_TMP/run-evidence"; mkdir -p "$RUN_EV"
OUT="$(bash "$SCRIPT" run --range "$RANGE" --repo "$FR" --evidence-dir "$RUN_EV" \
  --instrument mutation \
  --probe-cmd "grep -q change f.txt" \
  --mutate-cmd "echo mutated > f.txt" 2>&1)"; EXIT=$?
assert_exists() { [ -f "$1" ] && echo yes || echo no; }
assert_eq "yes" "$(assert_exists "$RUN_EV/holdout-mutation.json")" "run writes the receipt file"
RSHA="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).head_sha)' "$RUN_EV/holdout-mutation.json")"
assert_eq "$HEAD_SHA" "$RSHA" "receipt is stamped with the diff head SHA"

finalize_test
