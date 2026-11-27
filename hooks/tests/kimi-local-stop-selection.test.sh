#!/usr/bin/env bash
# Auto seats must skip local Kimi, including stale topology caches. No live CLI.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_KIMI_LOCAL_ALLOW
export HOME="$HOOK_HOME"
export AUTOPILOT_KIMI_BROKER_SOCK="$TEST_SHORT_TMP/absent.sock"
node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const { qualifyingEngines, PACE_SCHEMA } = require(path.join(root, 'scripts/noncq'));
const fallback = require(path.join(root, 'scripts/lib/seat-fallback'));
const topology = require(path.join(root, 'scripts/lib/topology-runners'));
const kimi = { key: 'kimi', engine: 'kimi-code/k3', model: 'kimi-code/k3', runner: 'kimi', effort: 'high' };
const grok = { key: 'grok', engine: 'grok-4.7', model: 'grok-4.7', runner: 'grok', effort: 'high' };
const rolesPath = path.join(tmp, 'roles.json');
const poolsPath = path.join(tmp, 'pools.json');
fs.writeFileSync(rolesPath, JSON.stringify({ fallback: { reviewer: [kimi, grok] }, priority: { implementer: ['kimi', 'grok'] } }));
fs.writeFileSync(poolsPath, JSON.stringify({ kimi, grok }));
const fallbackOpts = { rolesPath, poolsPath, pacePath: path.join(tmp, 'missing-pace') };
const pace = { schema: PACE_SCHEMA, rows: [{ pool: 'kimi', stale: false, status: 'ok', hours_to_reset: 6, used_pct: 10 }] };
const cached = Object.fromEntries(topology.RUNG_LISTS.map((key) => [key, [kimi, grok]]));
const cachePath = path.join(tmp, 'cached-topology.json');
fs.writeFileSync(cachePath, JSON.stringify(cached));
for (const allow of [false, true]) {
  if (allow) process.env.AUTOPILOT_KIMI_LOCAL_ALLOW = '1';
  else delete process.env.AUTOPILOT_KIMI_LOCAL_ALLOW;
  assert.equal(qualifyingEngines(pace, { kimi }).has('kimi'), allow, 'noncq auto eligibility');
  assert.equal(fallback.reviewerFallbackChain(fallbackOpts)[0].runner, 'grok', 'reviewer fallback never offers a CN-operator rung (cn gate), allow or not');
  assert.equal(fallback.implementerFallbackChain(fallbackOpts)[0].runner, allow ? 'kimi' : 'grok', 'implementer fallback');
  const skips = topology.findUnknownRungs(cached, topology.knownRunnerSet(), {});
  assert.equal(skips.length, allow ? 1 : topology.RUNG_LISTS.length, 'cached topology checks each transport');
  assert.ok(skips.every((s) => s.why === (s.list === 'implementer_ladder' ? 'kimi_broker_unavailable' : 'kimi_local_stopped')));
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/resolve-dispatch-topology.js'), '--resolve-live', '--role', 'implementer', '--out', cachePath], {
    env: { ...process.env, ENGINE_CAPABILITY_DIR: path.join(tmp, 'cap'), ENGINE_SCORECARD_DIR: path.join(tmp, 'scores') },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).effective_tuple.runner, 'grok', 'cached implementer needs a broker regardless of local allow');
}
delete process.env.AUTOPILOT_KIMI_LOCAL_ALLOW;
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir);
const fakeKimi = path.join(binDir, 'kimi');
const record = path.join(tmp, 'unexpected-kimi-start');
fs.writeFileSync(fakeKimi, `#!/bin/sh\nprintf '%s\\n' \"$@\" >> '${record}'\nexit 1\n`, { mode: 0o755 });
for (const allow of [false, true]) {
  const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ENGINE_CAPABILITY_DIR: path.join(tmp, 'cap'), ENGINE_SCORECARD_DIR: path.join(tmp, 'scores') };
  if (allow) env.AUTOPILOT_KIMI_LOCAL_ALLOW = '1';
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/resolve-dispatch-topology.js'), '--json', '--role', 'implementer', '--out', path.join(tmp, 'derived-topology.json')], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).runners_installed.kimi, null, 'local binary cannot replace missing implementer broker');
  assert.equal(fs.existsSync(record), false, 'topology never starts the binary');
}
console.log('PASS stopped/allow auto selectors');
NODE
SELECT_RC=$?
assert_exit_code "$SELECT_RC" 0 "auto selector stopped/allow contract"
unset AUTOPILOT_KIMI_LOCAL_ALLOW
CFG="$TEST_TMP/auto.md"
printf -- '- implementer_ladder: auto\n- brain_seat_identity_file:\n' > "$CFG"
OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/cached-topology.json" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$REPO_ROOT/hooks/tests/lib/resolve-legacy-fixture.sh" --field implementer_ladder 2>"$TEST_TMP/resolver.err")"; RC=$?
assert_exit_code "$RC" 0 "shell auto resolver reads cached topology"
assert_not_contains "$OUT" '"runner":"kimi"' "shell auto resolver excludes Kimi"
assert_contains "$OUT" '"runner":"grok"' "shell auto resolver retains fallback"
assert_contains "$(cat "$TEST_TMP/resolver.err")" 'kimi_local_stopped' "cached skip names stop reason"
# An all-Kimi review set must refuse instead of substituting a same-family review.
printf '{"reviewer_ladder":[{"engine":"kimi-code/k3","runner":"kimi","effort":"high"}]}' > "$TEST_TMP/review-topology.json"
printf -- '- hetero_review: auto\n- brain_seat_identity_file:\n' > "$CFG"
OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/review-topology.json" REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$REPO_ROOT/hooks/tests/lib/resolve-legacy-fixture.sh" 2>&1)"; RC=$?
assert_exit_code "$RC" 3 "all stopped cached reviewers fail closed"
assert_contains "$OUT" 'kimi_local_stopped' "all stopped reviewers report stop reason"
finalize_test
