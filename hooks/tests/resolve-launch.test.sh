#!/usr/bin/env bash
# resolve-launch.sh: one launch decision from resolve-dispatch output (fleet 01M883AEHTJWZH95JSY1MSKEFX).
# (a) engine=agy JSON -> hetero launch, runner agy; (b) no engine field -> unchanged Claude path;
# (c) AUTOPILOT_POOL_MECH_ROUTE=0 -> Claude path; (d) private lane never gets kimi; (e) real resolve.
. "$(dirname "$0")/lib.sh"

H="$REPO_ROOT/scripts/resolve-launch.sh"
NOCFG="/dev/null/nonexistent"
run_l() {
  env -u AUTOPILOT_ACCOUNT -u CLAUDE_CONFIG_DIR -u AUTOPILOT_LANE -u AUTOPILOT_POOL_MECH_ROUTE \
    -u AUTOPILOT_MECH_ROUTE_EXCLUDE -u AUTOPILOT_POOL_MECH_ROUTE_CONFIG \
    MODEL_ROUTING_CONFIG_OVERRIDE="$NOCFG" "$@" 2>&1
}

# (a) pure decision from JSON
OUT="$(run_l bash "$H" --json '{"model":"gemini-4-carbon-high","mode":"default","agent":"","engine":"agy","runner":"agy","pool":"agy","source":"pool-route"}' --branch feat/x --prompt-file /p/brief.md)"
assert_contains "$OUT" '"launch":"hetero"'  "(a) engine agy -> hetero launch"
assert_contains "$OUT" '"runner":"agy"'     "(a) runner agy"
assert_contains "$OUT" 'scripts/dispatch-hetero.sh","--runner","agy","--model","gemini-4-carbon-high"' "(a) argv carries runner+model"
assert_contains "$OUT" '"--branch","feat/x","--prompt-file","/p/brief.md"' "(a) branch/prompt passed through"
OUT="$(run_l bash "$H" --json '{"model":"gpt-6.1-sol","mode":"default","agent":"","engine":"codex","runner":"codex","pool":"codex A","source":"pool-route"}')"
assert_contains "$OUT" '"runner":"codex"'   "(a) codex runner"
# (b) no engine field -> Claude path unchanged
OUT="$(run_l bash "$H" --json '{"model":"haiku","mode":"default","agent":"","source":"default"}')"
assert_contains "$OUT" '"launch":"claude"'  "(b) no engine -> claude"
assert_contains "$OUT" '"model":"haiku"'    "(b) model kept"
assert_not_contains "$OUT" 'dispatch-hetero' "(b) no hetero argv"
OUT="$(run_l bash "$H" --json '{"model":"sonnet","mode":"default","agent":"","engine":"claude","runner":"claude","source":"x"}')"
assert_contains "$OUT" '"launch":"claude"'  "(b) engine claude -> claude"
# (d) private lane: kimi runner refused
EC=0; OUT="$(run_l AUTOPILOT_LANE=308 bash "$H" --json '{"model":"kimi-k3","mode":"default","agent":"","engine":"kimi","runner":"kimi","source":"x"}')" || EC=$?
assert_eq "3" "$EC" "(d) private lane + kimi runner refused (exit 3)"
EC=0; OUT="$(run_l AUTOPILOT_LANE=autopilot bash "$H" --json '{"model":"kimi-k3","mode":"default","agent":"","engine":"kimi","runner":"kimi","source":"x"}')" || EC=$?
assert_eq "0" "$EC" "(d) non-private lane + kimi allowed"
EC=0; OUT="$(run_l bash "$H" --json '{"model":"m","engine":"agy","runner":"agy; rm -rf x","source":"x"}')" || EC=$?
assert_eq "2" "$EC" "(a) hostile runner token rejected"

# (e) real resolve
OUT="$(run_l AUTOPILOT_ACCOUNT=singularaion bash "$H" --role hands --branch feat/x --prompt-file /p/b.md)"
assert_contains "$OUT" '"launch":"hetero"'  "(e) singularaion hands -> hetero"
assert_contains "$OUT" '"runner":"agy"'     "(e) agy first"
OUT="$(run_l AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_MECH_ROUTE_EXCLUDE=agy bash "$H" --role fast-worker)"
assert_contains "$OUT" '"runner":"codex"'   "(e) exclude agy -> codex"
# (c) switch off
OUT="$(run_l AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_POOL_MECH_ROUTE=0 bash "$H" --role hands)"
assert_contains "$OUT" '"launch":"claude"'  "(c) switch off -> claude"
OUT="$(run_l bash "$H" --role hands)"
assert_contains "$OUT" '"launch":"claude"'  "(c) non-pool seat -> claude"
# (d) real resolve on private lane + singularaion: never kimi
OUT="$(run_l AUTOPILOT_ACCOUNT=singularaion AUTOPILOT_LANE=308 bash "$H" --role hands)"
assert_not_contains "$OUT" 'kimi'           "(d) private lane real resolve never kimi"
EC=0; run_l bash "$H" --role nosuchrole >/dev/null || EC=$?
assert_eq "1" "$EC" "unknown role propagates exit 1"

finalize_test
