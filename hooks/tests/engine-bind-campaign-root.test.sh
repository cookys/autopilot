#!/usr/bin/env bash
# engine-bind-campaign-root.test.sh — the engine binds the sealed Mission root onto the launching session's marker
# (mods P1W SCOPE, gate run l5g). After managed dev-flow admission accepted the campaign and before anything is
# dispatched, `engine implement-review` calls session-mode bindCampaignRoot with contract.mission_runtime.root_run_id.
# Contracts under test: a second admission of the same campaign against the already-bound marker still passes (A2); bound after a valid admission (l5/l6 marker, explicit session id); NOT bound when admission
# failed; NOT bound when the environment names no session (the cwd fallback is not a session); a bind refusal (marker
# below l5) never changes the campaign result; the real ~/.autopilot is untouched (temp marker dir, temp HOME).
# RED before the change: the suite exits 1 at case A (no campaign_roots on the marker): run-w/land/scope-engine-red.txt. GREEN: 2 assertions (cases A-E inside).
# Mutation controls: run-w/land/scope-mut-engine-*.txt.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID 2>/dev/null || true
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "bind@example.invalid"
git -C "$REPO" config user.name "Bind Test"
printf 'seed\n' > "$REPO/seed.txt"
git -C "$REPO" add . && git -C "$REPO" commit -qm base
BASE="$(git -C "$REPO" rev-parse HEAD)"
PROMPT="$TEST_TMP/prompt.txt"; printf 'Implement it.\n' > "$PROMPT"

SUITE="$TEST_TMP/engine-bind-suite.js"
cat > "$SUITE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, repo, base, promptFile, tmp] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const { sealSessionMarker, repoIdentityOf } = require(path.join(root, 'hooks', 'tests', 'lib', 'session-marker'));
const { normalizeSessionId } = require(path.join(root, 'scripts', 'session-mode'));
const identity = repoIdentityOf(repo);

function contract(name, rootRunId, graphDigest) {
  const file = path.join(tmp, `${name}.contract.json`);
  fs.writeFileSync(file, JSON.stringify({
    repo_identity: identity,
    mission_runtime: {
      root_run_id: rootRunId,
      mission_policy_digest: '1'.repeat(64),
      mission_graph_digest: graphDigest || '2'.repeat(64),
    },
  }));
  return file;
}
function resetEnv() {
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_LEVEL', 'AUTOPILOT_SESSION_MODE_DIR']) delete process.env[k];
}
let stderrText = '';
const realWrite = process.stderr.write.bind(process.stderr);
function run(campaignContract) {
  stderrText = '';
  process.stderr.write = (chunk, ...rest) => { stderrText += String(chunk); return true; };
  try { return runInner(campaignContract); } finally { process.stderr.write = realWrite; }
}
function runInner(campaignContract) {
  const engine = new AutopilotEngine({ cwd: repo, clock: () => '2026-10-05T00:00:00.000Z' });
  // roster {} is refused by validateReviewRoster AFTER admission: the loop ends before any dispatch, deterministically
  return engine.runImplementationReviewLoop({ campaignContract, promptFile, branch: 'feat/bind', base, roster: {}, cwd: repo });
}
const marker = (dir, sid) => JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), 'utf8'));
const shape = (r) => ({ status: r.status, phase: r.phase, reason: r.reason });

// A. valid admission (l6 marker, explicit session id): the sealed root is bound; the loop goes on to its own next phase
resetEnv();
const cA = contract('a', 'mission-root-a');
const sealA = sealSessionMarker({ root, dir: path.join(tmp, 'mA'), repoRoot: repo, contract: cA, sessionId: 'bind-eng-a', level: 'l6' });
const rA = run(cA);
console.log(`A=${JSON.stringify(shape(rA))}`);
assert.notStrictEqual(rA.phase, 'dev_flow_admission', 'admission must have passed: ' + rA.reason);
assert.deepStrictEqual(marker(sealA.markerDir, 'bind-eng-a').campaign_roots, ['mission-root-a'], 'A: sealed root bound');

// A2. the SAME campaign enters admission again with the now-bound marker (a repair round / resume does): it must still be admitted
// and the bind must be idempotent (campaign_roots unchanged, not duplicated)
const markerBytesBound = fs.readFileSync(sealA.markerPath, 'utf8');
const rA2 = run(cA);
assert.notStrictEqual(rA2.phase, 'dev_flow_admission', 'A2: admission still passes with campaign_roots on the marker: ' + rA2.reason);
assert.deepStrictEqual(shape(rA2), shape(rA), 'A2: the second run reaches the same next phase');
assert.strictEqual(fs.readFileSync(sealA.markerPath, 'utf8'), markerBytesBound, 'A2: re-binding the same root leaves the marker byte-identical');

// B. admission failed (the marker was sealed against another graph): nothing bound
resetEnv();
const cB1 = contract('b1', 'mission-root-b1', '3'.repeat(64));
const sealB = sealSessionMarker({ root, dir: path.join(tmp, 'mB'), repoRoot: repo, contract: cB1, sessionId: 'bind-eng-b', level: 'l6' });
const cB2 = contract('b2', 'mission-root-b2', '4'.repeat(64));
const rB = run(cB2);
console.log(`B=${JSON.stringify(shape(rB))}`);
assert.strictEqual(rB.phase, 'dev_flow_admission', 'B: admission rejected');
assert.strictEqual(marker(sealB.markerDir, 'bind-eng-b').campaign_roots, undefined, 'B: never bind when admission failed');

// C. admission passes through the cwd fallback (no session id in the environment): nothing bound
resetEnv();
const cwdSid = normalizeSessionId(process.cwd());
const cC = contract('c', 'mission-root-c');
const sealC = sealSessionMarker({ root, dir: path.join(tmp, 'mC'), repoRoot: repo, contract: cC, sessionId: cwdSid, level: 'l6', exportEnv: false });
process.env.AUTOPILOT_SESSION_MODE_DIR = sealC.markerDir;
process.env.AUTOPILOT_LEVEL = 'l6';
const rC = run(cC);
console.log(`C=${JSON.stringify(shape(rC))}`);
assert.notStrictEqual(rC.phase, 'dev_flow_admission', 'C: admission passed through the cwd-keyed marker');
assert.strictEqual(marker(sealC.markerDir, cwdSid).campaign_roots, undefined, 'C: no session id, no bind');
assert.ok(!stderrText.includes('not bound'), 'C: no session id is the quiet case, not a logged refusal: ' + stderrText);

// D. the bind is refused (marker level l3 is below l5): the campaign result is exactly A's, the marker untouched
resetEnv();
const cD = contract('d', 'mission-root-d');
const sealD = sealSessionMarker({ root, dir: path.join(tmp, 'mD'), repoRoot: repo, contract: cD, sessionId: 'bind-eng-d', level: 'l3' });
const before = fs.readFileSync(sealD.markerPath, 'utf8');
const rD = run(cD);
console.log(`D=${JSON.stringify(shape(rD))}`);
assert.deepStrictEqual(shape(rD), shape(rA), 'D: a refused bind does not change the campaign result');
assert.ok(stderrText.includes('not bound to the session marker') && stderrText.trim().split('\\n').length === 1, 'D: the refusal is one logged line: ' + stderrText);
assert.strictEqual(fs.readFileSync(sealD.markerPath, 'utf8'), before, 'D: marker untouched');

// E. a contract without a root (the bounded non-Mission shapes carry none): nothing to bind, result unchanged
resetEnv();
const fE = path.join(tmp, 'e.contract.json');
fs.writeFileSync(fE, JSON.stringify({ repo_identity: identity, mission_runtime: { mission_policy_digest: '1'.repeat(64), mission_graph_digest: '2'.repeat(64) } }));
const sealE = sealSessionMarker({ root, dir: path.join(tmp, 'mE'), repoRoot: repo, contract: fE, sessionId: 'bind-eng-e', level: 'l6' });
const rE = run(fE);
assert.strictEqual(shape(rE).phase, shape(rA).phase);
assert.strictEqual(marker(sealE.markerDir, 'bind-eng-e').campaign_roots, undefined, 'E: no sealed root, no bind');
console.log('engine_bind_suite=true');
NODE
OUT="$(node "$SUITE" "$REPO_ROOT" "$REPO" "$BASE" "$PROMPT" "$TEST_TMP" < /dev/null 2>&1)"
EXIT=$?
echo "$OUT" | tail -20
assert_exit_code "$EXIT" "0" "engine bind suite exits 0"
assert_contains "$OUT" "engine_bind_suite=true" "engine bind suite completed"
finalize_test
