#!/usr/bin/env bash
# lib.sh puts a sentinel `fleet` first on PATH for every suite: a suite that reaches the courier (a card notice or decision answer sent
# to the PM for real) is recorded and fails finalize_test. Negative control: a child suite that sends on purpose must exit 1.
. "$(dirname "$0")/lib.sh"
assert_eq "$(command -v fleet)" "$FLEET_SENTINEL_DIR/fleet" "fleet on PATH is the sentinel"
assert_eq "$(env | grep -c '^FLEET_[A-Z_]*=' | tr -d ' ')" 0 "no inherited fleet identity (FLEET_ env vars)"
CHILD="$TEST_TMP/child.test.sh"
cat > "$CHILD" <<SH
#!/usr/bin/env bash
. "$REPO_ROOT/hooks/tests/lib.sh"
${1:-}
fleet send ns/cc/exec--claude "q A::a" >/dev/null
finalize_test
SH
bash "$CHILD" >"$TEST_TMP/child.out" 2>&1; assert_eq "$?" 1 "a suite that sends through the default fleet fails"
assert_contains "$(head -c 600 "$TEST_TMP/child.out")" "real fleet courier would have received" "the failure names the outbound send"

# open-decision.js: a child suite that opens a card with an executor leaves the card store +1 and the courier untouched.
# Read-back before/after: the local card count, and the sentinel (a send/dispatch from the child would fail its finalize_test).
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
RR="$TEST_TMP/odrepo"; mkdir -p "$RR"; $GIT -C "$RR" init -q; $GIT -C "$RR" commit -q --allow-empty -m base
cards() { find "$RR/.git/autopilot/decisions" -name '*.json' 2>/dev/null | xargs -r cat | grep -o '"id": *"d-[0-9a-f]*"' | wc -l | tr -d ' '; }
BEFORE="$(cards)"
cat > "$TEST_TMP/child2.test.sh" <<SH
#!/usr/bin/env bash
. "$REPO_ROOT/hooks/tests/lib.sh"
export HOME="\$TEST_TMP/home"; mkdir -p "\$HOME"; export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
node "$REPO_ROOT/scripts/open-decision.js" open --category goal --executor ns/cc/exec--claude --cwd "$RR" --root-run-id root-s --title '要改嗎' --question "Sentinel probe?" --option "A::a" --option "B::b" --recommendation A --not-authorized irreversible >/dev/null 2>&1
finalize_test
SH
timeout 120 bash "$TEST_TMP/child2.test.sh" >"$TEST_TMP/child2.out" 2>&1; assert_eq "$?" 0 "a suite that opens a card through open-decision.js sends nothing to the courier"
assert_eq "$(( $(cards) - BEFORE ))" 1 "read-back: exactly one new card in the local store (before: $BEFORE)"
finalize_test
