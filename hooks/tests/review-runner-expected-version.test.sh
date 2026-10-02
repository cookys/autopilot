#!/usr/bin/env bash
# review-runner-expected-version.test.sh — final-panel isolation phase 5: the intake-probed kimi/agy
# version reaches dispatch-review.sh as AUTOPILOT_CLEANROOM_EXPECTED_VERSION (advisory warning only).
# RED at 033750f9: node dies `TypeError: cleanroomExpectedVersions is not a function` (not exported),
# so every assert_contains below FAILs; prepareReviewLaunch also never sets the env var.
. "$(dirname "$0")/lib.sh"

D="$TEST_TMP/d.diff"; printf '+x\n' > "$D"
OUT="$(cd "$REPO_ROOT" && AUTOPILOT_CLEANROOM_EXPECTED_VERSION=ambient D="$D" node - <<'NODE'
const review = require('./src/runners/review');
const { cleanroomExpectedVersions } = require('./src/engine/autopilot-engine');
const fs = require('fs');
const base = ['--runner', 'agy', '--model', 'm', '--diff-file', process.env.D];
const run = (args, opts) => {
  const p = review.prepareReviewLaunch(args, { scriptPath: '/bin/true', ...opts });
  if (p.blindCwd) fs.rmSync(p.blindCwd, { recursive: true, force: true });
  return p.launchEnv && p.launchEnv.AUTOPILOT_CLEANROOM_EXPECTED_VERSION;
};
console.log(`blind_agy=${run(base, { blindDiscovery: true, cleanroomExpectedVersions: { agy: '1.2.14', kimi: '2.1.1' } })}`);
console.log(`blind_other_runner=${run(['--runner', 'kimi', ...base.slice(2)], { blindDiscovery: true, cleanroomExpectedVersions: { agy: '1.2.14' } })}`);
console.log(`blind_no_map_ignores_ambient=${run(base, { blindDiscovery: true })}`);
console.log(`non_blind_ignores_map=${run(base, { cleanroomExpectedVersions: { agy: '1.2.14' } })}`);
const steps = [
  { owner: 'cleanroom_probe', status: 'ready', launcher_json: { runner: 'agy' }, runner_version: '1.2.15' },
  { owner: 'cleanroom_probe', status: 'ready', launcher_json: { runner: 'kimi' }, runner_version: null },
  { owner: 'cleanroom_probe', status: 'rejected', launcher_json: { runner: 'codex' }, runner_version: '9' },
  { owner: 'other', status: 'ready' },
];
console.log(`map=${JSON.stringify(cleanroomExpectedVersions({ steps }))}`);
console.log(`map_empty=${JSON.stringify(cleanroomExpectedVersions({}))}${JSON.stringify(cleanroomExpectedVersions(null))}`);
NODE
)"
assert_contains "$OUT" "blind_agy=1.2.14" "blind agy gets its recorded version"
assert_contains "$OUT" "blind_other_runner=undefined" "a runner without a recorded version gets none"
assert_contains "$OUT" "blind_no_map_ignores_ambient=undefined" "an ambient env value is never inherited"
assert_contains "$OUT" "non_blind_ignores_map=undefined" "non-blind launches carry no expected version"
assert_contains "$OUT" 'map={"agy":"1.2.15"}' "only ready probes with a string version are recorded"
assert_contains "$OUT" 'map_empty={}{}' "missing control or steps yields an empty map"
finalize_test
