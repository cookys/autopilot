#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROBE_ROOT="$REPO_ROOT/platforms/codex/hook-probe"
PROBE_PLUGIN="$PROBE_ROOT/plugin"
PROBE_MARKETPLACE="$PROBE_ROOT/.agents/plugins/marketplace.json"
MAIN_CODEX_PLUGIN="$REPO_ROOT/platforms/codex/plugin"

assert_file_exists "$MAIN_CODEX_PLUGIN/hooks/hooks.json" "Main Codex package exposes the production PostCompact manifest"
assert_file_exists "$MAIN_CODEX_PLUGIN/hooks/post-compact.js" "Main Codex package exposes the production PostCompact adapter"
assert_file_exists "$PROBE_PLUGIN/.codex-plugin/plugin.json" "Codex hook probe manifest exists"
assert_file_exists "$PROBE_PLUGIN/hooks/hooks.json" "Codex hook probe hooks manifest exists"
assert_file_exists "$PROBE_PLUGIN/hooks/probe.js" "Codex hook probe script exists"
assert_file_exists "$PROBE_MARKETPLACE" "Codex hook probe local marketplace exists"

OUT="$(node - "$PROBE_PLUGIN" "$PROBE_MARKETPLACE" "$PROBE_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');

const [pluginDir, marketplacePath, marketplaceRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.codex-plugin', 'plugin.json'), 'utf8'));
const hooks = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));

function print(key, value) {
  console.log(`${key}=${value}`);
}

print('manifest_name', manifest.name);
print('manifest_hooks', manifest.hooks);
print('manifest_has_skills', Object.prototype.hasOwnProperty.call(manifest, 'skills'));
print('manifest_capabilities', Array.isArray(manifest.interface.capabilities) ? manifest.interface.capabilities.join(',') : 'bad');
for (const eventName of ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop']) {
  print(`has_${eventName}`, Array.isArray(hooks.hooks[eventName]));
}
const postCompactEntry = hooks.hooks.PostCompact?.[0];
const postCompactHook = postCompactEntry?.hooks?.[0];
print('postcompact_declaration_exact',
  hooks.hooks.PostCompact?.length === 1 &&
  postCompactEntry?.matcher === 'manual|auto' &&
  postCompactEntry?.hooks?.length === 1 &&
  postCompactHook?.type === 'command' &&
  postCompactHook?.command === 'node "${PLUGIN_ROOT}/hooks/probe.js"');
const serializedHooks = JSON.stringify(hooks);
const commands = Object.values(hooks.hooks).flatMap((entries) =>
  entries.flatMap((entry) => (entry.hooks || []).map((hook) => hook.command))
);
const toolMatchers = [...hooks.hooks.PreToolUse, ...hooks.hooks.PostToolUse].map((entry) => entry.matcher);
print('uses_plugin_root', serializedHooks.includes('${PLUGIN_ROOT}/hooks/probe.js'));
print('quotes_plugin_root', commands.every((command) => command === 'node "${PLUGIN_ROOT}/hooks/probe.js"'));
print('tool_matchers_regex_safe', toolMatchers.every((matcher) => matcher === '.*' && Boolean(new RegExp(matcher))));
print('contains_continue_false', serializedHooks.includes('"continue":false') || serializedHooks.includes('"continue": false'));
print('marketplace_name', marketplace.name);
print('marketplace_plugins', Array.isArray(marketplace.plugins) ? marketplace.plugins.length : 'bad');
const entry = marketplace.plugins.find((plugin) => plugin && plugin.name === 'autopilot-hook-probe');
print('marketplace_entry_exists', Boolean(entry));
print('marketplace_path', entry && entry.source && entry.source.path);
print('marketplace_version_matches', entry && entry.version === manifest.version);
if (entry && entry.source && entry.source.path) {
  print('marketplace_path_points_to_plugin', fs.realpathSync(path.join(marketplaceRoot, entry.source.path)) === fs.realpathSync(pluginDir));
}
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex hook probe JSON inspection exits 0"
assert_contains "$OUT" "manifest_name=autopilot-hook-probe" "Probe manifest uses stable package name"
assert_contains "$OUT" "manifest_hooks=./hooks/hooks.json" "Probe manifest explicitly points at hooks manifest"
assert_contains "$OUT" "manifest_has_skills=false" "Probe package does not bundle skills"
assert_contains "$OUT" "manifest_capabilities=Read" "Probe package declares read-only capability"
assert_contains "$OUT" "has_SessionStart=true" "Probe config includes SessionStart"
assert_contains "$OUT" "has_PreToolUse=true" "Probe config includes PreToolUse"
assert_contains "$OUT" "has_PostToolUse=true" "Probe config includes PostToolUse"
assert_contains "$OUT" "has_PreCompact=true" "Probe config includes PreCompact"
assert_contains "$OUT" "has_PostCompact=true" "Probe config includes PostCompact"
assert_contains "$OUT" "postcompact_declaration_exact=true" "Probe PostCompact declaration has exact matcher and command hook"
assert_contains "$OUT" "has_Stop=true" "Probe config includes Stop"
assert_contains "$OUT" "uses_plugin_root=true" "Probe hook commands resolve through PLUGIN_ROOT"
assert_contains "$OUT" "quotes_plugin_root=true" "Probe hook commands quote PLUGIN_ROOT path"
assert_contains "$OUT" "tool_matchers_regex_safe=true" "Probe tool hook matchers use regex-safe wildcard"
assert_contains "$OUT" "contains_continue_false=false" "Probe hooks do not declare blocking output in config"
assert_contains "$OUT" "marketplace_name=autopilot-hook-probe-local" "Probe marketplace has stable local name"
assert_contains "$OUT" "marketplace_plugins=1" "Probe marketplace has one plugin"
assert_contains "$OUT" "marketplace_entry_exists=true" "Probe marketplace exposes probe plugin"
assert_contains "$OUT" "marketplace_path=./plugin" "Probe marketplace points to local plugin"
assert_contains "$OUT" "marketplace_version_matches=true" "Probe marketplace version follows probe manifest"
assert_contains "$OUT" "marketplace_path_points_to_plugin=true" "Probe marketplace path resolves to plugin root"

PROBE_HOME="$TEST_TMP/probe-home"
PROBE_DATA="$TEST_TMP/probe-data"
mkdir -p "$PROBE_HOME" "$PROBE_DATA"
PAYLOAD='{"session_id":"SECRET_SESSION","hook_event_name":"PostToolUse","cwd":"/tmp/SECRET_PATH/repo","tool_name":"SECRET_TOOL","tool_input":{"SECRET_INPUT_KEY":"SECRET_DO_NOT_STORE"},"tool_output":{"SECRET_OUTPUT_KEY":"SECRET_DO_NOT_STORE"},"model":"SECRET_MODEL","permission_mode":"SECRET_PERMISSION","turn_id":"SECRET_TURN","transcript_path":"/tmp/SECRET_TRANSCRIPT.jsonl","SECRET_FIELD":"x"}'
STDOUT_FILE="$TEST_TMP/probe.stdout"
STDERR_FILE="$TEST_TMP/probe.stderr"
HOME="$PROBE_HOME" PLUGIN_ROOT="$PROBE_PLUGIN" PLUGIN_DATA="$PROBE_DATA" CODEX_HOME="$TEST_TMP/codex-home" \
  node "$PROBE_PLUGIN/hooks/probe.js" >"$STDOUT_FILE" 2>"$STDERR_FILE" <<< "$PAYLOAD"
EXIT=$?
assert_exit_code "$EXIT" 0 "Probe script exits 0 on normal payload"
assert_eq "$(cat "$STDOUT_FILE")" "" "Probe script writes no stdout"

EVENT_FILE="$PROBE_DATA/autopilot-codex-hook-probe/events.jsonl"
assert_file_exists "$EVENT_FILE" "Probe script writes JSONL artifact under PLUGIN_DATA"
mode=$(stat -c '%a' "$EVENT_FILE" 2>/dev/null || stat -f '%Lp' "$EVENT_FILE" 2>/dev/null)
assert_eq "$mode" "600" "Probe artifact mode is 0600"

PROBE_OUT="$(PLUGIN_ROOT="$PROBE_PLUGIN" node - "$EVENT_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').trim().split(/\n+/);
const event = JSON.parse(lines[0]);
console.log(`line_count=${lines.length}`);
console.log(`schema_version=${event.schema_version}`);
console.log(`platform=${event.platform}`);
console.log(`event=${event.event}`);
console.log(`host_event=${event.host_event}`);
console.log(`session_id=${event.session_id}`);
console.log(`cwd=${event.cwd}`);
console.log(`tool=${event.tool}`);
console.log(`tool_input=${event.tool_input}`);
console.log(`tool_output=${event.tool_output}`);
console.log(`tool_input_shape=${event.probe.tool_input_shape.type}:${event.probe.tool_input_shape.key_count}`);
console.log(`tool_output_shape=${event.probe.tool_output_shape.type}:${event.probe.tool_output_shape.key_count}`);
console.log(`model=${event.model}`);
console.log(`permission_mode=${event.permission_mode}`);
console.log(`turn_id=${event.turn_id}`);
console.log(`plugin_root_present=${event.probe.env_present.PLUGIN_ROOT}`);
console.log(`plugin_data_present=${event.probe.env_present.PLUGIN_DATA}`);
console.log(`codex_home_present=${event.probe.env_present.CODEX_HOME}`);
console.log(`cwd_present=${event.probe.cwd_present}`);
console.log(`model_present=${event.probe.field_presence.model}`);
console.log(`tool_name_present=${event.probe.field_presence.tool_name}`);
console.log(`transcript_path=${event.session.transcript_path}`);
console.log(`transcript_path_present=${event.probe.transcript_path_present}`);
console.log(`raw_present=${Object.prototype.hasOwnProperty.call(event, 'raw')}`);
console.log(`payload_values_leaked=${JSON.stringify(event).includes('SECRET_DO_NOT_STORE')}`);
console.log(`identifier_values_leaked=${['SECRET_SESSION', 'SECRET_MODEL', 'SECRET_PERMISSION', 'SECRET_TURN', 'SECRET_TOOL'].some((secret) => JSON.stringify(event).includes(secret))}`);
console.log(`key_names_leaked=${['SECRET_FIELD', 'SECRET_INPUT_KEY', 'SECRET_OUTPUT_KEY'].some((secret) => JSON.stringify(event).includes(secret))}`);
console.log(`path_values_leaked=${JSON.stringify(event).includes('SECRET_PATH') || JSON.stringify(event).includes('SECRET_TRANSCRIPT')}`);
console.log(`plugin_root_value_leaked=${JSON.stringify(event).includes(process.env.PLUGIN_ROOT || 'UNSET')}`);
NODE
)"
assert_contains "$PROBE_OUT" "line_count=1" "Probe writes one JSONL row"
assert_contains "$PROBE_OUT" "schema_version=1" "Probe row uses normalized schema version"
assert_contains "$PROBE_OUT" "platform=codex" "Probe row records Codex platform"
assert_contains "$PROBE_OUT" "event=post_tool_use" "Probe row normalizes event name"
assert_contains "$PROBE_OUT" "host_event=PostToolUse" "Probe row preserves host event"
assert_contains "$PROBE_OUT" "session_id=null" "Probe row omits session id values"
assert_contains "$PROBE_OUT" "cwd=null" "Probe row omits cwd path values"
assert_contains "$PROBE_OUT" "tool=null" "Probe row omits tool name values"
assert_contains "$PROBE_OUT" "tool_input=null" "Probe row omits raw tool input values"
assert_contains "$PROBE_OUT" "tool_output=null" "Probe row omits raw tool output values"
assert_contains "$PROBE_OUT" "tool_input_shape=object:1" "Probe row records tool input shape only"
assert_contains "$PROBE_OUT" "tool_output_shape=object:1" "Probe row records tool output shape only"
assert_contains "$PROBE_OUT" "model=null" "Probe row omits model values"
assert_contains "$PROBE_OUT" "permission_mode=null" "Probe row omits permission mode values"
assert_contains "$PROBE_OUT" "turn_id=null" "Probe row omits turn id values"
assert_contains "$PROBE_OUT" "plugin_root_present=true" "Probe row records PLUGIN_ROOT presence"
assert_contains "$PROBE_OUT" "plugin_data_present=true" "Probe row records PLUGIN_DATA presence"
assert_contains "$PROBE_OUT" "codex_home_present=true" "Probe row records CODEX_HOME presence"
assert_contains "$PROBE_OUT" "cwd_present=true" "Probe row records cwd presence"
assert_contains "$PROBE_OUT" "model_present=true" "Probe row records model presence"
assert_contains "$PROBE_OUT" "tool_name_present=true" "Probe row records tool-name presence"
assert_contains "$PROBE_OUT" "transcript_path=null" "Probe row omits transcript path values"
assert_contains "$PROBE_OUT" "transcript_path_present=true" "Probe row records transcript path presence"
assert_contains "$PROBE_OUT" "raw_present=false" "Probe row does not persist raw payload"
assert_contains "$PROBE_OUT" "payload_values_leaked=false" "Probe row does not persist tool payload values"
assert_contains "$PROBE_OUT" "identifier_values_leaked=false" "Probe row does not persist payload identifier values"
assert_contains "$PROBE_OUT" "key_names_leaked=false" "Probe row does not persist payload key names"
assert_contains "$PROBE_OUT" "path_values_leaked=false" "Probe row does not persist cwd or transcript path values"
assert_contains "$PROBE_OUT" "plugin_root_value_leaked=false" "Probe row does not store plugin root env value"

node - "$EVENT_FILE" <<'NODE'
const fs = require('fs');
fs.writeFileSync(process.argv[2], 'x'.repeat(64), { mode: 0o600 });
NODE
HOME="$PROBE_HOME" PLUGIN_ROOT="$PROBE_PLUGIN" PLUGIN_DATA="$PROBE_DATA" CODEX_HOME="$TEST_TMP/codex-home" AUTOPILOT_HOOK_PROBE_MAX_BYTES=16 \
  node "$PROBE_PLUGIN/hooks/probe.js" >"$STDOUT_FILE" 2>"$STDERR_FILE" <<< "$PAYLOAD"
EXIT=$?
assert_exit_code "$EXIT" 0 "Probe script exits 0 while rotating an oversized event log"
assert_file_exists "$EVENT_FILE.1" "Probe rotates oversized event log to .1"
ROTATE_OUT="$(node - "$EVENT_FILE" "$EVENT_FILE.1" <<'NODE'
const fs = require('fs');
const [active, rotated] = process.argv.slice(2);
function mode(file) {
  return (fs.statSync(file).mode & 0o777).toString(8);
}
console.log(`active_lines=${fs.readFileSync(active, 'utf8').trim().split(/\n+/).length}`);
console.log(`rotated_size=${fs.statSync(rotated).size}`);
console.log(`active_mode=${mode(active)}`);
console.log(`rotated_mode=${mode(rotated)}`);
NODE
)"
assert_contains "$ROTATE_OUT" "active_lines=1" "Probe starts a fresh event log after rotation"
assert_contains "$ROTATE_OUT" "rotated_size=64" "Probe keeps one rotated event log"
assert_contains "$ROTATE_OUT" "active_mode=600" "Probe rotated active log keeps 0600 mode"
assert_contains "$ROTATE_OUT" "rotated_mode=600" "Probe rotated backup keeps 0600 mode"

ALIAS_DATA="$TEST_TMP/probe-alias-data"
mkdir -p "$ALIAS_DATA"
HOME="$PROBE_HOME" PLUGIN_ROOT="$PROBE_PLUGIN" PLUGIN_DATA="$ALIAS_DATA" CODEX_HOME="$TEST_TMP/codex-home" \
  node "$PROBE_PLUGIN/hooks/probe.js" >"$STDOUT_FILE" 2>"$STDERR_FILE" <<< '{"event":"PreToolUse"}'
EXIT=$?
assert_exit_code "$EXIT" 0 "Probe script exits 0 on alternate event-name field"
ALIAS_OUT="$(node - "$ALIAS_DATA/autopilot-codex-hook-probe/events.jsonl" <<'NODE'
const fs = require('fs');
const event = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').trim());
console.log(`alias_event=${event.event}`);
console.log(`alias_host_event=${event.host_event}`);
console.log(`alias_field_event=${event.probe.field_presence.event}`);
console.log(`alias_field_hook_event_name=${event.probe.field_presence.hook_event_name}`);
NODE
)"
assert_contains "$ALIAS_OUT" "alias_event=pre_tool_use" "Probe normalizes alternate event field"
assert_contains "$ALIAS_OUT" "alias_host_event=PreToolUse" "Probe preserves known alternate host event"
assert_contains "$ALIAS_OUT" "alias_field_event=true" "Probe records alternate event field presence"
assert_contains "$ALIAS_OUT" "alias_field_hook_event_name=false" "Probe records missing hook_event_name field"

if command -v codex >/dev/null 2>&1; then
  CODEX_HOME_DIR="$TEST_TMP/codex-probe-home"
  mkdir -p "$CODEX_HOME_DIR/.codex"
  ADD_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin marketplace add "$PROBE_ROOT" --json 2>"$TEST_TMP/codex-probe-marketplace.stderr")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can add the hook probe marketplace in a sandboxed home"
  assert_contains "$ADD_OUT" "autopilot-hook-probe-local" "Codex marketplace add output includes probe marketplace"

  LIST_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin list --marketplace autopilot-hook-probe-local --available --json 2>"$TEST_TMP/codex-probe-list.stderr")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can list the hook probe marketplace"
  assert_contains "$LIST_OUT" "\"pluginId\": \"autopilot-hook-probe@autopilot-hook-probe-local\"" "Codex CLI discovers hook probe plugin"

  ADD_PLUGIN_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin add autopilot-hook-probe@autopilot-hook-probe-local --json 2>"$TEST_TMP/codex-probe-add.stderr")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can install the hook probe plugin"
  assert_contains "$ADD_PLUGIN_OUT" "\"pluginId\": \"autopilot-hook-probe@autopilot-hook-probe-local\"" "Codex plugin add reports installed hook probe"
fi

# Committed, rerunnable Codex slash/skill-entry behavioral probe. It is opt-in
# because it spends a live model call; absence/quota self-skips, while a live
# unsupported surface fails closed.
if [ "${AUTOPILOT_CODEX_SLASH_PROBE:-0}" = "1" ]; then
  if ! command -v codex >/dev/null 2>&1; then
    echo "SKIP [codex-slash-entry] codex CLI absent"
  else
    MODEL="${AUTOPILOT_CODEX_PROBE_MODEL:-gpt-5.6-sol}"
    LIVE_LOG="$TEST_TMP/codex-slash-entry.jsonl"
    set +e
    timeout 180 codex exec --json -m "$MODEL" \
      'Use the autopilot:l5 skill. Read its MUST-READ hetero-impl-loop reference with a shell command, then reply only CODEX_SLASH_ENTRY_OK.' \
      >"$LIVE_LOG" 2>&1
    LIVE_RC=$?
    set -e
    if [ "$LIVE_RC" -ne 0 ] && grep -Eqi 'usage limit|quota|rate.limit|capacity' "$LIVE_LOG"; then
      echo "SKIP [codex-slash-entry] live quota unavailable"
    else
      assert_eq "0" "$LIVE_RC" "Codex slash-entry probe exits cleanly"
      EXEC_EVIDENCE="$(jq -c 'select(.type == "item.completed")
        | .item
        | select(.type == "command_execution")
        | select((.command // "") | contains("hetero-impl-loop.md"))
        | select(.exit_code == 0)
        | select((.aggregated_output // "") | contains("hetero implementation loop (per-level reference)"))' "$LIVE_LOG" | head -n 1)"
      [ -n "$EXEC_EVIDENCE" ] \
        && pass "Codex slash-entry has a concrete successful MUST-READ command event" \
        || fail "Codex slash-entry lacks a successful command/output event for the installed MUST-READ"
      assert_contains "$(cat "$LIVE_LOG")" "CODEX_SLASH_ENTRY_OK" "Codex probe completes the skill entry"
    fi
  fi
else
  echo "SKIP [codex-slash-entry] set AUTOPILOT_CODEX_SLASH_PROBE=1 for live probe"
fi

D1_RECEIPT="$REPO_ROOT/docs/projects/_archive/2026-08-04-platform-capability-trigger-activation/evidence/platform-capabilities.json"
assert_file_exists "$D1_RECEIPT" "D1 durable platform capability receipt exists"
D1_OUT="$(node - "$D1_RECEIPT" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const d3 = value.consumer_manifest.consumers.find((consumer) => consumer.consumer_id === 'D3');
const claims = d3.required_claim_ids.map((id) => value.claims.find((claim) => claim.claim_id === id));
console.log(`d3_count=${claims.length}`);
console.log(`d3_all_validated=${claims.every((claim) => claim && claim.status === 'validated')}`);
console.log(`d3_capabilities=${claims.map((claim) => claim.capability_id).sort().join(',')}`);
console.log(`d3_version=${claims.every((claim) => claim.target_identity.cli_version === '0.146.0')}`);
console.log(`d3_host_digest=${claims.every((claim) => claim.live_evidence.probe_output_sha256 === '89d76cd6d7dc8d815761d547e3325e9dcd6858a29d259093ef27a22cbb1fbd23')}`);
NODE
)"
assert_contains "$D1_OUT" "d3_count=4" "D3 owns exactly four PostCompact claims"
assert_contains "$D1_OUT" "d3_all_validated=true" "D3 PostCompact claims are all validated"
assert_contains "$D1_OUT" "d3_capabilities=codex-postcompact-failure-boundary,codex-postcompact-matcher,codex-postcompact-payload,codex-postcompact-registration" "D3 capability set is exact"
assert_contains "$D1_OUT" "d3_version=true" "D3 claims bind installed codex-cli 0.146.0"
assert_contains "$D1_OUT" "d3_host_digest=true" "D3 claims bind the manual+auto host-probe digest"

assert_file_exists "$MAIN_CODEX_PLUGIN/schemas/platform-capability-claims.schema.json" "Codex mirror carries capability claim schema"
assert_file_exists "$MAIN_CODEX_PLUGIN/scripts/platform-capability-claims.js" "Codex mirror carries capability claim validator"
assert_file_exists "$MAIN_CODEX_PLUGIN/scripts/probe-harness-capabilities.sh" "Codex mirror carries deterministic harness probe"
cmp -s "$REPO_ROOT/schemas/platform-capability-claims.schema.json" "$MAIN_CODEX_PLUGIN/schemas/platform-capability-claims.schema.json"
assert_exit_code "$?" 0 "Codex capability schema mirror is byte-equal"
cmp -s "$REPO_ROOT/scripts/platform-capability-claims.js" "$MAIN_CODEX_PLUGIN/scripts/platform-capability-claims.js"
assert_exit_code "$?" 0 "Codex capability validator mirror is byte-equal"
cmp -s "$REPO_ROOT/scripts/probe-harness-capabilities.sh" "$MAIN_CODEX_PLUGIN/scripts/probe-harness-capabilities.sh"
assert_exit_code "$?" 0 "Codex harness probe mirror is byte-equal"

finalize_test
