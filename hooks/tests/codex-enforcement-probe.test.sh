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

finalize_test
