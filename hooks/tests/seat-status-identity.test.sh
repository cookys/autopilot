#!/usr/bin/env bash
# seat-status identity (BL-0257 note 8 follow-up): the production projection must name the seat
# it answered for (engine, runner, role) and must not answer from a row whose engine matches but
# whose runner or role differs.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/engine-scorecard.js"
FIXTURE_JS="$REPO_ROOT/hooks/tests/lib/consult-discuss-genuine-row-fixture.js"

rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$ENGINE_SCORECARD_DIR/.lock"
rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
touch "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"

row="$(node "$FIXTURE_JS" consult --engine gpt-5.6-sol --runner codex)" || fail "fixture failed"
printf '%s\n' "$row" | node "$CLI" record >/dev/null || fail "record failed"
now="$(node -e 'process.stdout.write(new Date().toISOString())')"

field() { printf '%s' "$1" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d[process.argv[1]]))' "$2"; }

hit="$(node "$CLI" seat-status --engine gpt-5.6-sol --runner codex --role consult --effort high --now "$now")"
assert_eq "$(field "$hit" admission_status)" "qualified" "baseline: the recorded seat reads qualified"

# RED at a83d3595959fb728ef53d5758d240f7b3621b46a: FAIL x5 (4 passed, 5 failed): engine/runner/role expected e.g. 'gpt-5.6-sol', got 'undefined'
assert_eq "$(field "$hit" engine)" "gpt-5.6-sol" "projection names the engine it answered for"
assert_eq "$(field "$hit" runner)" "codex" "projection names the runner it answered for"
assert_eq "$(field "$hit" role)" "consult" "projection names the role it answered for"

# Same engine, different runner / role: a different seat, must not inherit the baseline.
other_runner="$(node "$CLI" seat-status --engine gpt-5.6-sol --runner opencode --role consult --effort high --now "$now")"
assert_eq "$(field "$other_runner" admission_status)" "no_record" "same engine, other runner: excluded"
assert_eq "$(field "$other_runner" runner)" "opencode" "other-runner projection names the queried runner"
other_role="$(node "$CLI" seat-status --engine gpt-5.6-sol --runner codex --role discuss --effort high --now "$now")"
assert_eq "$(field "$other_role" admission_status)" "no_record" "same engine+runner, other role: excluded"
assert_eq "$(field "$other_role" role)" "discuss" "other-role projection names the queried role"
other_engine="$(node "$CLI" seat-status --engine gpt-5.6-terra --runner codex --role consult --effort high --now "$now")"
assert_eq "$(field "$other_engine" admission_status)" "no_record" "other engine: excluded"

finalize_test
