# Shared setup for the resolve-review-loop-{a..d}.test.sh shards (split from the
# original resolve-review-loop.test.sh for wall time). Source AFTER lib.sh.
SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# Keep default-path assertions hermetic when the surrounding agent/session exports
# resolver overrides or live engine-state paths.
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-such-topology.json"
# Unsetting ENGINE_CAPABILITY_DIR alone fell back to the HOST store
# (~/.autopilot/engine-capability) — undoing lib.sh's global isolation. Since the
# 2026-09-12 cursor implementer seat, the live config (and the frozen 2026-09-13 copy)
# only resolves with a standing operator pin; the suite passed only on a host that
# happened to hold that pin, and exited 3 everywhere else (CI, empty HOME, or this host
# once the pin was gone). Point the store at TEST_TMP and seed the SAME pin the operator
# recorded. The tuple is written out literally on purpose: if the config's implementer
# seat is edited without updating this pin, the LIVE assertion below reds, naming the
# config as the operand.
seed_dogfood_implementer_pin

# Hermetic fixtures (roster-flip-proof). The autopilot repo ships a dogfood
# .claude/review-loop-config.md that the resolver reads by default (precedence
# slot 3). Its roster is a moving target — as of 2026-07-16 (Board decision A,
# while the codex pool is dead) the reviewer is MiniMax-M3 and the implementer is
# grok-4.5 (xai). Behavior/fixture cases below must NOT depend on that live roster:
# they pin their own configured reviewer/implementer identity so they exercise a
# KNOWN engine that matches their scorecard/capability fixtures on ANY machine.
#   EMPTY_CFG       — keyless override → resolver built-in defaults (reviewer gpt-5.5,
#                     implementer gpt-5.3-codex-spark @ openai → high-trust → low risk).
#   CODEX_IMPL_CFG  — pins the pre-Board-A openai/codex implementer so capability-state
#                     (§20) and density-scaling (§22–23) fixtures match by runner+model.
EMPTY_CFG="$TEST_TMP/empty-config.md"
: > "$EMPTY_CFG"
CODEX_IMPL_CFG="$TEST_TMP/impl-codex.md"
# allow_same_runner_dual_seat: this roster names implementer_runner codex and
# inherits the built-in reviewer default, which is ALSO codex — a real dual-seat
# collision under the runner-axis gate. Opting in (rather than diversifying the
# reviewer) keeps every other resolved value byte-identical, which matters because
# this fixture is about quota/capability telemetry, not decorrelation.
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n- allow_same_runner_dual_seat: on\n' > "$CODEX_IMPL_CFG"

json_get() { # json key -> raw json value
  local json="$1" key="$2"
  export JSON_VALUE="$json"
  node - "$key" <<'NODE'
const fs = require('fs');
const payload = process.env.JSON_VALUE || '';
const key = process.argv[2];
if (!payload) process.exit(0);
const parsed = JSON.parse(payload);
const value = parsed && parsed[key];
if (value === undefined) process.exit(0);
// Strings are returned RAW (unquoted) so assertions can compare to a bare value
// (e.g. assert_eq "unknown"); arrays/objects/numbers are JSON.stringify'd (e.g. "[]").
process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
NODE
  unset JSON_VALUE
}
FROZEN_CFG="$REPO_ROOT/hooks/tests/fixtures/review-loop-config.frozen-2026-09-13.md"
F() { REVIEW_LOOP_CONFIG_OVERRIDE="$FROZEN_CFG" bash "$SCRIPT" "$@"; }
