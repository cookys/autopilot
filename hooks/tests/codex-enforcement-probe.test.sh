#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROBE="$REPO_ROOT/scripts/probe-codex-enforcement.js"
ARTIFACT="$REPO_ROOT/docs/projects/_archive/2026-07-26-mission-convergence-portfolio/mission-p0-codex-enforcement.json"
CAPABILITY="$REPO_ROOT/src/harness/capabilities/codex.json"

assert_file_exists "$PROBE" "Codex enforcement probe exists"
assert_file_exists "$ARTIFACT" "Codex enforcement artifact exists"

OUT="$(node - "$ARTIFACT" "$CAPABILITY" <<'NODE'
'use strict';
const fs = require('fs');
const [artifactPath, capabilityPath] = process.argv.slice(2);
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
console.log(`identity=${artifact.schema_version}:${artifact.artifact_type}`);
console.log(`version=${artifact.codex_version}`);
console.log(`outcome=${artifact.codex_enforcement_outcome}`);
console.log(`marketplace=${artifact.evidence.marketplace_installed}`);
console.log(`plugin=${artifact.evidence.plugin_installed}`);
console.log(`execution=${artifact.evidence.execution_started}:${artifact.evidence.execution_exit_status}`);
console.log(`hook=${artifact.evidence.hook_invoked}`);
console.log(`request_bound=${artifact.evidence.request_bound}`);
console.log(`request_action=${artifact.evidence.request_action}`);
console.log(`target_created=${artifact.evidence.blocked_target_created}`);
console.log(`blocking_gate=${capability.capabilities.blocking_gate}`);
console.log(`capability_checked=${capability.last_checked_at}`);
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "Recorded Codex enforcement artifact parses"
assert_contains "$OUT" "identity=1:codex_enforcement_probe" \
  "Artifact has the frozen execution-probe identity"
assert_contains "$OUT" "version=codex-cli 0.145.0" \
  "Artifact pins the probed Codex version"
assert_contains "$OUT" "outcome=block-capable" \
  "Disposition is selected from execution evidence"
assert_contains "$OUT" "marketplace=true" "Probe marketplace was installed"
assert_contains "$OUT" "plugin=true" "Probe plugin was installed"
assert_contains "$OUT" "execution=true:0" "Harmless execution reached a terminal host result"
assert_contains "$OUT" "hook=true" "PreToolUse hook received the real tool request"
assert_contains "$OUT" "request_bound=true" "Hook evidence binds the requested scratch target"
assert_contains "$OUT" "request_action=shell_touch_exact" \
  "Hook evidence binds the exact shell action"
assert_contains "$OUT" "target_created=false" "Blocked tool produced no filesystem effect"
assert_contains "$OUT" "blocking_gate=warning" \
  "Capability stays below H4 despite the block-capable primitive"
assert_contains "$OUT" "capability_checked=2026-07-27" "Capability record is fresh"

PROBE_SOURCE="$(cat "$PROBE")"
assert_not_contains "$PROBE_SOURCE" "'--ignore-user-config'" \
  "Probe does not disable its own isolated plugin config"
assert_not_contains "$PROBE_SOURCE" "'--ask-for-approval'" \
  "Probe uses only options accepted by codex exec"
assert_contains "$PROBE_SOURCE" "process.once('exit', cleanup)" \
  "Probe cleans copied credentials and scratch state on handled failure"
assert_contains "$PROBE_SOURCE" "hookInvoked && requestBound && !targetCreated" \
  "Block-capable requires bound hook invocation and effect absence"
assert_contains "$PROBE_SOURCE" "else if (targetCreated)" \
  "Wrapper-required requires an observed effect, not plugin installation"
assert_contains "$PROBE_SOURCE" "exactCommands.has(command.trim())" \
  "Request binding requires an exact harmless shell command"
assert_contains "$PROBE_SOURCE" "process.once('exit', cleanup)" \
  "Copied credentials are removed on handled failure"
assert_contains "$PROBE_SOURCE" "process.kill(Number(pid),0)" \
  "Detached guardian cleans scratch credentials after abrupt parent death"

STUB_BIN="$TEST_TMP/bin"
STUB_ARTIFACT="$TEST_TMP/invalid-probe.json"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/codex" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "codex-cli fixture"
  exit 0
fi
if [ "${1:-}" = "plugin" ]; then
  printf '%s\n' '{"status":"ok"}'
  exit 0
fi
printf '%s\n' "fixture exec failed before tool dispatch" >&2
exit 2
STUB
chmod +x "$STUB_BIN/codex"
printf '%s\n' '{"preserve":"valid-prior-artifact"}' > "$STUB_ARTIFACT"
OUT="$(PATH="$STUB_BIN:$PATH" node "$PROBE" --output "$STUB_ARTIFACT" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "1" "Pre-tool execution failure leaves disposition unverified"
assert_contains "$OUT" "without request-bound hook or effect evidence" \
  "Invalid probe explains the missing execution evidence"
assert_contains "$(cat "$STUB_ARTIFACT")" '"preserve":"valid-prior-artifact"' \
  "Invalid retry preserves the prior valid disposition artifact"

PORTABILITY="$(cat "$REPO_ROOT/references/multi-agent-portability.md")"
assert_contains "$PORTABILITY" "codex-cli 0.146.0" "Codex native schema evidence is current"
assert_contains "$PORTABILITY" 'task_name`, `message`, `fork_turns`, `model`, and `reasoning_effort' \
  "Current native spawn schema records model and effort fields"
assert_contains "$PORTABILITY" "interrupt survivors" \
  "Native child teardown/disposition boundary is explicit"
assert_not_contains "$PORTABILITY" "Default schema is 3 fields" \
  "Stale Codex 0.144 locked-schema guidance is retired"
ROUTING="$(cat "$REPO_ROOT/references/model-routing.md")"
assert_contains "$ROUTING" "codex-cli 0.146.0" "Canonical routing guidance uses the current host version"
assert_contains "$ROUTING" '`model`, and `reasoning_effort`' "Canonical routing records model/effort request fields"
assert_contains "$ROUTING" "list/wait/interrupt" "Canonical routing records native lifecycle disposition"
assert_contains "$PORTABILITY" \
  'AUTOPILOT_CODEX_NATIVE_CHILD_PROBE=1 bash hooks/tests/codex-enforcement-probe.test.sh' \
  "Portability guidance names the exact rerunnable native-child probe"

# Opt-in live child probe: only a concrete spawn event, observed child identity,
# and terminal lifecycle event satisfy the evidence. Prompt/self-report strings
# are excluded mechanically by selecting tool-call/tool-result JSONL records.
if [ "${AUTOPILOT_CODEX_NATIVE_CHILD_PROBE:-0}" = 1 ]; then
  LIVE="$TEST_TMP/codex-native-child.jsonl"
  set +e
  timeout 180 codex exec --json -m "${AUTOPILOT_CODEX_PROBE_MODEL:-gpt-5.6-sol}" \
    'Spawn one child with model gpt-5.6-terra and reasoning_effort low. Wait for it, report its observed identity, then list/interrupt only if it survived.' >"$LIVE" 2>&1
  RC=$?
  set -e
  if [ "$RC" -ne 0 ] && grep -Eqi 'usage limit|quota|rate.limit|capacity' "$LIVE"; then
    echo "SKIP [codex-native-child] live quota unavailable"
  else
    assert_eq "0" "$RC" "Codex native child probe exits cleanly"
    CHILD_EVENT="$(jq -c 'select(.type == "item.completed") | .item
      | select((.type == "tool_call" or .type == "function_call") and ((.name // "") | test("spawn_agent$")))
      | select(((.arguments // .input // {}) | tostring) | contains("gpt-5.6-terra"))
      | select(((.arguments // .input // {}) | tostring) | contains("reasoning_effort"))' "$LIVE" | head -n 1)"
    [ -n "$CHILD_EVENT" ] && pass "Codex child spawn event binds requested model/effort" || fail "missing bound child spawn event"
    LIFECYCLE_EVENT="$(jq -c 'select(.type == "item.completed") | .item
      | select((.type == "tool_call" or .type == "function_call") and ((.name // "") | test("(wait_agent|list_agents|interrupt_agent)$")))' "$LIVE" | head -n 1)"
    [ -n "$LIFECYCLE_EVENT" ] && pass "Codex child has a concrete lifecycle disposition event" || fail "missing child lifecycle event"
  fi
else
  echo "SKIP [codex-native-child] set AUTOPILOT_CODEX_NATIVE_CHILD_PROBE=1 for live probe"
fi

finalize_test
