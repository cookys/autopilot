#!/usr/bin/env bash
# hetero-review-seat-model-preflight.test.sh — BL-0364: a claude-native seat spelled with a bare
# family alias (`claude-opus`) is refused by collect BEFORE any dispatch (the CLI would die with
# unrecognized_model and the generation would be recorded as a seat_gap). The shipped template's
# qc_panel must resolve to names the CLI accepts.
. "$(dirname "$0")/lib.sh"

LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"

# ─── (1) template + resolver default resolve to valid claude ids ───
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/no-config.json" AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"
cp "$REPO_ROOT/project-config-template/review-loop-config.md" "$TEST_TMP/tpl.md"
SEATS=$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/tpl.md" "$RESOLVER" --field qc_panel_seats 2>/dev/null)
CHK=$(printf '%s' "$SEATS" | node -e '
  const { invalidSeatModels } = require(process.argv[1]);
  const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const seats = s.map((x, i) => ({ id: "s" + i, runner: x.runner, engine: x.model }));
  const native = seats.filter((x) => x.runner === "claude-native").length;
  console.log(seats.length + " " + native + " " + invalidSeatModels(seats).length);' "$REPO_ROOT/scripts/lib/seat-model-id.js")
assert_eq "$CHK" "4 0 0" "template qc_panel: 4 seats, 0 claude-native, 0 invalid models"
assert_not_contains "$SEATS" '"model":"claude-opus"' "template qc_panel carries no bare claude-opus"
DEFSEATS=$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE=/dev/null "$RESOLVER" --field qc_panel_seats 2>/dev/null)
assert_not_contains "$DEFSEATS" '"model":"claude-opus"' "resolver built-in default carries no bare claude-opus"
assert_contains "$DEFSEATS" '"model":"claude-opus-5-5"' "resolver built-in default carries the full id"

# ─── (2) collect preflight ───
SCRATCH_REPO="$TEST_TMP/repo"; mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q; git config user.email t@example.com; git config user.name T
  echo a > file.txt; git add file.txt; git commit -q -m c1
  echo b > file.txt; git add file.txt; git commit -q -m c2
)
BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(cd "$SCRATCH_REPO" && git checkout -q -b work && echo w >> file.txt && git commit -q -am c3)
cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/"

# Spy dispatcher: records every call, answers a clean SHIP-AS-IS.
cat > "$SCRATCH_REPO/scripts/dispatch-review.sh" <<'STUB'
#!/usr/bin/env bash
echo "$STUB_SEAT_ID" >> "$SPY_FILE"
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB
chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"

collect() { # <phase> <seats> [loop script]
  SPY_FILE="$TEST_TMP/spy-$1" node "${3:-$LOOP}" collect --repo-root "$SCRATCH_REPO" --ledger "$TEST_TMP/ledger" \
    --phase "$1" --generation 1 --branch work --phase-base "$BASE" --seats "$2" 2>&1
}

OUT=$(collect bad "gpt-test/low@codex,claude-opus/high@claude-native"); RC=$?
assert_exit_code "$RC" "2" "bare claude-opus seat: collect refuses with rc=2"
assert_contains "$OUT" "claude-opus" "refusal names the offending model"
assert_contains "$OUT" "claude-opus-5-5" "refusal names a valid spelling"
assert_contains "$OUT" "seat s1" "refusal names the seat"
assert_file_absent "$TEST_TMP/spy-bad" "bare alias: no dispatch was called (spy file absent)"
assert_file_absent "$TEST_TMP/ledger/review-bad/g1" "bare alias: no generation directory created"
assert_not_contains "$(cat "$TEST_TMP/ledger/review-bad/chain.json" 2>/dev/null)" "seat_gap" "bare alias: no seat_gap chain entry"
assert_not_contains "$(cat "$TEST_TMP/ledger/review-bad/chain.json" 2>/dev/null)" '"generation"' "bare alias: no generation consumed in chain"

OUT=$(collect good "gpt-test/low@codex,claude-opus-5-5/high@claude-native"); RC=$?
assert_exit_code "$RC" "0" "valid full id: collect proceeds"
assert_eq "$(sort "$TEST_TMP/spy-good" | tr '\n' ' ')" "s0 s1 " "valid full id: both seats dispatched"
OUT=$(collect alias "gpt-test/low@codex,opus/high@claude-native"); RC=$?
assert_exit_code "$RC" "0" "CLI alias 'opus': accepted"
assert_eq "$(sort "$TEST_TMP/spy-alias" | tr '\n' ' ')" "s0 s1 " "CLI alias 'opus': both seats dispatched"

# Negative control: drop the preflight and the bad seat gets dispatched.
MUT="$TEST_TMP/mut"; mkdir -p "$MUT"; cp -r "$REPO_ROOT/scripts" "$MUT/scripts"; ln -s "$REPO_ROOT/src" "$MUT/src"
node -e '
  const fs = require("fs"); const f = process.argv[1];
  const o = "const badModels = invalidSeatModels(seats);";
  const s = fs.readFileSync(f, "utf8"); if (s.split(o).length !== 2) { console.error("MUTATION TARGET NOT UNIQUE"); process.exit(3); }
  fs.writeFileSync(f, s.replace(o, () => "const badModels = [];"));' "$MUT/scripts/hetero-review-loop.js" || fail "mutation setup failed"
OUT=$(collect mut "gpt-test/low@codex,claude-opus/high@claude-native" "$MUT/scripts/hetero-review-loop.js"); RC=$?
assert_eq "$([ -f "$TEST_TMP/spy-mut" ] && echo dispatched || echo none)" "dispatched" "negative control: without the preflight the bad seat is dispatched"

finalize_test
