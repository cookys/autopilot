#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

TEST_NAME="autopilot-engine-resilience"

# Set up test files
PROMPT_TXT="$TEST_TMP/prompt.txt"
echo "Test prompt content" > "$PROMPT_TXT"

# Test 1: Gate bypass in collectMisplacementEvidence
OUT1="$(node - "$REPO_ROOT" "$PROMPT_TXT" "$TEST_TMP" <<'NODE'
const path = require('path');
const root = process.argv[2];
const promptFile = process.argv[3];
const testTmp = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  implementationDispatcher(args) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-runner',
        model: 'test-model',
        status: 'committed',
        files_changed: 2,
        insertions: 10,
        deletions: 1,
        commit: '1111111111111111111111111111111111111111',
        worktree: '/home/fakeuser/.gemini/antigravity-cli/scratch/some-run/worktree',
        agent_log: '/tmp/fake.log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile,
  branch: 'test-branch',
  base: '0000000000000000000000000000000000000000',
  cwd: testTmp,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
NODE
)"; EXIT1=$?
assert_eq "0" "$EXIT1" "Test 1 node process exits 0"
assert_contains "$OUT1" "status=blocked" "Test 1 should block due to out-of-tree writes"
assert_contains "$OUT1" "phase=misplaced_writes" "Test 1 phase should be misplaced_writes"

# Test 2: collectMisplacementEvidence treats result.error as candidate path field
OUT2="$(node - "$REPO_ROOT" "$PROMPT_TXT" "$TEST_TMP" <<'NODE'
const path = require('path');
const root = process.argv[2];
const promptFile = process.argv[3];
const testTmp = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  implementationDispatcher(args) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-runner',
        model: 'test-model',
        status: 'committed',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        commit: '1111111111111111111111111111111111111111',
        worktree: path.join(testTmp, 'worktree'),
        agent_log: path.join(testTmp, 'agent.log'),
        error: '/home/fakeuser/.cache/gemini/tmp/some.lock',
      },
    };
  },
});

const result = engine.implementTask({
  promptFile,
  branch: 'test-branch',
  base: '0000000000000000000000000000000000000000',
  cwd: testTmp,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
NODE
)"; EXIT2=$?
assert_eq "0" "$EXIT2" "Test 2 node process exits 0"
assert_contains "$OUT2" "status=committed" "Test 2 should report committed status"
assert_not_contains "$OUT2" "phase=misplaced_writes" "Test 2 should not have misplaced_writes phase"

# Test 3: parsed precondition failures never promote terminal ledger-only evidence,
# while the pre-existing null-result crash recovery remains available.
# We set up a real git repo and real ledger file.
SCRATCH_WT="$TEST_TMP/git-scratch"
mkdir -p "$SCRATCH_WT"
git init -q "$SCRATCH_WT"
(
  cd "$SCRATCH_WT"
  git config user.email "test@example.com"
  git config user.name "test"
  touch readme.md
  git add readme.md
  git commit -qm "initial commit"
)
BASE_SHA=$(git -C "$SCRATCH_WT" rev-parse HEAD)

# Create a second commit simulating Round 1
(
  cd "$SCRATCH_WT"
  git checkout -qb "round1-branch"
  echo "changes" >> readme.md
  git commit -qam "round 1 commit"
)
ROUND1_SHA=$(git -C "$SCRATCH_WT" rev-parse HEAD)

# Create a second commit simulating Round 2
(
  cd "$SCRATCH_WT"
  git checkout -qb "round2-branch"
  echo "more changes" >> readme.md
  git commit -qam "round 2 commit"
)
ROUND2_SHA=$(git -C "$SCRATCH_WT" rev-parse HEAD)

LEDGER_PATH="$TEST_TMP/ledger.jsonl"
RUN_LEDGER_SCRIPT="$REPO_ROOT/scripts/run-ledger.sh"
bash "$RUN_LEDGER_SCRIPT" init --ledger "$LEDGER_PATH"

# Reconciliation receipt requires a closed writer: live start_time/heartbeat at
# acquire, then a dead holder before recovery (holder_alive=false).
HOLDER1_PID=""
HOLDER2_PID=""
HOLDER3_PID=""
cleanup_holders() {
  if [ -n "${HOLDER1_PID}" ]; then kill "$HOLDER1_PID" 2>/dev/null || true; wait "$HOLDER1_PID" 2>/dev/null || true; fi
  if [ -n "${HOLDER2_PID}" ]; then kill "$HOLDER2_PID" 2>/dev/null || true; wait "$HOLDER2_PID" 2>/dev/null || true; fi
  if [ -n "${HOLDER3_PID}" ]; then kill "$HOLDER3_PID" 2>/dev/null || true; wait "$HOLDER3_PID" 2>/dev/null || true; fi
}
trap cleanup_holders EXIT

sleep 120 &
HOLDER1_PID=$!
ACQ_OUT=$(bash "$RUN_LEDGER_SCRIPT" stage-acquire --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement" --pid "$HOLDER1_PID" --git-ref "refs/heads/round1-branch" --git-sha "$ROUND1_SHA" --worktree "$SCRATCH_WT")
GEN=$(jq -r '.generation' <<<"$ACQ_OUT")
NONCE=$(jq -r '.nonce' <<<"$ACQ_OUT")
bash "$RUN_LEDGER_SCRIPT" stage-transition --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement" --generation "$GEN" --nonce "$NONCE" --to-state committed
kill "$HOLDER1_PID" 2>/dev/null || true
wait "$HOLDER1_PID" 2>/dev/null || true
HOLDER1_PID=""

sleep 120 &
HOLDER2_PID=$!
ACQ_OUT2=$(bash "$RUN_LEDGER_SCRIPT" stage-acquire --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement#r2" --pid "$HOLDER2_PID" --git-ref "refs/heads/round2-branch" --git-sha "$ROUND2_SHA" --worktree "$SCRATCH_WT")
GEN2=$(jq -r '.generation' <<<"$ACQ_OUT2")
NONCE2=$(jq -r '.nonce' <<<"$ACQ_OUT2")
bash "$RUN_LEDGER_SCRIPT" stage-transition --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement#r2" --generation "$GEN2" --nonce "$NONCE2" --to-state committed
kill "$HOLDER2_PID" 2>/dev/null || true
wait "$HOLDER2_PID" 2>/dev/null || true
HOLDER2_PID=""

sleep 120 &
HOLDER3_PID=$!
ACQ_OUT3=$(bash "$RUN_LEDGER_SCRIPT" stage-acquire --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement#r3" --pid "$HOLDER3_PID" --git-ref "refs/heads/round2-branch" --git-sha "1111111111111111111111111111111111111111" --worktree "$SCRATCH_WT")
GEN3=$(jq -r '.generation' <<<"$ACQ_OUT3")
NONCE3=$(jq -r '.nonce' <<<"$ACQ_OUT3")
bash "$RUN_LEDGER_SCRIPT" stage-transition --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement#r3" --generation "$GEN3" --nonce "$NONCE3" --to-state committed
kill "$HOLDER3_PID" 2>/dev/null || true
wait "$HOLDER3_PID" 2>/dev/null || true
HOLDER3_PID=""

OUT3="$(node - "$REPO_ROOT" "$PROMPT_TXT" "$SCRATCH_WT" "$LEDGER_PATH" "$BASE_SHA" "$ROUND1_SHA" "$ROUND2_SHA" <<'NODE'
const path = require('path');
const root = process.argv[2];
const promptFile = process.argv[3];
const gitDir = process.argv[4];
const ledger = process.argv[5];
const baseSha = process.argv[6];
const round1Sha = process.argv[7];
const round2Sha = process.argv[8];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const parsedPreconditionEngine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  implementationDispatcher() {
    return {
      error: null,
      status: 2,
      signal: null,
      stdout: '',
      stderr: 'boom',
      parseError: null,
      result: {
        status: 'precondition_failed',
        error: 'durable dispatch claim rejected: stage already committed',
      },
    };
  },
});

const parsedValidTerminal = parsedPreconditionEngine.implementTask({
  promptFile,
  branch: 'round1-branch',
  base: baseSha,
  runId: 'RUNX',
  implementationStage: 'implement',
  implementationRound: 1,
  ledger,
  gitDir,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

const parsedMissingCommit = parsedPreconditionEngine.implementTask({
  promptFile,
  branch: 'round2-branch',
  base: round1Sha,
  runId: 'RUNX',
  implementationStage: 'implement',
  implementationRound: 3,
  ledger,
  gitDir,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

const crashRecoveryEngine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  implementationDispatcher() {
    return {
      error: new Error('dispatcher transport crashed before a parseable result'),
      status: null,
      signal: null,
      stdout: '',
      stderr: 'transport crash',
      parseError: null,
      result: null,
    };
  },
});
const crashRecovered = crashRecoveryEngine.implementTask({
  promptFile,
  branch: 'round2-branch',
  base: round1Sha,
  runId: 'RUNX',
  implementationStage: 'implement',
  implementationRound: 2,
  ledger,
  gitDir,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

console.log(`parsed_valid_status=${parsedValidTerminal.status}`);
console.log(`parsed_valid_implementation=${parsedValidTerminal.implementation.status}`);
console.log(`missing_status=${parsedMissingCommit.status}`);
console.log(`missing_implementation=${parsedMissingCommit.implementation.status}`);
console.log(`missing_commit_promoted=${parsedMissingCommit.implementation.commit || 'none'}`);
console.log(`crash_status=${crashRecovered.status}`);
console.log(`crash_commit=${crashRecovered.implementation
  ? crashRecovered.implementation.commit
  : 'null'}`);
console.log(`expected_crash_commit=${round2Sha}`);
NODE
)"; EXIT3=$?
assert_eq "0" "$EXIT3" "Test 3 node process exits 0"
assert_contains "$OUT3" "parsed_valid_status=blocked" \
  "parsed precondition failure cannot promote even a valid terminal ledger row"
assert_contains "$OUT3" "parsed_valid_implementation=precondition_failed" \
  "parsed precondition result remains the authoritative blocked outcome"
assert_contains "$OUT3" "missing_status=blocked" \
  "nonexistent 1111 terminal commit is rejected"
assert_contains "$OUT3" "missing_implementation=precondition_failed" \
  "nonexistent terminal evidence does not replace the parsed precondition result"
assert_contains "$OUT3" "missing_commit_promoted=none" \
  "nonexistent 1111 SHA is never synthesized as committed"
assert_contains "$OUT3" "crash_status=committed" \
  "null-result dispatcher crash still uses the pre-existing recovery path"
assert_contains "$OUT3" "crash_commit=$ROUND2_SHA" \
  "null-result crash recovery retains exact round-scoped ledger identity"

finalize_test
