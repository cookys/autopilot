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

# Test 3: resolveImplementationFromLedger uses caller-supplied round-invariant stage key
# We set up a real git repo and real ledger file
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

LEDGER_PATH="$TEST_TMP/ledger.jsonl"
RUN_LEDGER_SCRIPT="$REPO_ROOT/scripts/run-ledger.sh"
bash "$RUN_LEDGER_SCRIPT" init --ledger "$LEDGER_PATH"

ACQ_OUT=$(bash "$RUN_LEDGER_SCRIPT" stage-acquire --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement" --pid "$$" --git-ref "refs/heads/round1-branch" --git-sha "$ROUND1_SHA" --worktree "$SCRATCH_WT")
GEN=$(jq -r '.generation' <<<"$ACQ_OUT")
NONCE=$(jq -r '.nonce' <<<"$ACQ_OUT")

bash "$RUN_LEDGER_SCRIPT" stage-transition --ledger "$LEDGER_PATH" --run-id "RUNX" --stage "implement" --generation "$GEN" --nonce "$NONCE" --to-state committed

OUT3="$(node - "$REPO_ROOT" "$PROMPT_TXT" "$SCRATCH_WT" "$LEDGER_PATH" "$BASE_SHA" "$ROUND1_SHA" <<'NODE'
const path = require('path');
const root = process.argv[2];
const promptFile = process.argv[3];
const gitDir = process.argv[4];
const ledger = process.argv[5];
const baseSha = process.argv[6];
const round1Sha = process.argv[7];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  implementationDispatcher(args) {
    // Mock blocked dispatcher to force ledger recovery
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: 'boom',
      parseError: null,
      result: null,
    };
  },
});

// Round 1 implementTask
const result1 = engine.implementTask({
  promptFile,
  branch: 'round1-branch',
  base: baseSha,
  runId: 'RUNX',
  implementationStage: 'implement',
  ledger,
  gitDir,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

console.log(`round1_status=${result1.status}`);
console.log(`round1_commit=${result1.implementation ? result1.implementation.commit : 'null'}`);

// Round 2 implementTask with different branch and base to simulate round 2
const result2 = engine.implementTask({
  promptFile,
  branch: 'round2-branch',
  base: round1Sha,
  runId: 'RUNX',
  implementationStage: 'implement',
  ledger,
  gitDir,
  roster: {
    implementer_engine: 'test',
    implementer_effort: 'high',
    implementer_runner: 'auto',
  },
});

console.log(`round2_status=${result2.status}`);
console.log(`round2_commit=${result2.implementation ? result2.implementation.commit : 'null'}`);
NODE
)"; EXIT3=$?
assert_eq "0" "$EXIT3" "Test 3 node process exits 0"
assert_contains "$OUT3" "round1_status=committed" "Round 1 recovery succeeds"
assert_contains "$OUT3" "round1_commit=$ROUND1_SHA" "Round 1 commit is round 1 SHA"

# EXPECTED TO CHANGE: this currently passes because of the C4 bug (round-collapsed ledger key); a correct fix must make round-2 NOT silently reuse round-1's stale commit here.
assert_contains "$OUT3" "round2_commit=$ROUND1_SHA" "Round 2 re-adopts round 1's commit due to bug"

finalize_test

