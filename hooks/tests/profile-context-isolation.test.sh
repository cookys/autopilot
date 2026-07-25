#!/usr/bin/env bash
set -uo pipefail

TEST_NAME="profile-context-isolation"
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/measure-profile-context.js"
BASELINE="$REPO_ROOT/docs/projects/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json"

json_get() {
  node -e '
    const fs = require("fs");
    let value = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const key of process.argv[1].split(".")) {
      value = Array.isArray(value) ? value[Number(key)] : value[key];
    }
    process.stdout.write(value === null ? "null" : String(value));
  ' "$1"
}

run_cli() {
  local stdout_file="$TEST_TMP/stdout"
  local stderr_file="$TEST_TMP/stderr"
  node "$CLI" "$@" >"$stdout_file" 2>"$stderr_file"
  CLI_EXIT=$?
  CLI_STDOUT="$(cat "$stdout_file")"
  CLI_STDERR="$(cat "$stderr_file")"
}

# Source accounting is deterministic and conservative.
printf '%s\n' '# Fixture' '- MUST retain this rule.' >"$TEST_TMP/source.md"
run_cli source --file "$TEST_TMP/source.md" --divisor 2
assert_exit_code "$CLI_EXIT" 0 "source exits zero"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get files.0.estimated_tokens)" "18" \
  "source estimate rounds upward"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get files.0.rule_candidate_occurrences)" "1" \
  "source extracts conservative rule candidate"

# Discovery routing prose in frontmatter is part of the rule surface.
printf '%s\n' '---' 'name: fixture' 'description: >' \
  '  Use when implementation starts; not for review.' '---' '# Fixture' \
  >"$TEST_TMP/frontmatter.md"
run_cli source --file "$TEST_TMP/frontmatter.md"
assert_exit_code "$CLI_EXIT" 0 "frontmatter source exits zero"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get files.0.rule_candidate_occurrences)" "1" \
  "frontmatter routing prose is classified"

# A complete, content-addressed inventory passes.
source_hash="$(sha256sum "$TEST_TMP/source.md" | awk '{print $1}')"
printf '%s\n' '{"schema_version":1,"sources":["source.md"]}' >"$TEST_TMP/source-manifest.json"
printf '%s\n' \
  '{"schema_version":1,"duplicate_rule_sets":[],"sources":[{"path":"source.md","sha256":"'"$source_hash"'","segments":[{"id":"fixture.core","category":"core","start_line":1,"end_line":3}]}]}' \
  >"$TEST_TMP/inventory.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 0 "complete inventory exits zero"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get category_totals.core)" "1" \
  "inventory attributes the unit once"

# A gap and an overlap are named fail-closed outcomes.
printf '%s\n' \
  '{"schema_version":1,"duplicate_rule_sets":[],"sources":[{"path":"source.md","sha256":"'"$source_hash"'","segments":[{"id":"fixture.gap","category":"core","start_line":1,"end_line":1}]}]}' \
  >"$TEST_TMP/inventory.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "uncovered rule fails"
assert_contains "$CLI_STDERR" "UNCOVERED_RULES" "uncovered error is named"

printf '%s\n' \
  '{"schema_version":1,"duplicate_rule_sets":[],"sources":[{"path":"source.md","sha256":"'"$source_hash"'","segments":[{"id":"fixture.a","category":"core","start_line":1,"end_line":3},{"id":"fixture.b","category":"guided","start_line":2,"end_line":3}]}]}' \
  >"$TEST_TMP/inventory.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "multiple owners fail"
assert_contains "$CLI_STDERR" "OVERLAPPING_SEGMENTS" "overlap error is named"

# Source drift invalidates the inventory instead of silently moving line ownership.
printf '%s\n' \
  '{"schema_version":1,"duplicate_rule_sets":[],"sources":[{"path":"source.md","sha256":"0000000000000000000000000000000000000000000000000000000000000000","segments":[]}]}' \
  >"$TEST_TMP/inventory.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "hash drift fails"
assert_contains "$CLI_STDERR" "SOURCE_HASH_DRIFT" "hash drift error is named"

# The source universe is independent, and copied rules require an explicit canonical owner.
printf '%s\n' '- MUST retain this rule.' >"$TEST_TMP/source-copy.md"
copy_hash="$(sha256sum "$TEST_TMP/source-copy.md" | awk '{print $1}')"
printf '%s\n' '{"schema_version":1,"sources":["source.md","source-copy.md"]}' \
  >"$TEST_TMP/source-manifest.json"
printf '%s\n' \
  '{"schema_version":1,"duplicate_rule_sets":[],"sources":[{"path":"source.md","sha256":"'"$source_hash"'","segments":[{"id":"fixture.core","category":"core","start_line":1,"end_line":3}]},{"path":"source-copy.md","sha256":"'"$copy_hash"'","segments":[{"id":"fixture.copy","category":"core","start_line":1,"end_line":2}]}]}' \
  >"$TEST_TMP/inventory.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "undeclared copied rule fails"
assert_contains "$CLI_STDERR" "UNDECLARED_DUPLICATE_RULE" "copied rule error is named"

printf '%s\n' '{"schema_version":1,"sources":["source.md","source-copy.md","missing.md"]}' \
  >"$TEST_TMP/source-manifest.json"
run_cli inventory --inventory inventory.json --source-manifest source-manifest.json --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "source set drift fails"
assert_contains "$CLI_STDERR" "SOURCE_SET_DRIFT" "source set drift error is named"

# A sanitized Codex trace reports catalog cost and exact-body visibility without echoing bodies.
printf '%s\n' 'PROFILE_SECRET_BODY' >"$TEST_TMP/component.md"
node - "$TEST_TMP/trace.jsonl" "$TEST_TMP/component.md" <<'NODE'
const fs = require('fs');
const [file, componentFile] = process.argv.slice(2);
const component = fs.readFileSync(componentFile, 'utf8');
const skills = '<skills_instructions>\n- autopilot:a: first\n- autopilot:b: second\n</skills_instructions>';
const rows = [
  { type: 'session_meta', payload: { id: 'secret-session-id', cli_version: '9.9.9' } },
  { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: skills }] } },
  { type: 'response_item', payload: { type: 'message', role: 'developer', content: [
    { type: 'input_text', text: 'PROFILE_' },
    { type: 'input_text', text: 'SECRET_BODY\n' },
  ] } },
  { type: 'response_item', payload: { type: 'function_call_output', output: component } },
  { type: 'event_msg', payload: { type: 'token_count', info: {
    model_context_window: 100000,
    last_token_usage: { input_tokens: 10, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 2, total_tokens: 35 },
  } } },
];
fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n{malformed\n`);
NODE
run_cli codex-trace --trace "$TEST_TMP/trace.jsonl" \
  --component "guided=$TEST_TMP/component.md" --repo /
assert_exit_code "$CLI_EXIT" 1 "malformed trace fails closed by default"
assert_contains "$CLI_STDERR" "TRACE_MALFORMED" "malformed trace error is named"

run_cli codex-trace --trace "$TEST_TMP/trace.jsonl" \
  --component "guided=$TEST_TMP/component.md" --repo / --allow-malformed
assert_exit_code "$CLI_EXIT" 0 "codex trace exits zero"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get skill_catalog.observations.0.entry_count)" "2" \
  "catalog entries counted"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get components.0.developer_prompt_occurrences)" "1" \
  "fragmented developer component visibility counted"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get components.0.other_trace_occurrences)" "1" \
  "non-prompt occurrence remains separate"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get components.0.absence_claim_eligible)" "false" \
  "trace occurrence scan cannot prove full-session absence"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get evidence.malformed_lines)" "1" \
  "malformed trace lines are counted"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get evidence.integrity)" "partial" \
  "explicit malformed override remains visibly partial"
assert_not_contains "$CLI_STDOUT" "PROFILE_SECRET_BODY" "trace output is content-free"
assert_not_contains "$CLI_STDOUT" "secret-session-id" "session identifier is not emitted"

# Missing catalog evidence remains explicitly unverified.
printf '%s\n' '{"type":"session_meta","payload":{"cli_version":"1"}}' >"$TEST_TMP/empty-trace.jsonl"
run_cli codex-trace --trace "$TEST_TMP/empty-trace.jsonl"
assert_exit_code "$CLI_EXIT" 0 "empty trace is still parseable"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get skill_catalog.status)" "unverified" \
  "missing catalog is not reported as absent"

# Oversized traces are rejected before their body is read.
truncate -s 17 "$TEST_TMP/too-large.jsonl"
run_cli codex-trace --trace "$TEST_TMP/too-large.jsonl" --max-trace-bytes 16
assert_exit_code "$CLI_EXIT" 1 "oversized trace fails"
assert_contains "$CLI_STDERR" "TRACE_TOO_LARGE" "oversized trace error is named"

# The repository inventory is itself part of the gate.
run_cli inventory --inventory profiles/rule-inventory.json \
  --source-manifest profiles/rule-source-manifest.json --repo "$REPO_ROOT"
assert_exit_code "$CLI_EXIT" 0 "repository rule inventory validates"
printf '%s\n' "$CLI_STDOUT" >"$TEST_TMP/repo-inventory-result.json"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get sources.0.path)" "skills/ceo-agent/SKILL.md" \
  "repository inventory covers CEO source"
assert_eq "$(printf '%s' "$CLI_STDOUT" | json_get sources.1.path)" "skills/dev-flow/SKILL.md" \
  "repository inventory covers dev-flow source"
node - "$BASELINE" "$TEST_TMP/repo-inventory-result.json" "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [baselinePath, inventoryPath, root] = process.argv.slice(2);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const measure = require(path.join(root, 'scripts', 'measure-profile-context.js'));
const isSha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = JSON.stringify(baseline.rule_inventory.category_totals)
  === JSON.stringify(inventory.category_totals);
const sourceFilesValid = baseline.source_surface.files.length === 2
  && baseline.source_surface.files.every((record) => {
    const stats = measure.sourceStats(path.join(root, record.path));
    return isSha(record.sha256)
      && record.sha256 === stats.sha256
      && record.bytes === stats.bytes
      && record.words === stats.words
      && record.estimated_tokens === stats.estimated_tokens
      && record.rule_candidate_occurrences === stats.rule_candidate_occurrences;
  });
const codex = baseline.hosts.find((host) => host.host === 'codex');
const traces = codex && codex.evidence && codex.evidence.traces;
const tracesValid = Array.isArray(traces)
  && traces.length >= 2
  && new Set(traces.map((trace) => trace.trace_sha256)).size === traces.length
  && traces.every((trace) => isSha(trace.trace_sha256)
    && trace.integrity === 'complete'
    && trace.malformed_lines === 0
    && Number.isInteger(trace.catalog_snapshots) && trace.catalog_snapshots > 0
    && Number.isInteger(trace.catalog_min_bytes) && trace.catalog_min_bytes > 0
    && Number.isInteger(trace.catalog_max_bytes)
    && trace.catalog_max_bytes >= trace.catalog_min_bytes);
const catalogValid = tracesValid
  && codex.skill_catalog.entries > 0
  && codex.skill_catalog.min_bytes === Math.min(...traces.map((trace) => trace.catalog_min_bytes))
  && codex.skill_catalog.max_bytes === Math.max(...traces.map((trace) => trace.catalog_max_bytes))
  && codex.skill_catalog.max_heuristic_estimated_tokens
    === Math.ceil(codex.skill_catalog.max_bytes / 3.5)
  && isSha(codex.skill_catalog.latest_content_hash)
  && codex.skill_catalog.exact_token_measurement === false
  && codex.skill_catalog.estimate_can_satisfy_budget === false;
const grok = baseline.hosts.find((host) => host.host === 'grok');
const grokValid = grok
  && isSha(grok.evidence.raw_sha256)
  && grok.visibility === 'discovery_only'
  && grok.discovered_skills > 0
  && grok.autopilot_rows >= grok.autopilot_unique_names
  && grok.autopilot_duplicate_names
    === grok.autopilot_rows - grok.autopilot_unique_names;
if (!same
  || !sourceFilesValid
  || !tracesValid
  || !catalogValid
  || !grokValid
  || baseline.rule_inventory.canonical_rules !== inventory.canonical_rules
  || baseline.rule_inventory.rule_candidate_occurrences
    !== inventory.rule_candidate_occurrences
  || baseline.rule_inventory.source_manifest !== inventory.source_manifest
  || baseline.packaging_decision.artifact_strategy
    !== 'generated_profile_specific_payloads_from_canonical_source'
  || codex.absence_claim_eligible !== false) process.exitCode = 1;
NODE
assert_exit_code "$?" 0 "checked-in baseline matches inventory and fail-closed packaging evidence"

# Lexical repo containment cannot be bypassed by a symlink.
ln -s /etc/hosts "$TEST_TMP/outside-link"
run_cli source --file "$TEST_TMP/source.md" --divisro 1
assert_exit_code "$CLI_EXIT" 2 "unknown option fails as usage"
assert_contains "$CLI_STDERR" "unsupported option" "unknown option error is named"
run_cli codex-trace --trace "$TEST_TMP/empty-trace.jsonl" \
  --component "outside=$TEST_TMP/outside-link" --repo "$TEST_TMP"
assert_exit_code "$CLI_EXIT" 1 "component symlink escape fails"
assert_contains "$CLI_STDERR" "PATH_ESCAPE" "symlink escape error is named"

node "$CLI" --help >/dev/null 2>&1
assert_exit_code "$?" 0 "help exits zero"
node "$CLI" unknown >/dev/null 2>&1
assert_exit_code "$?" 2 "unknown command exits usage"

finalize_test
