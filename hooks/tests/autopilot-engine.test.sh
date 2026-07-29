#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

DIFF="$TEST_TMP/review.diff"
printf '+const answer = 42;\n' > "$DIFF"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  reviewLoopResolver(args) {
    calls.push(['resolve', args]);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
      },
    };
  },
  reviewDispatcher(args) {
    calls.push(['review', args]);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'FIX-THEN-SHIP',
        findings: 'stub finding',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.reviewDiff({ diffFile: diff, requireQualifiedReviewer: true });
console.log(`status=${result.status}`);
console.log(`verdict=${result.verdict}`);
console.log(`resolve_args=${calls[0][1].join(' ')}`);
console.log(`review_args=${calls[1][1].join(' ')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff process exits 0"
assert_contains "$OUT" "status=reviewed" "AutopilotEngine returns reviewed status"
assert_contains "$OUT" "verdict=FIX-THEN-SHIP" "AutopilotEngine returns review verdict"
assert_contains "$OUT" "resolve_args=--check-scorecard" "AutopilotEngine resolves scorecard-aware roster by default"
assert_contains "$OUT" "--runner test-review-runner --model test-review-model --diff-file $DIFF --effort test-review-effort" "AutopilotEngine builds review dispatcher args from roster"
assert_contains "$OUT" "ledger=resolve_roster:resolved,dispatch_review:reviewed" "AutopilotEngine emits dispatch ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
      },
    };
  },
});

const result = engine.resolveRoster();
console.log(`status=${result.status}`);
console.log(`reviewer=${result.roster && result.roster.reviewer_engine}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolveRoster process exits 0"
assert_contains "$OUT" "status=resolved" "AutopilotEngine resolveRoster returns resolved status"
assert_contains "$OUT" "reviewer=test-review-model" "AutopilotEngine resolveRoster returns roster"
assert_contains "$OUT" "ledger=resolve_roster:resolved" "AutopilotEngine resolveRoster emits ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => Number.MAX_VALUE,
});
const result = engine.resolveRoster({ args: '' });
console.log(`status=${result.status}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolveRoster bad-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine resolveRoster blocks bad args"
assert_contains "$OUT" "reason=resolveRoster args must be an array" "AutopilotEngine resolveRoster surfaces bad args"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine resolveRoster bad args emits ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => new Date('not-a-date'),
});
const result = engine.resolveRoster({ args: '' });
console.log(`status=${result.status}`);
console.log(`started_type=${typeof result.ledger[0].started_at}`);
console.log(`ended_type=${typeof result.ledger[0].ended_at}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine invalid-Date clock process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine tolerates invalid Date clock values"
assert_contains "$OUT" "started_type=string" "AutopilotEngine keeps started_at as string with invalid Date clock"
assert_contains "$OUT" "ended_type=string" "AutopilotEngine keeps ended_at as string with invalid Date clock"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '{bad',
      stderr: '',
      parseError: new Error('schema drift'),
      result: null,
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolve-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks on roster parse error"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve_roster phase"
assert_contains "$OUT" "reason=schema drift" "AutopilotEngine surfaces parse error"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch review after resolve block"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records blocked roster ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_runner: 'test-review-runner',
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine malformed-resolved-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks malformed resolved roster"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for malformed roster"
assert_contains "$OUT" "reviewer_effort is required" "AutopilotEngine surfaces malformed roster reason"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch malformed resolved roster"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records malformed roster in resolve ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'test-review-effort',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: false,
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not run');
  },
});

const result = engine.reviewDiff({ diffFile: diff, requireQualifiedReviewer: true });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine qualification-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks unqualified reviewer when required"
assert_contains "$OUT" "phase=reviewer_qualification" "AutopilotEngine reports qualification phase"
assert_contains "$OUT" "reason=reviewer is not qualified or qualification is unknown" "AutopilotEngine surfaces qualification reason"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine does not dispatch unqualified reviewer"
assert_contains "$OUT" "ledger=resolve_roster:resolved,reviewer_qualification:blocked" "AutopilotEngine records qualification ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewDispatcher() {
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: 'not json',
      stderr: '',
      parseError: new Error('no JSON object found'),
      result: null,
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine dispatch-block process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks on review parse error"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase"
assert_contains "$OUT" "reason=review dispatch exited with status 1" "AutopilotEngine prioritizes nonzero review exit"
assert_contains "$OUT" "ledger=dispatch_review:blocked" "AutopilotEngine records blocked review ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine invalid-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks partial injected roster"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for invalid roster"
assert_contains "$OUT" "reviewer_effort is required" "AutopilotEngine rejects partial injected roster"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: 'bad-roster',
  requireQualifiedReviewer: true,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine non-object-roster process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks non-object roster before qualification"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for non-object roster"
assert_contains "$OUT" "reason=review roster is required" "AutopilotEngine surfaces non-object roster reason"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewCalls = 0;
const engine = new AutopilotEngine({
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'no_verdict',
        verdict: null,
        findings: '',
        raw_log: '/tmp/log',
        error: 'no verdict',
      },
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`review_calls=${reviewCalls}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine nonzero-review process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks nonzero review status"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for nonzero review"
assert_contains "$OUT" "reason=review dispatch exited with status 1" "AutopilotEngine surfaces nonzero review exit"
assert_contains "$OUT" "review_calls=1" "AutopilotEngine still records one review attempt"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'no_verdict',
        verdict: null,
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine zero-exit-no-verdict process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks parsed non-reviewed status"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for non-reviewed status"
assert_contains "$OUT" "reason=review dispatch result status no_verdict" "AutopilotEngine surfaces non-reviewed status"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    return {
      error: null,
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      parseError: null,
      result: null,
    };
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine review signal process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks review signal termination"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for signal"
assert_contains "$OUT" "reason=review dispatch terminated by signal SIGTERM" "AutopilotEngine surfaces review signal"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewDispatcher() {
    throw new Error('dispatcher exploded');
  },
});

const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine dispatcher exception process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks dispatcher exceptions"
assert_contains "$OUT" "phase=dispatch_review" "AutopilotEngine reports dispatch phase for dispatcher exception"
assert_contains "$OUT" "reason=dispatcher exploded" "AutopilotEngine surfaces dispatcher exception"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    throw new Error('resolver exploded');
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolver-exception process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks resolver exceptions"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for exception"
assert_contains "$OUT" "reason=resolver exploded" "AutopilotEngine surfaces resolver exception"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records resolver exception ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  rosterArgs: '--bad',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff bad-rosterArgs process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine reviewDiff blocks bad rosterArgs"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for bad rosterArgs"
assert_contains "$OUT" "reason=resolveRoster args must be an array" "AutopilotEngine surfaces bad rosterArgs"
assert_contains "$OUT" "ledger=resolve_roster:blocked" "AutopilotEngine records bad rosterArgs ledger"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    return {
      error: null,
      status: null,
      signal: 'SIGINT',
      stdout: '',
      stderr: '',
      parseError: null,
      result: null,
    };
  },
});

const result = engine.reviewDiff({ diffFile: diff });
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine resolver signal process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks resolver signal termination"
assert_contains "$OUT" "phase=resolve_roster" "AutopilotEngine reports resolve phase for signal"
assert_contains "$OUT" "reason=review-loop terminated by signal SIGINT" "AutopilotEngine surfaces resolver signal"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
  extraReviewArgs: ['--runner', 'agy'],
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine conflicting-extra-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks conflicting extra args"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for conflicting args"
assert_contains "$OUT" "cannot override --runner" "AutopilotEngine rejects reserved review arg override"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const promptFile = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
let dispatchCalls = 0;
const engine = new AutopilotEngine({
  implementationDispatcher() {
    dispatchCalls += 1;
    throw new Error('reserved lineage override must block before dispatch');
  },
});
const result = engine.implementTask({
  promptFile,
  branch: 'impl/reserved-lineage-flags',
  base: 'a'.repeat(40),
  roster: {
    implementer_engine: 'test-implementer',
    implementer_effort: 'high',
    implementer_runner: 'fixture',
  },
  extraImplementationArgs: ['--reuse-worktree', '/tmp/forbidden'],
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`dispatch_calls=${dispatchCalls}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "reserved lineage override probe exits cleanly"
assert_contains "$OUT" "status=blocked" "reserved lineage override is blocked"
assert_contains "$OUT" "phase=prepare_implementation" \
  "reserved lineage override blocks during argument preparation"
assert_contains "$OUT" "cannot override --reuse-worktree" \
  "managed extra args cannot replace the retained checkout"
assert_contains "$OUT" "dispatch_calls=0" \
  "reserved lineage override spends zero implementer calls"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine();
const result = engine.reviewDiff({
  diffFile: diff,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'test-review-effort',
    reviewer_runner: 'test-review-runner',
  },
  extraReviewArgs: '',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine bad-extra-args process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks non-array extra args"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for bad extra args"
assert_contains "$OUT" "extraReviewArgs must be an array" "AutopilotEngine surfaces bad extra args"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    throw new Error('resolver should not run');
  },
});
const result = engine.reviewDiff({});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine missing-diff process exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks missing diffFile before resolving"
assert_contains "$OUT" "phase=prepare_review" "AutopilotEngine reports prepare phase for missing diff"
assert_contains "$OUT" "reason=diffFile is required" "AutopilotEngine surfaces missing diff reason"
assert_contains "$OUT" "ledger=prepare_review:blocked" "AutopilotEngine records missing diff ledger"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { buildImplementationArgs } = require(path.join(root, 'src', 'engine'));

const args = buildImplementationArgs({
  promptFile: 'relative-prompt.md',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(args.join(' '));
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine buildImplementationArgs absolutizes prompt path"
assert_contains "$OUT" "--prompt-file $REPO_ROOT/relative-prompt.md" "AutopilotEngine passes absolute prompt path to dispatch-hetero"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

try {
  parseImplementationOutput(JSON.stringify({
    status: 'committed',
    runner: 'codex',
    model: 'gpt-test',
    branch: 'impl-branch',
    base: '1111111111111111111111111111111111111111',
    commit: null,
    files_changed: 1,
    insertions: 1,
    deletions: 0,
    worktree: null,
    agent_log: '/tmp/log',
    error: null,
    containment: 'plain',
    contained: true,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser committed-null process exits 0"
assert_contains "$OUT" "status committed requires a non-empty commit" "AutopilotEngine implementer parser rejects committed outcome without commit"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

try {
  parseImplementationOutput(JSON.stringify({
    status: 'committed',
    runner: 'codex',
    model: 'gpt-test',
    branch: 'impl-branch',
    base: '1111111111111111111111111111111111111111',
    commit: 'not-a-sha',
    files_changed: 1,
    insertions: 1,
    deletions: 0,
    worktree: null,
    agent_log: '/tmp/log',
    error: null,
    containment: 'plain',
    contained: true,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser bad-commit process exits 0"
assert_contains "$OUT" "status committed requires a full immutable git SHA commit" "AutopilotEngine implementer parser rejects committed outcome with non-SHA commit"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

const parsed = parseImplementationOutput(JSON.stringify({
  status: 'precondition_failed',
  runner: 'codex',
  model: 'gpt-test',
  branch: '',
  base: '',
  commit: null,
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  worktree: null,
  agent_log: null,
  error: '--branch is required',
}));
console.log(`status=${parsed.status}`);
console.log(`error=${parsed.error}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser precondition-empty-branch process exits 0"
assert_contains "$OUT" "status=precondition_failed" "AutopilotEngine implementer parser accepts precondition_failed with empty branch"
assert_contains "$OUT" "error=--branch is required" "AutopilotEngine implementer parser preserves precondition_failed error"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));
const parsed = parseImplementationOutput(JSON.stringify({
  status: 'acceptance_failed',
  runner: 'codex',
  model: 'gpt-test',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  commit: null,
  files_changed: 1,
  insertions: 1,
  deletions: 0,
  worktree: '/tmp/contained-worktree',
  agent_log: '/tmp/log',
  error: 'acceptance_failed',
  containment: 'plain',
  contained: true,
}));
console.log(`status=${parsed.status}`);
NODE
)"
assert_eq "0" "$?" "implementer parser accepts canonical acceptance_failed"
assert_contains "$OUT" "status=acceptance_failed" "acceptance_failed remains a parsed attempt-consuming outcome"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));

const valid = {
  status: 'committed',
  runner: 'codex',
  model: 'gpt-test',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  commit: '2222222222222222222222222222222222222222',
  files_changed: 1,
  insertions: 1,
  deletions: 0,
  worktree: null,
  agent_log: '/tmp/log',
  error: null,
  containment: 'plain',
  contained: true,
};
try {
  parseImplementationOutput(`${JSON.stringify(valid)}\n{"status":"committed"`);
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer parser trailing-incomplete process exits 0"
assert_contains "$OUT" "trailing incomplete JSON object" "AutopilotEngine implementer parser rejects trailing incomplete JSON after valid result"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/impl-cwd-runner.sh" "$TEST_TMP/caller-project" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const script = process.argv[3];
const caller = process.argv[4];
const { dispatchImplement } = require(path.join(root, 'src', 'runners', 'implementer'));

fs.writeFileSync(script, '#!/usr/bin/env bash\npwd\n');
fs.chmodSync(script, 0o755);
fs.mkdirSync(caller, { recursive: true });
process.chdir(caller);

const result = dispatchImplement([], {
  scriptPath: script,
  stdio: ['ignore', 'pipe', 'pipe'],
});
console.log(`status=${result.status}`);
console.log(`stdout=${String(result.stdout).trim()}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementer dispatcher cwd test process exits 0"
assert_contains "$OUT" "status=0" "AutopilotEngine implementer dispatcher cwd test script exits 0"
assert_contains "$OUT" "stdout=$TEST_TMP/caller-project" "AutopilotEngine implementer dispatcher defaults to caller cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implement-task-cwd-project" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const target = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'prompt.txt'), 'implementer prompt');
let resolverCwd = null;
let implementationCwd = null;
let promptArg = null;

const engine = new AutopilotEngine({
  cwd: target,
  reviewLoopResolver(_args, options) {
    resolverCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
      },
    };
  },
  implementationDispatcher(args, options) {
    implementationCwd = options && options.cwd;
    promptArg = args[args.indexOf('--prompt-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: 'prompt.txt',
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
});
console.log(`status=${result.status}`);
console.log(`resolver_cwd=${resolverCwd}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`prompt_arg=${promptArg}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementTask engine-cwd test exits 0"
assert_contains "$OUT" "status=committed" "AutopilotEngine implementTask engine-cwd dispatch commits"
assert_contains "$OUT" "resolver_cwd=$TEST_TMP/implement-task-cwd-project" "AutopilotEngine implementTask uses engine cwd for roster resolver"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/implement-task-cwd-project" "AutopilotEngine implementTask passes engine cwd to dispatcher"
assert_contains "$OUT" "prompt_arg=$TEST_TMP/implement-task-cwd-project/prompt.txt" "AutopilotEngine implementTask resolves relative prompt from engine cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const calls = [];

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    calls.push(args);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '{\"runner\":\"test-impl-runner\",\"model\":\"test-impl-model\",\"status\":\"committed\",\"commit\":\"2222222222222222222222222222222222222222\",\"base\":\"1111111111111111111111111111111111111111\",\"branch\":\"impl-branch\",\"files_changed\":2,\"insertions\":12,\"deletions\":1,\"worktree\":\"/tmp/impl-wt\",\"agent_log\":\"/tmp/impl-log\",\"error\":null,\"containment\":\"plain\",\"contained\":true}',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: '2222222222222222222222222222222222222222',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 2,
        insertions: 12,
        deletions: 1,
        worktree: '/tmp/impl-wt',
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`runner=${result.implementation && result.implementation.runner}`);
console.log(`model=${result.implementation && result.implementation.model}`);
console.log(`commit=${result.implementation && result.implementation.commit}`);
console.log(`args=${calls[0].join(' ')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.base}:${entry.branch}:${entry.commit}:${entry.runner}:${entry.model}:${entry.exit_status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementTask builds implementation args and ledger"
assert_contains "$OUT" "status=committed" "AutopilotEngine implementation dispatch returns committed"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine implementation dispatch phase is dispatch_implementation"
assert_contains "$OUT" "runner=test-impl-runner" "AutopilotEngine implementation output captures runner"
assert_contains "$OUT" "model=test-impl-model" "AutopilotEngine implementation output captures model"
assert_contains "$OUT" "commit=2222222222222222222222222222222222222222" "AutopilotEngine implementation output captures commit"
assert_contains "$OUT" "--runner test-impl-runner --model test-impl-model --prompt-file $TEST_TMP/implementer-prompt.txt --branch impl-branch --base 1111111111111111111111111111111111111111 --effort high" "AutopilotEngine builds implementation dispatcher args from roster"
assert_contains "$OUT" "dispatch_implementation:committed:1111111111111111111111111111111111111111:impl-branch:2222222222222222222222222222222222222222:test-impl-runner:test-impl-model:0" "AutopilotEngine emits implementation ledger row with runner/model/base/branch/commit/exit status"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-nonzero-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: '2222222222222222222222222222222222222222',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine blocks nonzero committed implementation dispatch"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks nonzero committed implementation dispatch status"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine reports dispatch phase for nonzero committed implementation"
assert_contains "$OUT" "reason=implementation dispatch exited with status 1" "AutopilotEngine surfaces nonzero committed implementation exit"
assert_contains "$OUT" "ledger=dispatch_implementation:blocked" "AutopilotEngine records nonzero committed implementation as blocked"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-bad-commit-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: 'not-a-sha',
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine blocks committed implementation with non-SHA commit"
assert_contains "$OUT" "status=blocked" "AutopilotEngine blocks committed implementation with non-SHA commit status"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine reports dispatch phase for non-SHA committed implementation"
assert_contains "$OUT" "reason=implementation result commit must be a full immutable git SHA" "AutopilotEngine surfaces non-SHA committed implementation"
assert_contains "$OUT" "ledger=dispatch_implementation:blocked" "AutopilotEngine records non-SHA committed implementation as blocked"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-misplaced-no-op.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'no_op',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: null,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: '/tmp/.gemini/out-of-cwd',
        agent_log: '/tmp/.gemini/logs/impl.log',
        error: '/tmp/.gemini/errors/ohno.log',
        containment: 'plain',
        contained: true,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.reconcile_by_ledger}:${entry.reconcile_status}:${entry.misplaced_write_evidence}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine flags misplaced no-op writes"
assert_contains "$OUT" "status=blocked" "AutopilotEngine returns blocked for misplaced no-op"
assert_contains "$OUT" "phase=misplaced_writes" "AutopilotEngine returns misplaced_writes phase for out-of-cwd writes"
assert_contains "$OUT" "likely hardcoded absolute path escaping the target worktree" "AutopilotEngine explains out-of-cwd misplacement cause"
assert_contains "$OUT" "dispatch_implementation:misplaced_writes" "AutopilotEngine records misplaced writes decision in dispatch_implementation ledger"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implementer-empty-no-op.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'no_op',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'impl-branch',
        base: '1111111111111111111111111111111111111111',
        commit: null,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: null,
        error: null,
        containment: 'plain',
        contained: true,
      },
    };
  },
});

const result = engine.implementTask({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}:${entry.reconcile_by_ledger}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine keeps plain no-op path unchanged"
assert_contains "$OUT" "status=blocked" "AutopilotEngine keeps plain no-op result blocked"
assert_contains "$OUT" "phase=dispatch_implementation" "AutopilotEngine preserves ordinary no-op dispatch phase"
assert_contains "$OUT" "reason=implementation status no_op" "AutopilotEngine keeps ordinary no-op reason"
assert_contains "$OUT" "dispatch_implementation:no_op" "AutopilotEngine leaves ordinary no-op as no_op dispatch status"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/split-brain-repo" "$TEST_TMP/split-brain-result.json" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const repoBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const { execFileSync } = require('child_process');

const repo = path.join(repoBase, 'repo');
const prompt = path.join(repoBase, 'prompt.txt');
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(prompt, 'implementer prompt for split-brain');
execFileSync('git', ['init'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'autopilot@example.test'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Autopilot Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n', 'utf8');
execFileSync('git', ['add', 'file.txt'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: 'ignore' });

const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const branch = 'sb-loop';
execFileSync('git', ['checkout', '-b', branch], { cwd: repo });

const runId = 'autopilot-r2-split-brain-run-id';
const ledger = path.join(repo, '.autopilot', 'run-ledger.jsonl');
const runLedger = (...args) => {
  const output = execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), ...args], {
    encoding: 'utf8',
  });
  return JSON.parse(output.trim().split('\n').pop());
};

execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), 'init', '--ledger', ledger]);

let implementationCalls = 0;
let reviewCalls = 0;
let committedCommit = null;

const engine = new AutopilotEngine({
  implementationDispatcher() {
    implementationCalls += 1;
    fs.appendFileSync(path.join(repo, 'file.txt'), `updated ${implementationCalls}\n`, 'utf8');
    execFileSync('git', ['add', 'file.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-m', `split-brain ${implementationCalls}`], { cwd: repo, stdio: 'ignore' });
    committedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

    const acquired = runLedger(
      'stage-acquire',
      '--ledger', ledger,
      '--run-id', runId,
      '--stage', 'implement',
      '--git-ref', branch,
      '--git-sha', committedCommit,
      '--worktree', repo,
    );
    runLedger(
      'stage-transition',
      '--ledger', ledger,
      '--run-id', runId,
      '--stage', 'implement',
      '--generation', String(acquired.generation),
      '--nonce', acquired.nonce,
      '--to-state', 'committed',
      '--idempotency-key', `${runId}-impl`,
      '--git-ref', branch,
      '--git-sha', committedCommit,
      '--worktree', repo,
    );

    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: new Error('simulated missing implementation result json'),
      result: null,
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider() {
    const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), `autopilot-r2-split-brain-${branch}-`));
    const file = path.join(diffDir, 'range.diff');
    fs.writeFileSync(file, 'split-brain diff', 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch,
  base,
  runId,
  ledger,
  implementationStage: 'implement',
  resultJson: path.join(repo, '.autopilot', 'implementer-result.json'),
  gitDir: repo,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    reviewer_qualified: true,
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`rounds=${result.rounds}`);
console.log(`implementation_calls=${result.implementationChain.length}`);
console.log(`review_calls=${result.reviewChain.length}`);
console.log(`reconciled=${result.implementationChain[0].implementation && result.implementationChain[0].implementation.reconcile_by_ledger}`);
console.log(`reconcile_receipt=${result.implementationChain[0].implementation && result.implementationChain[0].implementation.reconciliation_receipt && result.implementationChain[0].implementation.reconciliation_receipt.receipt_digest}`);
console.log(`dispatch_row=${result.ledger.find((entry) => entry.unit === 'dispatch_implementation').status}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reconciles implementation outcome from run-ledger when result json is missing"
assert_contains "$OUT" "status=converged" "AutopilotEngine split-brain path converges from ledger/git-truth"
assert_contains "$OUT" "phase=converged" "AutopilotEngine split-brain path does not block"
assert_contains "$OUT" "rounds=1" "AutopilotEngine split-brain path runs one round"
assert_contains "$OUT" "implementation_calls=1" "AutopilotEngine split-brain path does not re-dispatch implementation"
assert_contains "$OUT" "review_calls=1" "AutopilotEngine split-brain path dispatches a single review"
assert_contains "$OUT" "reconciled=true" "AutopilotEngine split-brain path reconciles from ledger"
assert_contains "$OUT" "reconcile_receipt=" "AutopilotEngine binds ledger reconciliation to a receipt"
assert_not_contains "$OUT" "reconcile_receipt=undefined" "AutopilotEngine reconciliation receipt is concrete"
assert_contains "$OUT" "dispatch_row=committed" "AutopilotEngine split-brain path reaches committed dispatch state from ledger"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/implement-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
const implCalls = [];
const reviewCalls = [];
const diffCalls = [];
const repairCalls = [];

const engine = new AutopilotEngine({
  clock: () => '2026-07-01T00:00:00.000Z',
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 3,
        loop_convergence_verdict: 'SHIP-AS-IS',
        spec_review: 'off',
        independent_harness: 'off',
        qc_panel: [ 'test-review-model' ],
        qc_panel_aggregation: 'majority',
        review_risk: 'low',
        required_review_families: 1,
        l1_required: false,
        cross_family_required: false,
        cross_family_satisfied: true,
        review_diff_scope: 'full',
        source: 'test',
        work_domain: 'mixed',
        domain_source: 'none',
      },
    };
  },
  implementationDispatcher(args) {
    implCalls.push(args);
    const call = implCalls.length;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: call === 1 ? '2222222222222222222222222222222222222222' : '3333333333333333333333333333333333333333',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: '/tmp/impl-worktree',
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    reviewCalls.push(args);
    const call = reviewCalls.length;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: call === 1 ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
        findings: 'stub finding',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ base, commit, branch, round }) {
    diffCalls.push({ base, commit, branch, round });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-impl-diff-'));
    const file = path.join(tmpDir, `${branch}-${round}.diff`);
    fs.writeFileSync(file, `round ${round} diff`, 'utf8');
    return file;
  },
  repairPromptWriter({ promptFile, round, base, previousCommit, commit, review }) {
    repairCalls.push({ round, base, previousCommit, commit, verdict: review && review.verdict });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-repair-prompt-'));
    const file = path.join(tmpDir, `round-${round}-prompt.txt`);
    fs.writeFileSync(file, `repair ${round} for ${previousCommit}\n${fs.readFileSync(promptFile, 'utf8')}`, 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 3,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`verdict=${result.verdict}`);
console.log(`implementation_calls=${implCalls.length}`);
console.log(`review_calls=${reviewCalls.length}`);
console.log(`repair_calls=${repairCalls.length}`);
console.log(`diff_calls=${diffCalls.length}`);
console.log(`impl1_base=${implCalls[0][implCalls[0].indexOf('--base') + 1]}`);
console.log(`impl2_base=${implCalls[1][implCalls[1].indexOf('--base') + 1]}`);
console.log(`review_bases=${diffCalls.map((d) => d.base).join(',')}`);
console.log(`impl_branches=${implCalls.map((args) => args[args.indexOf('--branch') + 1]).join(',')}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine converges through repair implementation-repair-review loop"
assert_contains "$OUT" "status=converged" "AutopilotEngine returns converged status after repair round"
assert_contains "$OUT" "phase=converged" "AutopilotEngine converged on implementation-review loop"
assert_contains "$OUT" "rounds=2" "AutopilotEngine returns converged round count"
assert_contains "$OUT" "verdict=SHIP-AS-IS" "AutopilotEngine returns converged verdict"
assert_contains "$OUT" "implementation_calls=2" "AutopilotEngine performs two implementation dispatches for one repair cycle"
assert_contains "$OUT" "review_calls=2" "AutopilotEngine performs two review dispatches for one repair cycle"
assert_contains "$OUT" "repair_calls=1" "AutopilotEngine performs one repair prompt write"
assert_contains "$OUT" "diff_calls=2" "AutopilotEngine reviews full base-to-commit diff after each implementation"
assert_contains "$OUT" "impl2_base=2222222222222222222222222222222222222222" "AutopilotEngine repair dispatch uses previous commit as repair base"
assert_contains "$OUT" "review_bases=1111111111111111111111111111111111111111,1111111111111111111111111111111111111111" "AutopilotEngine reviews against immutable original base"
assert_contains "$OUT" "ledger=resolve_roster:resolved,dispatch_implementation:committed,dispatch_review:reviewed,dispatch_implementation:committed,dispatch_review:reviewed" "AutopilotEngine logs both implementation and review dispatch units"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/moving-ref-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let resolverCalls = 0;
let implementationCalls = 0;

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    resolverCalls += 1;
    throw new Error('resolver should not run with a moving base ref');
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch with a moving base ref');
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: 'develop',
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`reason=${result.reason}`);
console.log(`rounds=${result.rounds}`);
console.log(`resolver_calls=${resolverCalls}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop moving-ref base exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks moving base refs"
assert_contains "$OUT" "phase=prepare_implementation_loop" "AutopilotEngine implementation loop reports preparation phase for moving base refs"
assert_contains "$OUT" "reason=base must be a full immutable git SHA" "AutopilotEngine implementation loop explains immutable base requirement"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks moving base before round one"
assert_contains "$OUT" "resolver_calls=0" "AutopilotEngine implementation loop does not resolve roster with moving base"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch implementation with moving base"
assert_contains "$OUT" "ledger=prepare_implementation_loop:blocked" "AutopilotEngine implementation loop records moving-base block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/unqualified-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let implementationCalls = 0;
let reviewCalls = 0;

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: false,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch before reviewer qualification passes');
  },
  reviewDispatcher() {
    reviewCalls += 1;
    throw new Error('review should not dispatch when reviewer is unqualified');
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  requireQualifiedReviewer: true,
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`reason=${result.reason}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop reviewer-qualification preflight exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks unqualified reviewer"
assert_contains "$OUT" "phase=reviewer_qualification" "AutopilotEngine implementation loop reports reviewer qualification phase"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks before round one"
assert_contains "$OUT" "reason=reviewer is not qualified or qualification is unknown" "AutopilotEngine implementation loop surfaces reviewer qualification reason"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch implementation before qualification"
assert_contains "$OUT" "review_calls=0" "AutopilotEngine implementation loop does not dispatch review when qualification fails"
assert_contains "$OUT" "ledger=resolve_roster:resolved,reviewer_qualification:blocked" "AutopilotEngine implementation loop records qualification block"

# --- implement-review pre-flight is family-conflict-fallback aware (v2.32.40) ----
# The rounds:0 reviewer_qualification pre-flight used to hard-block on an
# UNqualified incumbent reviewer without consulting the fallback ladder, so the
# v2.32.25 on_family_conflict:fallback design was dead for implement-review (the
# default openai×openai roster stayed permanently blocked). The pre-flight now
# blocks ONLY when the loop is genuinely unviable — NOT ( family conflict AND a
# valid fallback row ). Fail-closed invariants (empty/invalid/stale ladder, mode
# block, cross-family unqualified primary) must still block exactly as before.
OUT="$(node - "$REPO_ROOT" "$TEST_TMP/preflight-fb-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
fs.writeFileSync(prompt, 'implementer prompt');

// mixed ladder: same-family row + codex row without calibrated effort (skipped);
// claude-native haiku is the first valid cross-family row.
const LADDER = [
  { engine: 'gpt-5.6-terra', runner: 'codex', family: 'openai', effort: 'high' },
  { engine: 'claude-opus', runner: 'codex', family: 'anthropic', effort: null },
  { engine: 'claude-haiku', runner: 'claude-native', family: 'anthropic', effort: null, model: 'haiku' },
];

function makeEngine(counters) {
  return new AutopilotEngine({
    clock: () => '2026-07-01T00:00:00.000Z',
    reviewLoopResolver() { throw new Error('resolver must not be called (pre-resolved roster)'); },
    implementationDispatcher(args) {
      counters.impl += 1;
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          status: 'committed', runner: 'codex', model: 'gpt-5.3-codex-spark',
          branch: args[args.indexOf('--branch') + 1], base: args[args.indexOf('--base') + 1],
          commit: '2222222222222222222222222222222222222222',
          files_changed: 1, insertions: 1, deletions: 0,
          worktree: '/tmp/impl-worktree', agent_log: '/tmp/impl-log', error: null,
        },
      };
    },
    reviewDispatcher() {
      counters.review += 1;
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: { runner: 'x', model: 'x', status: 'reviewed', verdict: 'SHIP-AS-IS', findings: 'none', raw_log: '/tmp/log', error: null },
      };
    },
    diffProvider({ branch, round }) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-preflight-fb-'));
      const file = path.join(tmpDir, `${branch}-${round}.diff`);
      fs.writeFileSync(file, `round ${round} diff`, 'utf8');
      return file;
    },
  });
}

const baseRoster = {
  reviewer_engine: 'gpt-5.5', reviewer_effort: 'xhigh', reviewer_runner: 'codex',
  reviewer_qualified: false,
  implementer_engine: 'gpt-5.3-codex-spark', implementer_effort: 'high', implementer_runner: 'codex',
  loop_max_rounds: 1, loop_convergence_verdict: 'SHIP-AS-IS',
};

function run(extra) {
  const counters = { impl: 0, review: 0 };
  const engine = makeEngine(counters);
  const result = engine.runLegacyImplementationReviewLoop({
    promptFile: prompt,
    branch: 'impl-loop',
    base: '1111111111111111111111111111111111111111',
    requireQualifiedReviewer: true,
    roster: { ...baseRoster, ...extra },
  });
  return { result, counters };
}

// (a) unqualified SAME-family primary + valid cross-family ladder + mode fallback
//     → NOT blocked at pre-flight; proceeds into round 1; reviewDiff substitutes
//     the fallback reviewer and ledgers reviewer_family_fallback.
const a = run({ on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`a_status=${a.result.status}`);
console.log(`a_phase=${a.result.phase}`);
console.log(`a_rounds=${a.result.rounds}`);
console.log(`a_impl=${a.counters.impl}`);
console.log(`a_review=${a.counters.review}`);
console.log(`a_fb_ledger=${a.result.ledger.some((e) => e.unit === 'reviewer_family_fallback')}`);
console.log(`a_no_preflight_block=${!a.result.ledger.some((e) => e.unit === 'reviewer_qualification' && e.status === 'blocked')}`);

// (b) same-family primary + EMPTY ladder → blocked at pre-flight, no dispatch.
const b = run({ on_family_conflict: 'fallback', fallback_ladder: [], fallback_ladder_implementer_family: 'openai' });
console.log(`b_status=${b.result.status}:${b.result.phase}:${b.result.rounds}`);
console.log(`b_impl=${b.counters.impl}:${b.counters.review}`);

// (b2) same-family primary + ladder of only INVALID rows → blocked.
const b2 = run({ on_family_conflict: 'fallback', fallback_ladder: [LADDER[0], { engine: 'claude-opus', runner: 'bogus', family: 'anthropic' }], fallback_ladder_implementer_family: 'openai' });
console.log(`b2_status=${b2.result.status}:${b2.result.phase}:${b2.result.rounds}`);

// (b3) same-family primary + valid ladder but STALE provenance → blocked.
const b3 = run({ on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'anthropic' });
console.log(`b3_status=${b3.result.status}:${b3.result.phase}:${b3.result.rounds}`);

// (c) mode block (valid ladder present) → blocked.
const c = run({ on_family_conflict: 'block', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`c_status=${c.result.status}:${c.result.phase}:${c.result.rounds}`);

// (d) cross-family-but-unqualified primary (no conflict → fallback never fires) → blocked, no dispatch.
const d = run({ reviewer_engine: 'gemini-flash', reviewer_runner: 'agy', on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`d_status=${d.result.status}:${d.result.phase}:${d.result.rounds}`);
console.log(`d_impl=${d.counters.impl}:${d.counters.review}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implement-review pre-flight fallback process exits 0"
assert_contains "$OUT" "a_status=converged" "pre-flight fallback: same-family unqualified primary + valid ladder proceeds to convergence"
assert_contains "$OUT" "a_phase=converged" "pre-flight fallback: not blocked at reviewer_qualification"
assert_contains "$OUT" "a_rounds=1" "pre-flight fallback: runs round 1"
assert_contains "$OUT" "a_impl=1" "pre-flight fallback: dispatches implementation"
assert_contains "$OUT" "a_review=1" "pre-flight fallback: dispatches review"
assert_contains "$OUT" "a_fb_ledger=true" "pre-flight fallback: per-round review path ledgers reviewer_family_fallback"
assert_contains "$OUT" "a_no_preflight_block=true" "pre-flight fallback: no reviewer_qualification block ledger entry"
assert_contains "$OUT" "b_status=blocked:reviewer_qualification:0" "pre-flight fallback: empty ladder still blocks at rounds 0"
assert_contains "$OUT" "b_impl=0:0" "pre-flight fallback: empty-ladder block dispatches nothing"
assert_contains "$OUT" "b2_status=blocked:reviewer_qualification:0" "pre-flight fallback: all-invalid ladder still blocks"
assert_contains "$OUT" "b3_status=blocked:reviewer_qualification:0" "pre-flight fallback: stale provenance still blocks"
assert_contains "$OUT" "c_status=blocked:reviewer_qualification:0" "pre-flight fallback: mode block still blocks"
assert_contains "$OUT" "d_status=blocked:reviewer_qualification:0" "pre-flight fallback: cross-family unqualified primary still blocks"
assert_contains "$OUT" "d_impl=0:0" "pre-flight fallback: cross-family block dispatches nothing"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/malformed-roster-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let implementationCalls = 0;

const engine = new AutopilotEngine({
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch with malformed roster');
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`reason=${result.reason}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop malformed roster exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine implementation loop blocks malformed injected roster"
assert_contains "$OUT" "phase=prepare_implementation_loop" "AutopilotEngine implementation loop reports preparation phase for malformed roster"
assert_contains "$OUT" "rounds=0" "AutopilotEngine implementation loop blocks malformed roster before round one"
assert_contains "$OUT" "reason=implementer roster field implementer_runner is required" "AutopilotEngine implementation loop surfaces missing implementer field"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine implementation loop does not dispatch with malformed roster"
assert_contains "$OUT" "ledger=prepare_implementation_loop:blocked" "AutopilotEngine implementation loop records malformed roster as preparation block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/missing-panel-roster-loop-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');
let implementationCalls = 0;
const engine = new AutopilotEngine({
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('implementation should not dispatch without sealed QC metadata');
  },
});
const baseInput = {
  promptFile: prompt,
  branch: 'managed-missing-panel-loop',
  base: '1111111111111111111111111111111111111111',
};
const baseRoster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
const result = engine.runImplementationReviewLoop({
  ...baseInput,
  roster: baseRoster,
});
const incomplete = engine.runImplementationReviewLoop({
  ...baseInput,
  roster: {
    ...baseRoster,
    min_panel_size: 1,
    qc_panel_seats_complete: false,
    qc_panel_seats: [],
  },
});
const undersized = engine.runImplementationReviewLoop({
  ...baseInput,
  roster: {
    ...baseRoster,
    min_panel_size: 2,
    qc_panel_seats_complete: true,
    qc_panel_seats: [{
      role: 'qc',
      runner: 'test-review-runner',
      model: 'test-review-model',
      effort: 'xhigh',
      endpoint: null,
      family: 'test-family',
    }],
  },
});
const malformed = engine.runImplementationReviewLoop({
  ...baseInput,
  roster: {
    ...baseRoster,
    min_panel_size: 1,
    qc_panel_seats_complete: true,
    qc_panel_seats: [{
      role: 'qc',
      runner: 'test-review-runner',
      model: 'test-review-model',
      effort: 'xhigh',
      endpoint: null,
    }],
  },
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`rounds=${result.rounds}`);
console.log(`reason=${result.reason}`);
console.log(`incomplete=${incomplete.status}:${incomplete.phase}:${incomplete.reason}`);
console.log(`undersized=${undersized.status}:${undersized.phase}:${undersized.reason}`);
console.log(`malformed=${malformed.status}:${malformed.phase}:${malformed.reason}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine managed loop missing panel roster exits 0"
assert_contains "$OUT" "status=blocked" "AutopilotEngine managed loop blocks missing panel metadata"
assert_contains "$OUT" "phase=prepare_implementation_loop" "AutopilotEngine managed loop reports panel failure in preparation phase"
assert_contains "$OUT" "rounds=0" "AutopilotEngine managed loop blocks missing panel metadata before round one"
assert_contains "$OUT" "reason=managed review roster min_panel_size must be an integer >= 1" "AutopilotEngine managed loop surfaces missing sealed panel minimum"
assert_contains "$OUT" "incomplete=blocked:prepare_implementation_loop:managed review roster requires complete exact QC seat metadata" "AutopilotEngine managed loop rejects incomplete exact QC metadata"
assert_contains "$OUT" "undersized=blocked:prepare_implementation_loop:managed review roster exact QC seats must satisfy min_panel_size" "AutopilotEngine managed loop rejects an undersized exact QC roster"
assert_contains "$OUT" "malformed=blocked:prepare_implementation_loop:managed review roster qc_panel_seats[0] is invalid" "AutopilotEngine managed loop rejects malformed exact QC seat metadata"
assert_contains "$OUT" "implementation_calls=0" "AutopilotEngine managed loop does not dispatch without sealed panel metadata"
assert_contains "$OUT" "ledger=prepare_implementation_loop:blocked" "AutopilotEngine managed loop records missing panel metadata as preparation block"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/cwd-propagation-repo" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const target = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'prompt.txt'), 'implementer prompt');
let resolverCwd = null;
let implementationCwd = null;
let reviewCwd = null;
let promptArg = null;

const engine = new AutopilotEngine({
  reviewLoopResolver(_args, options) {
    resolverCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        reviewer_qualified: true,
        implementer_engine: 'test-impl-model',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  implementationDispatcher(args, options) {
    implementationCwd = options && options.cwd;
    promptArg = args[args.indexOf('--prompt-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'cwd-loop',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(_args, options) {
    reviewCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-cwd-propagation-diff-'));
    const file = path.join(tmpDir, `round-${round}.diff`);
    fs.writeFileSync(file, 'diff', 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: 'prompt.txt',
  branch: 'cwd-loop',
  base: '1111111111111111111111111111111111111111',
  cwd: target,
});
console.log(`status=${result.status}`);
console.log(`resolver_cwd=${resolverCwd}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`review_cwd=${reviewCwd}`);
console.log(`prompt_arg=${promptArg}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine implementation loop cwd propagation exits 0"
assert_contains "$OUT" "status=converged" "AutopilotEngine implementation loop cwd propagation converges"
assert_contains "$OUT" "resolver_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to roster resolver"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to implementation dispatcher"
assert_contains "$OUT" "review_cwd=$TEST_TMP/cwd-propagation-repo" "AutopilotEngine implementation loop passes cwd to review dispatcher"
assert_contains "$OUT" "prompt_arg=$TEST_TMP/cwd-propagation-repo/prompt.txt" "AutopilotEngine implementation loop resolves relative prompt from cwd"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-diff-prompt.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'prompt');
const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
let diffFile = null;

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: head,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    diffFile = args[args.indexOf('--diff-file') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'feature/slash-branch',
  base: head,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`diff_exists=${fs.existsSync(diffFile)}`);
console.log(`diff_file=${diffFile}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default diff provider handles slash branch names"
assert_contains "$OUT" "status=converged" "AutopilotEngine default diff provider converges"
assert_contains "$OUT" "diff_exists=true" "AutopilotEngine default diff provider writes diff file"
assert_contains "$OUT" "autopilot-review-loop-feature-slash-branch" "AutopilotEngine sanitizes slash branch in temp path"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-diff-large-prompt.txt" "$TEST_TMP/large-diff-repo" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const prompt = process.argv[3];
const repo = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'prompt');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'autopilot@example.test'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Autopilot Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
execFileSync('git', ['add', 'README.md'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'base'], { cwd: repo, stdio: 'ignore' });
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(repo, 'large.txt'), `${'x'.repeat(2 * 1024 * 1024)}\n`);
execFileSync('git', ['add', 'large.txt'], { cwd: repo });
execFileSync('git', ['commit', '-m', 'large'], { cwd: repo, stdio: 'ignore' });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const externalDiff = path.join(repo, 'external-diff.sh');
fs.writeFileSync(externalDiff, '#!/usr/bin/env bash\nexit 42\n');
fs.chmodSync(externalDiff, 0o755);
execFileSync('git', ['config', 'diff.external', externalDiff], { cwd: repo });

let diffSize = 0;
let implementationCwd = null;
const engine = new AutopilotEngine({
  implementationDispatcher(_args, options) {
    implementationCwd = options && options.cwd;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'large-diff',
        base,
        commit: head,
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    const diffFile = args[args.indexOf('--diff-file') + 1];
    diffSize = fs.statSync(diffFile).size;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'large-diff',
  base,
  cwd: repo,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`implementation_cwd=${implementationCwd}`);
console.log(`external_diff_configured=${fs.existsSync(externalDiff)}`);
console.log(`diff_over_default_buffer=${diffSize > 1024 * 1024}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default diff provider streams large diffs"
assert_contains "$OUT" "status=converged" "AutopilotEngine large diff provider loop converges"
assert_contains "$OUT" "implementation_cwd=$TEST_TMP/large-diff-repo" "AutopilotEngine implementation loop passes cwd to implementation dispatcher"
assert_contains "$OUT" "external_diff_configured=true" "AutopilotEngine default diff provider test configures failing external diff"
assert_contains "$OUT" "diff_over_default_buffer=true" "AutopilotEngine default diff provider writes diff larger than spawnSync default buffer"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/default-repair-prompt.txt" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'original implementation prompt');
let implementationCalls = 0;
let secondPromptText = '';
let reviewCalls = 0;

const engine = new AutopilotEngine({
  implementationDispatcher(args) {
    implementationCalls += 1;
    if (implementationCalls === 2) {
      secondPromptText = fs.readFileSync(args[args.indexOf('--prompt-file') + 1], 'utf8');
    }
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: implementationCalls === 1 ? '2222222222222222222222222222222222222222' : '3333333333333333333333333333333333333333',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: reviewCalls === 1 ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
        findings: 'line 12 still calls the shell directly',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-default-repair-diff-'));
    const file = path.join(tmpDir, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'repair-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 2,
  roster: {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 2,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
});

console.log(`status=${result.status}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`repair_prompt_has_findings=${secondPromptText.includes('line 12 still calls the shell directly')}`);
console.log(`repair_prompt_has_original=${secondPromptText.includes('original implementation prompt')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine default repair prompt carries review findings"
assert_contains "$OUT" "status=converged" "AutopilotEngine default repair prompt loop converges"
assert_contains "$OUT" "implementation_calls=2" "AutopilotEngine default repair prompt triggers second implementation"
assert_contains "$OUT" "repair_prompt_has_findings=true" "AutopilotEngine default repair prompt includes reviewer findings"
assert_contains "$OUT" "repair_prompt_has_original=true" "AutopilotEngine default repair prompt preserves original task"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verification-loop" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(tmp, { recursive: true });
const verifyScript = path.join(tmp, 'verify-sequence.sh');
fs.writeFileSync(verifyScript, [
  '#!/usr/bin/env bash',
  'seq_file="$1"',
  'counter_file="$2"',
  'count=0',
  'if [ -f "$counter_file" ]; then count="$(cat "$counter_file")"; fi',
  'count=$((count + 1))',
  'printf "%s\\n" "$count" > "$counter_file"',
  'result="$(sed -n "${count}p" "$seq_file")"',
  'if [ "$result" = "pass" ]; then exit 0; fi',
  'exit 1',
  '',
].join('\n'), 'utf8');
fs.chmodSync(verifyScript, 0o755);

const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');
const commits = [
  '2222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333',
  '4444444444444444444444444444444444444444',
  '5555555555555555555555555555555555555555',
];
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

function mockWorktreeHandlers(prefix) {
  return {
    gitWorktreeAdd({ round }) {
      const parent = fs.mkdtempSync(path.join(tmp, `${prefix || 'verify'}-${round || 0}-wt-`));
      const worktree = path.join(parent, 'wt');
      fs.mkdirSync(worktree, { recursive: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree,
        parent,
      };
    },
    gitWorktreeRemove({ worktree }) {
      fs.rmSync(worktree, { recursive: true, force: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  };
}

function runScenario(name, options) {
  const scenarioDir = path.join(tmp, name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  const seqFile = path.join(scenarioDir, 'verify-seq.txt');
  const counterFile = path.join(scenarioDir, 'verify-count.txt');
  if (options.verifySequence) {
    fs.writeFileSync(seqFile, `${options.verifySequence.join('\n')}\n`, 'utf8');
  }

  const implCalls = [];
  const reviewCalls = [];
  const repairCalls = [];
  const branchForceCalls = [];
  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers(name),
    implementationDispatcher(args) {
      implCalls.push(args);
      const call = implCalls.length;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: 'test-impl-runner',
          model: 'test-impl-model',
          branch: args[args.indexOf('--branch') + 1],
          base: args[args.indexOf('--base') + 1],
          commit: commits[call - 1],
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    },
    reviewDispatcher() {
      reviewCalls.push(true);
      const call = reviewCalls.length;
      const verdict = options.reviewVerdicts[call - 1] || options.reviewVerdicts[options.reviewVerdicts.length - 1];
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'test-review-runner',
          model: 'test-review-model',
          status: 'reviewed',
          verdict,
          findings: `finding-${name}-${call}`,
          raw_log: '/tmp/log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-loop-diff-'));
      const file = path.join(diffDir, `${name}-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
    repairPromptWriter({ round }) {
      repairCalls.push(round);
      const file = path.join(scenarioDir, `repair-${round}.txt`);
      fs.writeFileSync(file, `repair ${round}`, 'utf8');
      return file;
    },
    gitBranchForce(args) {
      branchForceCalls.push(args);
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  });

  const input = {
    promptFile: prompt,
    branch: `${name}-branch`,
    base: '1111111111111111111111111111111111111111',
    maxRounds: options.maxRounds || 3,
    roster,
  };
  if (options.verifySequence) {
    input.verifyCmd = `${verifyScript} ${seqFile} ${counterFile}`;
  }
  if (options.noVerifyFirst) {
    input.noVerifyFirst = true;
  }

  const result = engine.runLegacyImplementationReviewLoop(input);
  const verifyEntries = result.ledger.filter((entry) => entry.unit === 'verify_round');
  const ratchetSelectEntries = result.ledger.filter((entry) => entry.unit === 'ratchet_select');
  const ratchetEntries = result.ledger.filter((entry) => entry.ratchet_reverted === true);
  console.log(`${name}_status=${result.status}`);
  console.log(`${name}_rounds=${result.rounds}`);
  console.log(`${name}_reason=${result.convergence_reason === undefined ? 'absent' : result.convergence_reason}`);
  console.log(`${name}_commit=${result.commit === undefined ? 'absent' : result.commit}`);
  console.log(`${name}_impl_calls=${implCalls.length}`);
  console.log(`${name}_review_calls=${reviewCalls.length}`);
  console.log(`${name}_repair_calls=${repairCalls.length}`);
  console.log(`${name}_branch_force_calls=${branchForceCalls.length}`);
  console.log(`${name}_branch_force_branch=${branchForceCalls[0] ? branchForceCalls[0].branch : ''}`);
  console.log(`${name}_branch_force_to=${branchForceCalls[0] ? branchForceCalls[0].commit : ''}`);
  console.log(`${name}_ratchet_select_branch=${ratchetSelectEntries[0] ? ratchetSelectEntries[0].branch : ''}`);
  console.log(`${name}_advisory_count=${Array.isArray(result.advisory_findings) ? result.advisory_findings.length : 'absent'}`);
  console.log(`${name}_verify_passes=${verifyEntries.map((entry) => String(entry.verify_pass)).join(',')}`);
  console.log(`${name}_ratchet_reverted_rounds=${result.ratchet_reverted_rounds === undefined ? 'absent' : result.ratchet_reverted_rounds}`);
  console.log(`${name}_ratchet_entry_count=${ratchetEntries.length}`);
  console.log(`${name}_has_verify_field=${Object.prototype.hasOwnProperty.call(result, 'verify_cmd_provided')}`);
  console.log(`${name}_ledger_has_verify=${verifyEntries.length > 0}`);
}

function runTopLevelReviewFindingsScenario() {
  const scenarioDir = path.join(tmp, 'top_level_findings');
  fs.mkdirSync(scenarioDir, { recursive: true });
  const seqFile = path.join(scenarioDir, 'verify-seq.txt');
  const counterFile = path.join(scenarioDir, 'verify-count.txt');
  fs.writeFileSync(seqFile, 'pass\n', 'utf8');

  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers('top-level-findings'),
    implementationDispatcher(args) {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: 'test-impl-runner',
          model: 'test-impl-model',
          branch: args[args.indexOf('--branch') + 1],
          base: args[args.indexOf('--base') + 1],
          commit: commits[0],
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-loop-diff-'));
      const file = path.join(diffDir, `top-level-findings-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
  });

  let reviewCalls = 0;
  engine.reviewDiff = () => {
    reviewCalls += 1;
    return {
      status: 'reviewed',
      verdict: 'FIX-THEN-SHIP',
      findings: 'top-level finding',
      ledger: [],
    };
  };

  const result = engine.runLegacyImplementationReviewLoop({
    promptFile: prompt,
    branch: 'top-level-findings-branch',
    base: '1111111111111111111111111111111111111111',
    maxRounds: 3,
    roster,
    verifyCmd: `${verifyScript} ${seqFile} ${counterFile}`,
  });

  console.log(`top_level_findings_status=${result.status}`);
  console.log(`top_level_findings_review_calls=${reviewCalls}`);
  console.log(`top_level_findings_advisory_count=${Array.isArray(result.advisory_findings) ? result.advisory_findings.length : 'absent'}`);
  console.log(`top_level_findings_advisory_0=${result.advisory_findings && result.advisory_findings[0]}`);
}

runScenario('no_verify', {
  reviewVerdicts: ['SHIP-AS-IS'],
  maxRounds: 1,
});
runScenario('verify_first_advisory', {
  verifySequence: ['pass'],
  reviewVerdicts: ['FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('repair_passes', {
  verifySequence: ['fail', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('fail_tie_continues', {
  verifySequence: ['fail', 'fail', 'fail'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  maxRounds: 3,
});
runScenario('ratchet', {
  verifySequence: ['pass', 'fail', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'FIX-THEN-SHIP', 'FIX-THEN-SHIP'],
  noVerifyFirst: true,
  maxRounds: 3,
});
runScenario('no_verify_first', {
  verifySequence: ['pass', 'pass'],
  reviewVerdicts: ['FIX-THEN-SHIP', 'SHIP-AS-IS'],
  noVerifyFirst: true,
  maxRounds: 3,
});
runTopLevelReviewFindingsScenario();
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verification-anchored loop scenarios exit 0"
assert_contains "$OUT" "no_verify_status=converged" "AutopilotEngine no-verify scenario preserves reviewer convergence"
assert_contains "$OUT" "no_verify_reason=absent" "AutopilotEngine omits convergence_reason without verify-cmd"
assert_contains "$OUT" "no_verify_has_verify_field=false" "AutopilotEngine omits verify-cmd result field without verify-cmd"
assert_contains "$OUT" "no_verify_ledger_has_verify=false" "AutopilotEngine omits verify ledger without verify-cmd"
assert_contains "$OUT" "verify_first_advisory_status=converged" "AutopilotEngine verify-first pass converges despite reviewer fix verdict"
assert_contains "$OUT" "verify_first_advisory_reason=verification" "AutopilotEngine records verification convergence reason"
assert_contains "$OUT" "verify_first_advisory_rounds=1" "AutopilotEngine verify-first pass stops after round one"
assert_contains "$OUT" "verify_first_advisory_advisory_count=1" "AutopilotEngine records reviewer findings as advisory after verified pass"
assert_contains "$OUT" "verify_first_advisory_impl_calls=1" "AutopilotEngine does not dispatch a repair after verified pass"
assert_contains "$OUT" "verify_first_advisory_review_calls=1" "AutopilotEngine still dispatches one advisory review after verified pass"
assert_contains "$OUT" "verify_first_advisory_verify_passes=true" "AutopilotEngine records round-one verify pass"
assert_contains "$OUT" "repair_passes_status=converged" "AutopilotEngine converges when repair round verification passes"
assert_contains "$OUT" "repair_passes_reason=verification" "AutopilotEngine repair pass records verification convergence"
assert_contains "$OUT" "repair_passes_rounds=2" "AutopilotEngine repair pass returns second round"
assert_contains "$OUT" "repair_passes_verify_passes=false,true" "AutopilotEngine records failed then passing verification"
assert_contains "$OUT" "fail_tie_continues_status=non_converged" "AutopilotEngine continues fail-fail ties to max rounds"
assert_contains "$OUT" "fail_tie_continues_rounds=3" "AutopilotEngine fail-fail tie reaches max rounds"
assert_contains "$OUT" "fail_tie_continues_impl_calls=3" "AutopilotEngine dispatches repairs while verification keeps failing without regression"
assert_contains "$OUT" "fail_tie_continues_branch_force_calls=0" "AutopilotEngine does not ratchet-select fail-fail ties"
assert_contains "$OUT" "ratchet_status=non_converged" "AutopilotEngine ratchet scenario remains review-gated under no-verify-first"
assert_contains "$OUT" "ratchet_commit=4444444444444444444444444444444444444444" "AutopilotEngine final commit reports best verified repair commit"
assert_contains "$OUT" "ratchet_branch_force_calls=1" "AutopilotEngine branch-selects after pass-to-fail regression"
assert_contains "$OUT" "ratchet_branch_force_branch=ratchet-branch-repair-r2-2222222" "AutopilotEngine ratchet branch update targets the current repair branch"
assert_contains "$OUT" "ratchet_branch_force_to=2222222222222222222222222222222222222222" "AutopilotEngine ratchet branch update targets best commit"
assert_contains "$OUT" "ratchet_ratchet_select_branch=ratchet-branch-repair-r2-2222222" "AutopilotEngine ratchet ledger records the current repair branch"
assert_contains "$OUT" "ratchet_ratchet_reverted_rounds=1" "AutopilotEngine counts ratchet-reverted rounds"
assert_contains "$OUT" "ratchet_ratchet_entry_count=1" "AutopilotEngine records reverted round in ledger"
assert_contains "$OUT" "no_verify_first_status=converged" "AutopilotEngine no-verify-first restores reviewer-gated convergence"
assert_contains "$OUT" "no_verify_first_reason=reviewer" "AutopilotEngine no-verify-first records reviewer convergence"
assert_contains "$OUT" "no_verify_first_rounds=2" "AutopilotEngine no-verify-first repairs after verified pass until reviewer ships"
assert_contains "$OUT" "no_verify_first_impl_calls=2" "AutopilotEngine no-verify-first dispatches repair after reviewer fix verdict"
assert_contains "$OUT" "no_verify_first_verify_passes=true,true" "AutopilotEngine no-verify-first still records per-round verification"
assert_contains "$OUT" "top_level_findings_status=converged" "AutopilotEngine converges with top-level review findings on verified pass"
assert_contains "$OUT" "top_level_findings_review_calls=1" "AutopilotEngine dispatches one top-level-shape advisory review"
assert_contains "$OUT" "top_level_findings_advisory_count=1" "AutopilotEngine records top-level review findings as advisory"
assert_contains "$OUT" "top_level_findings_advisory_0=top-level finding" "AutopilotEngine preserves top-level advisory finding text"

REAL_GIT="$(command -v git)"
OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-regression" "$REAL_GIT" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
const tmp = process.argv[3];
const realGit = process.argv[4];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : result.stderr;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
run(realGit, ['init', '-q'], { cwd: repo });
run(realGit, ['config', 'user.email', 'engine-test@example.invalid'], { cwd: repo });
run(realGit, ['config', 'user.name', 'Engine Test'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n', 'utf8');
fs.writeFileSync(path.join(repo, 'sentinel.txt'), 'main checkout sentinel\n', 'utf8');
run(realGit, ['add', 'base.txt', 'sentinel.txt'], { cwd: repo });
run(realGit, ['commit', '-q', '-m', 'base'], { cwd: repo });
const base = run(realGit, ['rev-parse', 'HEAD'], { cwd: repo });

const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const gitLog = path.join(tmp, 'git.log');
const gitShim = path.join(binDir, 'git');
fs.writeFileSync(gitShim, [
  '#!/usr/bin/env bash',
  `log=${JSON.stringify(gitLog)}`,
  `real_git=${JSON.stringify(realGit)}`,
  'printf "%s|git" "$PWD" >> "$log"',
  'for arg in "$@"; do printf " %q" "$arg" >> "$log"; done',
  'printf "\\n" >> "$log"',
  'exec "$real_git" "$@"',
  '',
].join('\n'), 'utf8');
fs.chmodSync(gitShim, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;

const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const verifyScript = path.join(tmp, 'verify-round-file.sh');
fs.writeFileSync(verifyScript, [
  '#!/usr/bin/env bash',
  'test -f round-only.txt || exit 1',
  'test ! -f fail-marker.txt',
  '',
].join('\n'), 'utf8');
fs.chmodSync(verifyScript, 0o755);

const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 2,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

const commits = [];
let implementationCalls = 0;
const engine = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher(args) {
    implementationCalls += 1;
    const branch = args[args.indexOf('--branch') + 1];
    const roundBase = args[args.indexOf('--base') + 1];
    const parent = fs.mkdtempSync(path.join(tmp, 'impl-wt-'));
    const worktree = path.join(parent, 'wt');
    try {
      run('git', ['worktree', 'add', '--detach', '-q', worktree, roundBase], { cwd: repo });
      fs.writeFileSync(path.join(worktree, 'round-only.txt'), `round ${implementationCalls}\n`, 'utf8');
      if (implementationCalls === 2) {
        fs.writeFileSync(path.join(worktree, 'fail-marker.txt'), 'regression\n', 'utf8');
      }
      run('git', ['add', 'round-only.txt'], { cwd: worktree });
      if (implementationCalls === 2) {
        run('git', ['add', 'fail-marker.txt'], { cwd: worktree });
      }
      run('git', ['commit', '-q', '-m', `round ${implementationCalls}`], { cwd: worktree });
      const commit = run('git', ['rev-parse', 'HEAD'], { cwd: worktree });
      run('git', ['branch', '-f', branch, commit], { cwd: repo });
      commits.push(commit);
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: 'test-impl-runner',
          model: 'test-impl-model',
          branch,
          base: roundBase,
          commit,
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    } finally {
      run('git', ['worktree', 'remove', '--force', worktree], { cwd: repo });
      fs.rmSync(parent, { recursive: true, force: true });
    }
  },
  reviewDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'FIX-THEN-SHIP',
        findings: 'keep repairing',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
  repairPromptWriter({ round }) {
    const file = path.join(tmp, `repair-${round}.txt`);
    fs.writeFileSync(file, `repair ${round}`, 'utf8');
    return file;
  },
});

const beforeWorktrees = run('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).split('\n').filter((line) => line.startsWith('worktree ')).length;
const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'unit-verify-regression',
  base,
  maxRounds: 2,
  roster,
  verifyCmd: verifyScript,
  noVerifyFirst: true,
});
const afterWorktrees = run('git', ['worktree', 'list', '--porcelain'], { cwd: repo }).split('\n').filter((line) => line.startsWith('worktree ')).length;
const log = fs.readFileSync(gitLog, 'utf8');
const logLines = log.split('\n').filter(Boolean);
const mainSentinel = fs.readFileSync(path.join(repo, 'sentinel.txt'), 'utf8').trim();
const mainHasRoundOnly = fs.existsSync(path.join(repo, 'round-only.txt'));
const mainHead = run('git', ['rev-parse', 'HEAD'], { cwd: repo });
const status = run('git', ['status', '--short'], { cwd: repo });
const verifyEntries = result.ledger.filter((entry) => entry.unit === 'verify_round');
const ratchetSelectEntries = result.ledger.filter((entry) => entry.unit === 'ratchet_select');
const verifyWorktreeAdds = logLines.filter((line) => line.includes('|git worktree add ') && line.includes('/autopilot-verify-wt-'));
const verifyWorktreeRemoves = logLines.filter((line) => line.includes('|git worktree remove ') && line.includes('/autopilot-verify-wt-'));
const allWorktreeAdds = logLines.filter((line) => line.includes('|git worktree add '));
const allWorktreeRemoves = logLines.filter((line) => line.includes('|git worktree remove '));
const resetHardCalls = logLines.filter((line) => line.includes('|git reset --hard'));

console.log(`worktree_regression_status=${result.status}`);
console.log(`worktree_regression_commit=${result.commit}`);
console.log(`worktree_regression_best_commit=${commits[0]}`);
console.log(`worktree_regression_commit_is_best=${result.commit === commits[0]}`);
console.log(`worktree_regression_verify_passes=${verifyEntries.map((entry) => String(entry.verify_pass)).join(',')}`);
console.log(`worktree_regression_ratchet_rounds=${result.ratchet_reverted_rounds}`);
console.log(`worktree_regression_ratchet_select_statuses=${ratchetSelectEntries.map((entry) => entry.status).join(',')}`);
console.log(`worktree_regression_ratchet_selected_best=${ratchetSelectEntries.length === 1 && ratchetSelectEntries[0].selected_commit === commits[0]}`);
console.log(`worktree_regression_main_sentinel=${mainSentinel}`);
console.log(`worktree_regression_main_has_round_only=${mainHasRoundOnly}`);
console.log(`worktree_regression_main_head_unchanged=${mainHead === base}`);
console.log(`worktree_regression_status_clean=${status === ''}`);
console.log(`worktree_regression_worktree_count_delta=${afterWorktrees - beforeWorktrees}`);
console.log(`worktree_regression_worktree_adds=${allWorktreeAdds.length}`);
console.log(`worktree_regression_worktree_removes=${allWorktreeRemoves.length}`);
console.log(`worktree_regression_verify_worktree_adds=${verifyWorktreeAdds.length}`);
console.log(`worktree_regression_verify_worktree_removes=${verifyWorktreeRemoves.length}`);
console.log(`worktree_regression_verify_adds_from_repo=${verifyWorktreeAdds.every((line) => line.startsWith(`${repo}|git worktree add `))}`);
console.log(`worktree_regression_verify_removes_from_repo=${verifyWorktreeRemoves.every((line) => line.startsWith(`${repo}|git worktree remove `))}`);
console.log(`worktree_regression_reset_hard_calls=${resetHardCalls.length}`);
console.log(`worktree_regression_branch_force_best=${log.includes(`|git branch -f unit-verify-regression ${commits[0]}`)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine real verify worktree regression scenario exits 0"
assert_contains "$OUT" "worktree_regression_status=non_converged" "AutopilotEngine keeps reviewer-gated status under no-verify-first"
assert_contains "$OUT" "worktree_regression_verify_passes=true,false" "AutopilotEngine runs verify-cmd in each round commit worktree"
assert_contains "$OUT" "worktree_regression_commit_is_best=true" "AutopilotEngine final result commit selects the best verified commit"
assert_contains "$OUT" "worktree_regression_ratchet_rounds=1" "AutopilotEngine ratchets pass-to-fail regression by selection"
assert_contains "$OUT" "worktree_regression_ratchet_select_statuses=selected" "AutopilotEngine records branch-selection ratchet status"
assert_contains "$OUT" "worktree_regression_ratchet_selected_best=true" "AutopilotEngine ratchet ledger selects the best verified commit"
assert_contains "$OUT" "worktree_regression_main_sentinel=main checkout sentinel" "AutopilotEngine leaves main checkout sentinel unchanged"
assert_contains "$OUT" "worktree_regression_main_has_round_only=false" "AutopilotEngine does not verify by mutating the main checkout"
assert_contains "$OUT" "worktree_regression_main_head_unchanged=true" "AutopilotEngine does not move the invoking checkout HEAD"
assert_contains "$OUT" "worktree_regression_status_clean=true" "AutopilotEngine leaves the invoking checkout clean"
assert_contains "$OUT" "worktree_regression_worktree_count_delta=0" "AutopilotEngine cleans up temp verify worktrees"
assert_contains "$OUT" "worktree_regression_verify_worktree_adds=2" "AutopilotEngine creates one temp verify worktree per round"
assert_contains "$OUT" "worktree_regression_verify_worktree_removes=2" "AutopilotEngine removes every temp verify worktree"
assert_contains "$OUT" "worktree_regression_verify_adds_from_repo=true" "AutopilotEngine creates verify worktrees from the repo cwd"
assert_contains "$OUT" "worktree_regression_verify_removes_from_repo=true" "AutopilotEngine removes verify worktrees from the repo cwd"
assert_contains "$OUT" "worktree_regression_reset_hard_calls=0" "AutopilotEngine never runs git reset --hard"
assert_contains "$OUT" "worktree_regression_branch_force_best=true" "AutopilotEngine branch-selects the best verified commit"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-add-fail" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const osTmp = path.join(tmp, 'os-tmp');
fs.mkdirSync(osTmp, { recursive: true });
process.env.TMPDIR = osTmp;
const binDir = path.join(tmp, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const gitShim = path.join(binDir, 'git');
fs.writeFileSync(gitShim, [
  '#!/usr/bin/env bash',
  'if [ "$1" = "worktree" ] && [ "$2" = "add" ]; then',
  '  mkdir -p "$5/partial"',
  '  printf "simulated worktree add failure\\n" >&2',
  '  exit 73',
  'fi',
  'printf "unexpected git call: %s\\n" "$*" >&2',
  'exit 99',
  '',
].join('\n'), 'utf8');
fs.chmodSync(gitShim, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;

const scenarioDir = path.join(tmp, 'repo');
fs.mkdirSync(scenarioDir, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
let cleanupCalls = 0;
const engine = new AutopilotEngine({
  cwd: scenarioDir,
  verifyWorktreeCleanup({ targetPath }) {
    cleanupCalls += 1;
    fs.rmSync(targetPath, { recursive: true, force: true });
  },
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'add-fail-branch',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher() {
    throw new Error('review should not run after verify worktree add failure');
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'add-fail-branch',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
  verifyCmd: 'true',
});
const verifyEntry = result.ledger.find((entry) => entry.unit === 'verify_round');
const strayDirs = fs.readdirSync(osTmp).filter((name) => name.startsWith('autopilot-verify-wt-'));

console.log(`worktree_add_fail_status=${result.status}`);
console.log(`worktree_add_fail_setup_exit=${verifyEntry && verifyEntry.setup_exit_status}`);
console.log(`worktree_add_fail_blocked_reason=${verifyEntry && verifyEntry.blocked_reason}`);
console.log(`worktree_add_fail_stray_count=${strayDirs.length}`);
console.log(`worktree_add_fail_cleanup_calls=${cleanupCalls}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify worktree add-failure cleanup test exits 0"
assert_contains "$OUT" "worktree_add_fail_status=blocked" "AutopilotEngine blocks when verify worktree add fails"
assert_contains "$OUT" "worktree_add_fail_setup_exit=73" "AutopilotEngine records worktree add failure status"
assert_contains "$OUT" "worktree_add_fail_blocked_reason=git worktree command exited with status 73" "AutopilotEngine surfaces worktree add failure reason"
assert_contains "$OUT" "worktree_add_fail_stray_count=0" "AutopilotEngine removes failed verify worktree mkdtemp parent"
assert_contains "$OUT" "worktree_add_fail_cleanup_calls=1" "AutopilotEngine routes default add-failure cleanup through the injected sink"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-worktree-remove-fail" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const scenarioDir = path.join(tmp, 'repo');
fs.mkdirSync(scenarioDir, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt', 'utf8');
const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  reviewer_qualified: true,
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
let parent = null;
let worktree = null;
let removeCalls = 0;
let cleanupCalls = 0;
let addReceivedCleanup = null;
let removeReceivedCleanup = null;
const engine = new AutopilotEngine({
  cwd: scenarioDir,
  gitWorktreeAdd(args) {
    const { round } = args;
    addReceivedCleanup = Object.prototype.hasOwnProperty.call(args, 'cleanup');
    parent = fs.mkdtempSync(path.join(tmp, `remove-fail-${round}-wt-`));
    worktree = path.join(parent, 'wt');
    fs.mkdirSync(worktree, { recursive: true });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      worktree,
      parent,
    };
  },
  gitWorktreeRemove(args) {
    removeCalls += 1;
    removeReceivedCleanup = Object.prototype.hasOwnProperty.call(args, 'cleanup');
    return {
      error: null,
      status: 81,
      signal: null,
      stdout: '',
      stderr: 'simulated remove failure',
    };
  },
  verifyWorktreeCleanup({ targetPath }) {
    cleanupCalls += 1;
    fs.rmSync(targetPath, { recursive: true, force: true });
  },
  verifyCommandRunner() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'remove-fail-branch',
        base: '1111111111111111111111111111111111111111',
        commit: '2222222222222222222222222222222222222222',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const file = path.join(tmp, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'remove-fail-branch',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
  verifyCmd: 'true',
});
const verifyEntry = result.ledger.find((entry) => entry.unit === 'verify_round');

console.log(`worktree_remove_fail_status=${result.status}`);
console.log(`worktree_remove_fail_cleanup_exit=${verifyEntry && verifyEntry.cleanup_exit_status}`);
console.log(`worktree_remove_fail_warning=${verifyEntry && verifyEntry.verify_cleanup_warning}`);
console.log(`worktree_remove_fail_warning_present=${Boolean(verifyEntry && verifyEntry.verify_cleanup_warning)}`);
console.log(`worktree_remove_fail_remove_calls=${removeCalls}`);
console.log(`worktree_remove_fail_cleanup_calls=${cleanupCalls}`);
console.log(`worktree_remove_fail_add_received_cleanup=${addReceivedCleanup}`);
console.log(`worktree_remove_fail_remove_received_cleanup=${removeReceivedCleanup}`);
console.log(`worktree_remove_fail_worktree_exists=${fs.existsSync(worktree)}`);
console.log(`worktree_remove_fail_parent_exists=${fs.existsSync(parent)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify worktree remove-failure warning test exits 0"
assert_contains "$OUT" "worktree_remove_fail_status=converged" "AutopilotEngine completes despite verify worktree remove failure"
assert_contains "$OUT" "worktree_remove_fail_cleanup_exit=81" "AutopilotEngine records worktree remove failure status"
assert_contains "$OUT" "worktree_remove_fail_warning=git worktree command exited with status 81" "AutopilotEngine records verify cleanup warning in ledger"
assert_contains "$OUT" "worktree_remove_fail_warning_present=true" "AutopilotEngine exposes verify cleanup warning"
assert_contains "$OUT" "worktree_remove_fail_remove_calls=1" "AutopilotEngine attempts git worktree remove"
assert_contains "$OUT" "worktree_remove_fail_cleanup_calls=2" "AutopilotEngine routes both fallback cleanup paths through the injected sink"
assert_contains "$OUT" "worktree_remove_fail_add_received_cleanup=false" "AutopilotEngine does not grant cleanup authority to custom worktree add handlers"
assert_contains "$OUT" "worktree_remove_fail_remove_received_cleanup=false" "AutopilotEngine does not grant cleanup authority to custom worktree remove handlers"
assert_contains "$OUT" "worktree_remove_fail_worktree_exists=false" "AutopilotEngine force-removes worktree path after remove failure"
assert_contains "$OUT" "worktree_remove_fail_parent_exists=false" "AutopilotEngine removes verify worktree parent after remove failure"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/verify-first-signal" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.mkdirSync(tmp, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');

function mockWorktreeHandlers(prefix) {
  return {
    gitWorktreeAdd({ round }) {
      const parent = fs.mkdtempSync(path.join(tmp, `${prefix || 'verify'}-${round || 0}-wt-`));
      const worktree = path.join(parent, 'wt');
      fs.mkdirSync(worktree, { recursive: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree,
        parent,
      };
    },
    gitWorktreeRemove({ worktree }) {
      fs.rmSync(worktree, { recursive: true, force: true });
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  };
}

function runSignalScenario(name, options) {
  const scenarioDir = path.join(tmp, name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  const resolverRoster = {
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    reviewer_qualified: true,
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  };
  if (options.verifyFirst === true) {
    resolverRoster.verify_first = true;
  }

  let implementationCalls = 0;
  let reviewCalls = 0;
  let verifyCalls = 0;
  const engine = new AutopilotEngine({
    cwd: scenarioDir,
    ...mockWorktreeHandlers(name),
    reviewLoopResolver() {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: resolverRoster,
      };
    },
    implementationDispatcher(args) {
      implementationCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: 'test-impl-runner',
          model: 'test-impl-model',
          branch: args[args.indexOf('--branch') + 1],
          base: args[args.indexOf('--base') + 1],
          commit: '2222222222222222222222222222222222222222',
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: '/tmp/impl-log',
          error: null,
        },
      };
    },
    reviewDispatcher() {
      reviewCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'test-review-runner',
          model: 'test-review-model',
          status: 'reviewed',
          verdict: 'SHIP-AS-IS',
          findings: '',
          raw_log: '/tmp/log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-first-signal-'));
      const file = path.join(diffDir, `${name}-round-${round}.diff`);
      fs.writeFileSync(file, `round ${round}`, 'utf8');
      return file;
    },
    verifyCommandRunner() {
      verifyCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
  });

  const input = {
    promptFile: prompt,
    branch: `${name}-branch`,
    base: '1111111111111111111111111111111111111111',
  };
  if (options.verifyCmd) {
    input.verifyCmd = 'true';
  }

  const result = engine.runLegacyImplementationReviewLoop(input);
  const signalEntries = result.ledger.filter((entry) => entry.unit === 'verify_first_signal');
  console.log(`${name}_status=${result.status}`);
  console.log(`${name}_unused_key=${Object.prototype.hasOwnProperty.call(result, 'verify_first_signal_unused') ? result.verify_first_signal_unused : 'absent'}`);
  console.log(`${name}_signal_entries=${signalEntries.map((entry) => `${entry.unit}:${entry.status}`).join(',') || 'absent'}`);
  console.log(`${name}_implementation_calls=${implementationCalls}`);
  console.log(`${name}_review_calls=${reviewCalls}`);
  console.log(`${name}_verify_calls=${verifyCalls}`);
}

runSignalScenario('verify_first_without_cmd', { verifyFirst: true });
runSignalScenario('verify_first_with_cmd', { verifyFirst: true, verifyCmd: true });
runSignalScenario('no_verify_first_key', {});
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine verify_first unused-signal scenarios exit 0"
assert_contains "$OUT" "verify_first_without_cmd_status=converged" "AutopilotEngine verify_first without verify-cmd preserves loop convergence"
assert_contains "$OUT" "verify_first_without_cmd_unused_key=true" "AutopilotEngine reports unused verify_first signal without verify-cmd"
assert_contains "$OUT" "verify_first_without_cmd_signal_entries=verify_first_signal:unused" "AutopilotEngine records unused verify_first signal in ledger"
assert_contains "$OUT" "verify_first_without_cmd_implementation_calls=1" "AutopilotEngine verify_first unused-signal path still dispatches implementation once"
assert_contains "$OUT" "verify_first_without_cmd_review_calls=1" "AutopilotEngine verify_first unused-signal path still dispatches review once"
assert_contains "$OUT" "verify_first_without_cmd_verify_calls=0" "AutopilotEngine verify_first unused-signal path does not invent verification"
assert_contains "$OUT" "verify_first_with_cmd_unused_key=absent" "AutopilotEngine omits unused signal when verify-cmd is provided"
assert_contains "$OUT" "verify_first_with_cmd_signal_entries=absent" "AutopilotEngine omits unused signal ledger when verify-cmd is provided"
assert_contains "$OUT" "verify_first_with_cmd_verify_calls=1" "AutopilotEngine still runs provided verify-cmd"
assert_contains "$OUT" "no_verify_first_key_unused_key=absent" "AutopilotEngine omits unused signal when roster has no verify_first key"
assert_contains "$OUT" "no_verify_first_key_signal_entries=absent" "AutopilotEngine omits unused signal ledger when roster has no verify_first key"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { validateReviewLoopConfig } = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));

function logPayloadCase(name, payload) {
  try {
    const validated = validateReviewLoopConfig(payload);
    console.log(`${name}=ok`);
    return validated;
  } catch (err) {
    console.log(`${name}=${err.message}`);
    return null;
  }
}

const validPayload = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'high',
  reviewer_runner: 'codex',
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'on',
  plan_review: 'off',
  plan_reviewer_engine: '',
  plan_reviewer_effort: '',
  plan_reviewer_runner: '',
  plan_reviewer_endpoint: '',
  plan_deep_reviewer_engine: '',
  plan_deep_reviewer_effort: '',
  plan_deep_reviewer_runner: '',
  plan_deep_reviewer_endpoint: '',
  plan_review_max_generations: 2,
  plan_review_max_wall_seconds: 7200,
  plan_review_growth_warn_ratio: 1.25,
  plan_review_growth_stop_ratio: 1.5,
  independent_harness: 'off',
  qc_panel: ['test-reviewer'],
  qc_panel_aggregation: 'union-on-verified-critical',
  qc_panel_seats: [],
  qc_panel_seats_complete: false,
  provider_readiness_receipt_ttl_seconds: 300,
  provider_readiness_fallback_family_constraint: 'different',
  review_risk: 'low',
  required_review_families: 1,
  l1_required: false,
  cross_family_required: false,
  cross_family_satisfied: true,
  review_diff_scope: 'full',
  source: 'override',
  work_domain: 'mixed',
  domain_source: 'none',
  // Capability/provenance fields
  capability_state_source: 'unknown',
  quota_status: 'ok',
  quota_reset_at: null,
  skill_mode_requested: 'selective',
  skill_mode_effective: 'selective',
  capability_warnings: ['warning 1'],
  reviewer_endpoint: '',
  implementer_endpoint: '',
  verification_author_present: false,
  verification_author_engine: '',
  verification_author_runner: '',
  verification_author_effort: '',
  verification_author_endpoint: '',
  verification_author_family: 'unknown',
  implementer_family: 'unknown',
  config_path: '',
  min_panel_size: 3,
  on_engine_unavailable: 'ask',
  reviewer_engine_low_risk: '',
  reviewer_effort_low_risk: '',
  on_family_conflict: 'fallback',
  reviewer_fallback_preference: [],
  reviewer_fallback_preference_low_risk: [],
};

const validated = logPayloadCase('validated', validPayload);
if (validated) {
  console.log(`validated=true`);
  console.log(`capability_state_source=${validated.capability_state_source}`);
  console.log(`quota_status=${validated.quota_status}`);
  console.log(`quota_reset_at=${validated.quota_reset_at}`);
  console.log(`skill_mode_requested=${validated.skill_mode_requested}`);
  console.log(`skill_mode_effective=${validated.skill_mode_effective}`);
  console.log(`capability_warnings_0=${validated.capability_warnings[0]}`);
  console.log(`reviewer_endpoint=${validated.reviewer_endpoint}`);
  console.log(`implementer_endpoint=${validated.implementer_endpoint}`);
  console.log(`plan_review=${validated.plan_review}`);
}

const planOn = logPayloadCase('plan_on', {
  ...validPayload,
  plan_review: 'on',
  plan_reviewer_engine: 'claude-fable-5',
  plan_reviewer_effort: 'high',
  plan_reviewer_runner: 'claude-native',
});
if (planOn) {
  console.log(`plan_on_runner=${planOn.plan_reviewer_runner}`);
}
logPayloadCase('plan_on_blank_runner', {
  ...validPayload,
  plan_review: 'on',
  plan_reviewer_engine: 'claude-fable-5',
  plan_reviewer_effort: 'high',
  plan_reviewer_runner: '',
});

const payloadWithResetString = {
  ...validPayload,
  quota_reset_at: '2026-07-04T00:00:00Z',
  reviewer_endpoint: 'http://reviewer',
  implementer_endpoint: 'http://implementer',
};
const validated2 = logPayloadCase('validated2', payloadWithResetString);
if (validated2) {
  console.log(`validated2=true`);
  console.log(`quota_reset_at2=${validated2.quota_reset_at}`);
  console.log(`reviewer_endpoint2=${validated2.reviewer_endpoint}`);
  console.log(`implementer_endpoint2=${validated2.implementer_endpoint}`);
}

logPayloadCase('invalid_primitive_type', {
  ...validPayload,
  verification_author_present: 'false',
});
for (const [name, overrides] of [
  ['nonstring_engine', { verification_author_engine: 1 }],
  ['nonstring_runner', { verification_author_runner: 1 }],
  ['nonstring_effort', { verification_author_effort: 1 }],
  ['nonstring_endpoint', { verification_author_endpoint: 1 }],
  ['nonstring_family', { verification_author_family: 1 }],
  ['nonstring_implementer_family', { implementer_family: 1 }],
  ['nonstring_config_path', { config_path: 1 }],
]) {
  logPayloadCase(name, { ...validPayload, ...overrides });
}
logPayloadCase('invalid_auth_runner', {
  ...validPayload,
  verification_author_present: true,
  verification_author_engine: 'gpt-5.5',
  verification_author_runner: 'bogus-runner',
  verification_author_effort: 'high',
});
logPayloadCase('invalid_auth_effort', {
  ...validPayload,
  verification_author_present: true,
  verification_author_engine: 'gpt-5.5',
  verification_author_runner: 'agy',
  verification_author_effort: 'bogus-effort',
});
logPayloadCase('invalid_auth_endpoint', { ...validPayload, verification_author_present: true, verification_author_engine: 'glm-5.2', verification_author_runner: 'cc-shim', verification_author_effort: 'high', verification_author_endpoint: 'invalid-endpoint' });

for (const [name, overrides] of [
  ['false_nonempty_engine', { verification_author_present: false, verification_author_engine: 'gpt-5.5' }],
  ['false_nonempty_runner', { verification_author_present: false, verification_author_runner: 'agy' }],
  ['false_nonempty_effort', { verification_author_present: false, verification_author_effort: 'high' }],
  ['false_nonempty_endpoint', { verification_author_present: false, verification_author_endpoint: 'http://verification' }],
]) {
  logPayloadCase(name, { ...validPayload, ...overrides });
}

const falseTupleNonempty = {
  ...validPayload,
  verification_author_present: false,
  verification_author_engine: 'gpt-5.5',
  verification_author_runner: 'agy',
  verification_author_effort: 'high',
};
logPayloadCase('false_nonempty_tuple', falseTupleNonempty);

const trueMissingTuple = {
  ...validPayload,
  verification_author_present: true,
};
delete trueMissingTuple.verification_author_engine;
delete trueMissingTuple.verification_author_runner;
delete trueMissingTuple.verification_author_effort;
logPayloadCase('true_missing_tuple', trueMissingTuple);

for (const [name, overrides] of [
  ['true_empty_engine', { verification_author_present: true, verification_author_engine: '' }],
  ['true_empty_runner', { verification_author_present: true, verification_author_runner: '' }],
  ['true_empty_effort', { verification_author_present: true, verification_author_effort: '' }],
]) {
  logPayloadCase(name, { ...validPayload, ...overrides, verification_author_engine: overrides.verification_author_engine ?? 'gpt-5.5', verification_author_runner: overrides.verification_author_runner ?? 'agy', verification_author_effort: overrides.verification_author_effort ?? 'high', });
}

const presentTrueAccepted = {
  ...validPayload,
  verification_author_present: true,
  verification_author_engine: 'gpt-5.5',
  verification_author_runner: 'agy',
  verification_author_effort: 'high',
  verification_author_endpoint: '',
  verification_author_family: 'unknown',
};
const presentTrue = logPayloadCase('present_true_empty_endpoint', presentTrueAccepted);
if (presentTrue) {
  console.log(`present_true_endpoint=${presentTrue.verification_author_endpoint}`);
  console.log(`present_true_family=${presentTrue.verification_author_family}`);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "validateReviewLoopConfig validates new fields process exits 0"
assert_contains "$OUT" "validated=true" "validateReviewLoopConfig validates payload with new fields"
assert_contains "$OUT" "capability_state_source=unknown" "validateReviewLoopConfig carries capability_state_source"
assert_contains "$OUT" "quota_status=ok" "validateReviewLoopConfig carries quota_status"
assert_contains "$OUT" "quota_reset_at=null" "validateReviewLoopConfig carries quota_reset_at"
assert_contains "$OUT" "skill_mode_requested=selective" "validateReviewLoopConfig carries skill_mode_requested"
assert_contains "$OUT" "skill_mode_effective=selective" "validateReviewLoopConfig carries skill_mode_effective"
assert_contains "$OUT" "capability_warnings_0=warning 1" "validateReviewLoopConfig carries capability_warnings"
assert_contains "$OUT" "reviewer_endpoint=" "validateReviewLoopConfig carries empty reviewer_endpoint"
assert_contains "$OUT" "implementer_endpoint=" "validateReviewLoopConfig carries empty implementer_endpoint"
assert_contains "$OUT" "plan_review=off" "validateReviewLoopConfig carries disabled plan rail"
assert_contains "$OUT" "plan_on=ok" "validateReviewLoopConfig accepts a complete plan-review chair tuple"
assert_contains "$OUT" "plan_on_runner=claude-native" "validateReviewLoopConfig preserves exact plan-review runner"
assert_contains "$OUT" "plan_on_blank_runner=review-loop output JSON field plan_reviewer_runner must be a non-empty string when plan_review=on" "validateReviewLoopConfig fails loud on an incomplete plan-review chair tuple"
assert_contains "$OUT" "validated2=true" "validateReviewLoopConfig validates payload with string quota_reset_at"
assert_contains "$OUT" "quota_reset_at2=2026-07-04T00:00:00Z" "validateReviewLoopConfig carries string quota_reset_at"
assert_contains "$OUT" "reviewer_endpoint2=http://reviewer" "validateReviewLoopConfig carries string reviewer_endpoint"
assert_contains "$OUT" "implementer_endpoint2=http://implementer" "validateReviewLoopConfig carries string implementer_endpoint"
assert_contains "$OUT" "invalid_primitive_type=review-loop output JSON field verification_author_present must be a boolean" "validateReviewLoopConfig rejects wrong primitive type"
assert_contains "$OUT" "nonstring_engine=review-loop output JSON field verification_author_engine must be a string" "validateReviewLoopConfig rejects non-string verification_author_engine"
assert_contains "$OUT" "nonstring_runner=review-loop output JSON field verification_author_runner must be a string" "validateReviewLoopConfig rejects non-string verification_author_runner"
assert_contains "$OUT" "nonstring_effort=review-loop output JSON field verification_author_effort must be a string" "validateReviewLoopConfig rejects non-string verification_author_effort"
assert_contains "$OUT" "nonstring_endpoint=review-loop output JSON field verification_author_endpoint must be a string" "validateReviewLoopConfig rejects non-string verification_author_endpoint"
assert_contains "$OUT" "nonstring_family=review-loop output JSON field verification_author_family must be a string" "validateReviewLoopConfig rejects non-string verification_author_family"
assert_contains "$OUT" "nonstring_implementer_family=review-loop output JSON field implementer_family must be a string" "validateReviewLoopConfig rejects non-string implementer_family"
assert_contains "$OUT" "nonstring_config_path=review-loop output JSON field config_path must be a string" "validateReviewLoopConfig rejects non-string config_path"
assert_contains "$OUT" "invalid_auth_runner=review-loop output JSON field verification_author_runner must be one of:" "validateReviewLoopConfig rejects invalid authorization runner"
assert_contains "$OUT" "invalid_auth_effort=review-loop output JSON field verification_author_effort must be one of:" "validateReviewLoopConfig rejects invalid authorization effort"
assert_contains "$OUT" "invalid_auth_endpoint=review-loop output JSON field verification_author_endpoint must be" "validateReviewLoopConfig rejects invalid endpoint name"
assert_contains "$OUT" "[A-Za-z0-9_]" "validateReviewLoopConfig diagnostic allowed characters"
assert_contains "$OUT" "false_nonempty_tuple=review-loop output JSON field verification_author_engine must be an empty string" "validateReviewLoopConfig rejects false auth tuple with non-empty values"
assert_contains "$OUT" "false_nonempty_engine=review-loop output JSON field verification_author_engine must be an empty string" "validateReviewLoopConfig rejects false auth tuple with non-empty engine"
assert_contains "$OUT" "false_nonempty_runner=review-loop output JSON field verification_author_runner must be an empty string" "validateReviewLoopConfig rejects false auth tuple with non-empty runner"
assert_contains "$OUT" "false_nonempty_effort=review-loop output JSON field verification_author_effort must be an empty string" "validateReviewLoopConfig rejects false auth tuple with non-empty effort"
assert_contains "$OUT" "false_nonempty_endpoint=review-loop output JSON field verification_author_endpoint must be an empty string" "validateReviewLoopConfig rejects false auth tuple with non-empty endpoint"
assert_contains "$OUT" "true_missing_tuple=review-loop output JSON missing field: verification_author_engine" "validateReviewLoopConfig rejects missing auth tuple fields when present"
assert_contains "$OUT" "true_empty_engine=review-loop output JSON field verification_author_engine must be a non-empty string" "validateReviewLoopConfig rejects true auth tuple with empty engine"
assert_contains "$OUT" "true_empty_runner=review-loop output JSON field verification_author_runner must be a non-empty string" "validateReviewLoopConfig rejects true auth tuple with empty runner"
assert_contains "$OUT" "true_empty_effort=review-loop output JSON field verification_author_effort must be a non-empty string" "validateReviewLoopConfig rejects true auth tuple with empty effort"
assert_contains "$OUT" "present_true_empty_endpoint=ok" "validateReviewLoopConfig accepts present auth tuple with empty endpoint"
assert_contains "$OUT" "present_true_endpoint=" "validateReviewLoopConfig preserves empty authorization endpoint for accepted tuple"
assert_contains "$OUT" "present_true_family=unknown" "validateReviewLoopConfig accepts unknown authorization family"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { buildReviewArgs } = require(path.join(root, 'src', 'engine'));

const argsWithSpec = buildReviewArgs({
  diffFile: 'relative-diff.diff',
  specFile: 'some-spec.md',
  roster: {
    reviewer_engine: 'test-rev-model',
    reviewer_effort: 'high',
    reviewer_runner: 'test-rev-runner',
  },
});
console.log(`args_with_spec=${argsWithSpec.join(' ')}`);

const argsWithoutSpec = buildReviewArgs({
  diffFile: 'relative-diff.diff',
  roster: {
    reviewer_engine: 'test-rev-model',
    reviewer_effort: 'high',
    reviewer_runner: 'test-rev-runner',
  },
});
console.log(`args_without_spec=${argsWithoutSpec.join(' ')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine buildReviewArgs process exits 0"
assert_contains "$OUT" "--spec-file some-spec.md" "buildReviewArgs appends specFile when set"
assert_not_contains "$OUT" "args_without_spec=.*--spec-file" "buildReviewArgs omits specFile when absent"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

let reviewArgsDefault = null;
let reviewArgsNoSpec = null;

const createEngine = (noReviewSpec) => new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        branch: 'branch',
        base: 'base',
        commit: '1234567890123456789012345678901234567890',
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: null,
        agent_log: '/tmp/impl-log',
        error: null,
      },
    };
  },
  reviewDispatcher(args) {
    if (noReviewSpec) reviewArgsNoSpec = args;
    else reviewArgsDefault = args;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
  diffProvider({ round }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-default-repair-diff-'));
    const file = path.join(tmpDir, `round-${round}.diff`);
    fs.writeFileSync(file, `round ${round}`, 'utf8');
    return file;
  },
});

const roster = {
  reviewer_engine: 'test-review-model',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'test-review-runner',
  implementer_engine: 'test-impl-model',
  implementer_effort: 'high',
  implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

const loopArgs = {
  promptFile: path.resolve('/tmp/some-prompt.md'),
  branch: 'repair-loop',
  base: '1111111111111111111111111111111111111111',
  maxRounds: 1,
  roster,
};

createEngine(false).runLegacyImplementationReviewLoop(loopArgs);
createEngine(true).runLegacyImplementationReviewLoop({ ...loopArgs, noReviewSpec: true });

console.log(`default_has_spec=${reviewArgsDefault.includes('--spec-file')}`);
console.log(`default_spec_value=${reviewArgsDefault[reviewArgsDefault.indexOf('--spec-file') + 1] === path.resolve('/tmp/some-prompt.md')}`);
console.log(`no_spec_has_spec=${reviewArgsNoSpec.includes('--spec-file')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine runLegacyImplementationReviewLoop spec-file tests exit 0"
assert_contains "$OUT" "default_has_spec=true" "runLegacyImplementationReviewLoop passes spec-file by default"
assert_contains "$OUT" "default_spec_value=true" "runLegacyImplementationReviewLoop uses prompt file as spec file by default"
assert_contains "$OUT" "no_spec_has_spec=false" "runLegacyImplementationReviewLoop suppresses spec-file when noReviewSpec is true"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  reviewLoopResolver() {
    calls.push({
      phase: 'resolve',
      args: Array.from(arguments[0] || []),
    });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'gpt-5.3-codex-spark',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  reviewDispatcher(args) {
    calls.push({
      phase: 'review',
      args: Array.from(args || []),
    });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const sensitiveDiff = `${diffBase}.sensitive.diff`;
fs.writeFileSync(
  sensitiveDiff,
  [
    'diff --git a/auth/tenant-auth.ts b/auth/tenant-auth.ts',
    'index 1111111..2222222 100644',
    '--- a/auth/tenant-auth.ts',
    '+++ b/auth/tenant-auth.ts',
    '@@ -1,2 +1,2 @@',
    ' const user = tenant_id;',
    '+const tenantBoundary = true;',
  ].join('\n') + '\n',
);

const sensitiveResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: sensitiveDiff,
  implementerEngine: 'gpt-5.3-codex-spark',
  sourceTrust: 'low',
  oracleAvailable: 1,
  securitySurface: 0,
});

const sensitiveResolveArgs = calls.find((entry) => entry.phase === 'resolve')?.args.join(' ') || '';
const sensitiveReviewArgs = calls.find((entry) => entry.phase === 'review')?.args.join(' ') || '';
console.log(`sensitive_status=${sensitiveResult.status}`);
console.log(`sensitive_adversarial=${sensitiveResult.riskClassification && sensitiveResult.riskClassification.adversarial_review}`);
console.log(`sensitive_domains=${JSON.stringify(sensitiveResult.riskClassification ? sensitiveResult.riskClassification.domains : [])}`);
console.log(`sensitive_checklists=${JSON.stringify(sensitiveResult.riskClassification ? sensitiveResult.riskClassification.checklists : [])}`);
console.log(`sensitive_resolve_args=${sensitiveResolveArgs}`);
console.log(`sensitive_review_args=${sensitiveReviewArgs}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff dynamic-risk sensitive diff process exits 0"
assert_contains "$OUT" "sensitive_status=reviewed" "dynamic sensitive diff is reviewed"
assert_contains "$OUT" "sensitive_adversarial=true" "dynamic sensitive diff flagged adversarial"
assert_contains "$OUT" "sensitive_resolve_args=--check-scorecard --source-trust low" "risk flags from classifier flow into resolve args"
assert_contains "$OUT" "sensitive_review_args=--checklists authz-boundary,tenant-boundary" "classifier checklists are appended to review args"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const calls = [];
const engine = new AutopilotEngine({
  reviewLoopResolver() {
    calls.push({
      phase: 'resolve',
      args: Array.from(arguments[0] || []),
    });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'test-review-model',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'gpt-5.5',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  reviewDispatcher(args) {
    calls.push({
      phase: 'review',
      args: Array.from(args || []),
    });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const lowriskDiff = `${diffBase}.sampling.diff`;
fs.writeFileSync(
  lowriskDiff,
  [
    'diff --git a/docs/readme.md b/docs/readme.md',
    'index 1111111..2222222 100644',
    '--- a/docs/readme.md',
    '+++ b/docs/readme.md',
    '@@ -1,2 +1,3 @@',
    ' # README',
    '+more docs content',
  ].join('\n') + '\n',
);

const lowriskResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: lowriskDiff,
  implementerEngine: 'gpt-5.5',
  sourceTrust: 'high',
  oracleAvailable: 1,
  securitySurface: 0,
  samplingRatio: 1,
  samplingSeed: 'engine-test-sampling',
});

const lowriskReviewArgs = calls.find((entry) => entry.phase === 'review')?.args.join(' ') || '';
console.log(`sampling_status=${lowriskResult.status}`);
console.log(`sampling_adversarial=${lowriskResult.riskClassification && lowriskResult.riskClassification.adversarial_review}`);
console.log(`sampling_selected=${lowriskResult.riskClassification && lowriskResult.riskClassification.sampling ? lowriskResult.riskClassification.sampling.selected : false}`);
console.log(`sampling_reason=${lowriskResult.riskClassification && lowriskResult.riskClassification.sampling ? lowriskResult.riskClassification.sampling.reason : ''}`);
console.log(`sampling_checklists=${JSON.stringify(lowriskResult.riskClassification ? lowriskResult.riskClassification.checklists : [])}`);
console.log(`sampling_review_args=${lowriskReviewArgs}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff low-risk sampling run exits 0"
assert_contains "$OUT" "sampling_status=reviewed" "low-risk sampling run is reviewed"
assert_contains "$OUT" "sampling_adversarial=true" "sampling-selected low-risk diff is adversarial"
assert_contains "$OUT" "sampling_selected=true" "sampling-selected bit is preserved"
assert_contains "$OUT" "sampling_reason=low-risk-sampling" "sampling reason is low-risk-sampling"
assert_contains "$OUT" "sampling_checklists=[\"sampling-sanity\"]" "sampling-sanity checklist is injected"
assert_contains "$OUT" "sampling_review_args=--checklists sampling-sanity" "sampling checklist is appended to review args"

OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const engine = new AutopilotEngine({
  reviewLoopResolver() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        reviewer_engine: 'gpt-5.5',
        reviewer_effort: 'xhigh',
        reviewer_runner: 'test-review-runner',
        implementer_engine: 'gpt-5.5',
        implementer_effort: 'high',
        implementer_runner: 'test-impl-runner',
        loop_max_rounds: 1,
        loop_convergence_verdict: 'SHIP-AS-IS',
      },
    };
  },
  reviewDispatcher() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'test-review-runner',
        model: 'test-review-model',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: 'none',
        raw_log: '/tmp/log',
        error: null,
      },
    };
  },
});

const sameFamilyDiff = `${diffBase}.same-family.diff`;
fs.writeFileSync(
  sameFamilyDiff,
  [
    'diff --git a/docs/changelog.md b/docs/changelog.md',
    'index 1111111..2222222 100644',
    '--- a/docs/changelog.md',
    '+++ b/docs/changelog.md',
    '@@ -1,1 +1,2 @@',
    '+docs update',
  ].join('\n') + '\n',
);

const sameFamilyResult = engine.reviewDiff({
  dynamicReviewRisk: true,
  diffFile: sameFamilyDiff,
  implementerEngine: 'gpt-5.5',
  sourceTrust: 'high',
  oracleAvailable: 1,
  securitySurface: 0,
});

console.log(`same_family_status=${sameFamilyResult.status}`);
console.log(`same_family_phase=${sameFamilyResult.phase}`);
console.log(`same_family_reason=${sameFamilyResult.reason}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewDiff same-family block process exits 0"
assert_contains "$OUT" "same_family_status=blocked" "same-family family-decorrelation blocks review"
assert_contains "$OUT" "same_family_phase=reviewer_family" "same-family block phase is reviewer_family"
assert_contains "$OUT" "same_family_reason=reviewer and implementer must be different families" "same-family block reason is explicit"

# --- risk-tiered low-risk reviewer overlay (v2.32.23) --------------------------
# resolver roster carries reviewer_engine_low_risk/_effort_low_risk; the engine
# must substitute the pair ONLY when computed review_risk=low AND both keys set.
OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const tierDiff = `${diffBase}.lowrisk-tier.diff`;
fs.writeFileSync(
  tierDiff,
  [
    'diff --git a/docs/notes.md b/docs/notes.md',
    'index 1111111..2222222 100644',
    '--- a/docs/notes.md',
    '+++ b/docs/notes.md',
    '@@ -1,1 +1,2 @@',
    '+docs update',
  ].join('\n') + '\n',
);

function makeEngine(reviewRisk, lowRiskPair) {
  return new AutopilotEngine({
    reviewLoopResolver() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          reviewer_engine: 'gpt-5.5',
          reviewer_effort: 'xhigh',
          reviewer_runner: 'test-review-runner',
          implementer_engine: 'gpt-5.3-codex-spark',
          implementer_effort: 'high',
          implementer_runner: 'test-impl-runner',
          loop_max_rounds: 1,
          loop_convergence_verdict: 'SHIP-AS-IS',
          review_risk: reviewRisk,
          ...lowRiskPair,
        },
      };
    },
    reviewDispatcher() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          runner: 'test-review-runner', model: 'x', status: 'reviewed',
          verdict: 'SHIP-AS-IS', findings: 'none', raw_log: '/tmp/log', error: null,
        },
      };
    },
  });
}

const pair = { reviewer_engine_low_risk: 'gpt-5.6-sol', reviewer_effort_low_risk: 'high' };

const low = makeEngine('low', pair).reviewDiff({ diffFile: tierDiff, implementerEngine: 'claude-opus' });
console.log(`tier_low_status=${low.status}`);
console.log(`tier_low_model=${low.reviewArgs.join(' ').includes('--model gpt-5.6-sol') && low.reviewArgs.join(' ').includes('--effort high')}`);
console.log(`tier_low_roster=${low.roster.reviewer_engine}`);

const high = makeEngine('high', pair).reviewDiff({ diffFile: tierDiff, implementerEngine: 'claude-opus' });
console.log(`tier_high_model=${high.reviewArgs.join(' ').includes('--model gpt-5.5') && high.reviewArgs.join(' ').includes('--effort xhigh')}`);

const half = makeEngine('low', { reviewer_engine_low_risk: 'gpt-5.6-sol', reviewer_effort_low_risk: '' })
  .reviewDiff({ diffFile: tierDiff, implementerEngine: 'claude-opus' });
console.log(`tier_half_model=${half.reviewArgs.join(' ').includes('--model gpt-5.5')}`);

// PRE-RESOLVED roster path (the canonical implement-review loop: roster passed
// in, dynamicReviewRisk off, resolveResult never populated) — the tier must key
// off roster.review_risk itself. Live-found gap 2026-07-13: /l5 e2e run showed
// roster.review_risk:"low" + both _low_risk keys with the reviewer stuck on the
// incumbent, because reviewRisk was only ever read from resolveResult.
const pre = makeEngine('unused', {}).reviewDiff({
  diffFile: tierDiff,
  implementerEngine: 'claude-opus',
  roster: {
    reviewer_engine: 'gpt-5.5',
    reviewer_effort: 'xhigh',
    reviewer_runner: 'test-review-runner',
    implementer_engine: 'gpt-5.3-codex-spark',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
    review_risk: 'low',
    reviewer_engine_low_risk: 'gpt-5.6-sol',
    reviewer_effort_low_risk: 'high',
  },
});
console.log(`tier_pre_model=${pre.reviewArgs.join(' ').includes('--model gpt-5.6-sol') && pre.reviewArgs.join(' ').includes('--effort high')}`);
console.log(`tier_pre_roster=${pre.roster.reviewer_engine}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "low-risk tier overlay run exits 0"
assert_contains "$OUT" "tier_low_status=reviewed" "low-risk tier run is reviewed"
assert_contains "$OUT" "tier_low_model=true" "review_risk=low + both keys → low-risk pair drives --model/--effort"
assert_contains "$OUT" "tier_low_roster=gpt-5.6-sol" "returned roster self-documents the substitution"
assert_contains "$OUT" "tier_high_model=true" "review_risk=high always keeps the incumbent pair"
assert_contains "$OUT" "tier_half_model=true" "half-set low-risk pair keeps the incumbent (fail-safe)"
assert_contains "$OUT" "tier_pre_model=true" "PRE-RESOLVED roster path: roster.review_risk drives the tier (live-found gap)"
assert_contains "$OUT" "tier_pre_roster=gpt-5.6-sol" "pre-resolved path roster self-documents the substitution"

# --- family-conflict fallback (v2.32.25) ---------------------------------------
# On reviewer/implementer same-family conflict: mode=fallback walks the qualified
# cross-family ladder (runner-allowlisted, provenance-checked, codex rows need a
# calibrated effort); every guard failure blocks exactly as pre-v2.32.25.
OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const diffBase = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const fbDiff = `${diffBase}.family-fb.diff`;
fs.writeFileSync(
  fbDiff,
  [
    'diff --git a/docs/notes.md b/docs/notes.md',
    'index 1111111..2222222 100644',
    '--- a/docs/notes.md',
    '+++ b/docs/notes.md',
    '@@ -1,1 +1,2 @@',
    '+docs update',
  ].join('\n') + '\n',
);

function engineWith() {
  return new AutopilotEngine({
    reviewLoopResolver() { throw new Error('resolver must not be called (pre-resolved roster)'); },
    reviewDispatcher() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          runner: 'x', model: 'x', status: 'reviewed',
          verdict: 'SHIP-AS-IS', findings: 'none', raw_log: '/tmp/log', error: null,
        },
      };
    },
  });
}
const baseRoster = {
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  implementer_engine: 'gpt-5.3-codex-spark',
  implementer_effort: 'high',
  implementer_runner: 'auto',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
function run(extra) {
  return engineWith().reviewDiff({
    diffFile: fbDiff,
    implementerEngine: 'gpt-5.3-codex-spark',
    roster: { ...baseRoster, ...extra },
  });
}

// mixed ladder: same-family row, allowlist-rejected runner, codex row without
// calibrated effort — all skipped; claude-native haiku selected.
const LADDER = [
  { engine: 'gpt-5.6-terra', runner: 'codex', family: 'openai', effort: 'high' },
  { engine: 'claude-opus', runner: 'bogus-runner', family: 'anthropic' },
  { engine: 'claude-opus', runner: 'codex', family: 'anthropic', effort: null },
  // R2 trap: cross-family display engine but SAME-family dispatch model — must be skipped
  { engine: 'claude-sneak', runner: 'claude-native', family: 'anthropic', model: 'gpt-5.4-mini' },
  { engine: 'claude-haiku', runner: 'claude-native', family: 'anthropic', effort: null, model: 'haiku' },
];

const fb = run({ on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`fb_status=${fb.status}`);
console.log(`fb_args=${(fb.reviewArgs || []).join(' ').includes('--runner claude-native') && (fb.reviewArgs || []).join(' ').includes('--model haiku')}`);
console.log(`fb_ledger=${fb.ledger.some((e) => e.unit === 'reviewer_family_fallback')}`);

const blockMode = run({ on_family_conflict: 'block', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`fb_blockmode=${blockMode.status}:${blockMode.phase}`);

const absentMode = run({ fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' });
console.log(`fb_absentmode=${absentMode.status}:${absentMode.phase}`);

const staleProv = run({ on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'anthropic' });
console.log(`fb_staleprov=${staleProv.status}:${staleProv.phase}`);

const noCandidate = run({ on_family_conflict: 'fallback', fallback_ladder: [LADDER[0], LADDER[1], LADDER[2]], fallback_ladder_implementer_family: 'openai' });
console.log(`fb_nocand=${noCandidate.status}:${noCandidate.phase}`);

// v2.32.26 preference lists: human order beats ladder order (guards still apply)
const OPUS_LADDER = LADDER.concat([{ engine: 'claude-opus-cal', runner: 'claude-native', family: 'anthropic', model: 'opus' }]);
const fbPref = run({
  on_family_conflict: 'fallback', fallback_ladder: OPUS_LADDER, fallback_ladder_implementer_family: 'openai',
  reviewer_fallback_preference: ['not-in-ladder', 'claude-opus-cal', 'claude-haiku'],
});
console.log(`pref_model=${(fbPref.reviewArgs || []).join(' ').includes('--model opus')}`);

// low-risk list wins when review_risk=low
const fbPrefLow = run({
  on_family_conflict: 'fallback', fallback_ladder: OPUS_LADDER, fallback_ladder_implementer_family: 'openai',
  review_risk: 'low',
  reviewer_engine_low_risk: '', reviewer_effort_low_risk: '',
  reviewer_fallback_preference: ['claude-opus-cal'],
  reviewer_fallback_preference_low_risk: ['claude-haiku'],
});
console.log(`pref_low_model=${(fbPrefLow.reviewArgs || []).join(' ').includes('--model haiku')}`);

// empty preference → ladder order unchanged (haiku first valid)
const fbPrefEmpty = run({
  on_family_conflict: 'fallback', fallback_ladder: OPUS_LADDER, fallback_ladder_implementer_family: 'openai',
  reviewer_fallback_preference: [], reviewer_fallback_preference_low_risk: [],
});
console.log(`pref_empty_model=${(fbPrefEmpty.reviewArgs || []).join(' ').includes('--model haiku')}`);

// R6 Minor: with requireQualifiedReviewer, the EFFECTIVE fallback reviewer is
// certified by the selected qualified ladder row, not the incumbent's flag.
const fbQual = engineWith().reviewDiff({
  diffFile: fbDiff,
  implementerEngine: 'gpt-5.3-codex-spark',
  requireQualifiedReviewer: true,
  roster: { ...baseRoster, reviewer_qualified: false, on_family_conflict: 'fallback', fallback_ladder: LADDER, fallback_ladder_implementer_family: 'openai' },
});
console.log(`fb_qual=${fbQual.status}`);

// tier tuple qualification: ladder WITHOUT the tier pair → revert to incumbent
const tierLadderMiss = engineWith().reviewDiff({
  diffFile: fbDiff,
  implementerEngine: 'claude-opus',
  roster: {
    ...baseRoster,
    review_risk: 'low',
    reviewer_engine_low_risk: 'gpt-5.6-sol',
    reviewer_effort_low_risk: 'high',
    fallback_ladder: [{ engine: 'gpt-5.5', runner: 'codex', effort: 'xhigh', family: 'openai' }],
    fallback_ladder_implementer_family: 'anthropic',
  },
});
console.log(`tier_miss_model=${(tierLadderMiss.reviewArgs || []).join(' ').includes('--model gpt-5.5')}`);
console.log(`tier_miss_ledger=${tierLadderMiss.ledger.some((e) => e.unit === 'tier_reviewer_unqualified')}`);

// tier tuple qualification: ladder WITH the tuple (engine+runner+codex effort) → tier holds
const tierLadderHit = engineWith().reviewDiff({
  diffFile: fbDiff,
  implementerEngine: 'claude-opus',
  roster: {
    ...baseRoster,
    review_risk: 'low',
    reviewer_engine_low_risk: 'gpt-5.6-sol',
    reviewer_effort_low_risk: 'high',
    fallback_ladder: [{ engine: 'gpt-5.6-sol', runner: 'codex', effort: 'high', family: 'openai' }],
    fallback_ladder_implementer_family: 'anthropic',
  },
});
console.log(`tier_hit_model=${(tierLadderHit.reviewArgs || []).join(' ').includes('--model gpt-5.6-sol')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "family-fallback run exits 0"
assert_contains "$OUT" "fb_status=reviewed" "conflict+fallback: review actually runs"
assert_contains "$OUT" "fb_args=true" "fallback selects the first valid cross-family row (claude-haiku/claude-native)"
assert_contains "$OUT" "fb_ledger=true" "fallback is ledger'd (reviewer_family_fallback)"
assert_contains "$OUT" "fb_blockmode=blocked:reviewer_family" "mode=block keeps the hard block"
assert_contains "$OUT" "fb_absentmode=blocked:reviewer_family" "absent on_family_conflict fails closed to block"
assert_contains "$OUT" "fb_staleprov=blocked:reviewer_family" "stale ladder provenance blocks (pre-resolved roster protection)"
assert_contains "$OUT" "fb_nocand=blocked:reviewer_family" "no valid cross-family candidate blocks"
assert_contains "$OUT" "fb_qual=reviewed" "fallback row certifies effective qualification (incumbent flag unused)"
assert_contains "$OUT" "pref_model=true" "preference order beats ladder order (invalid preferred skipped)"
assert_contains "$OUT" "pref_low_model=true" "low-risk preference list wins on review_risk=low"
assert_contains "$OUT" "pref_empty_model=true" "empty preference keeps pure ladder order"
assert_contains "$OUT" "tier_miss_model=true" "tier pair absent from qualified ladder reverts to incumbent"
assert_contains "$OUT" "tier_miss_ledger=true" "tier revert is ledger'd (tier_reviewer_unqualified)"
assert_contains "$OUT" "tier_hit_model=true" "tier tuple present in ladder → tier holds"

# --- GAP 1: reviewer_endpoint wiring into dispatch-review args (v2.32.45) ---
OUT="$(node - "$REPO_ROOT" "$DIFF" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

function mk(capture) {
  return new AutopilotEngine({
    clock: () => '2026-07-01T00:00:00.000Z',
    reviewDispatcher(args) {
      capture.args = args;
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: { runner: 'r', model: 'm', status: 'reviewed', verdict: 'SHIP-AS-IS', findings: '', raw_log: '/tmp/l', error: null },
      };
    },
  });
}

// (a) endpoint-capable runner + non-empty valid endpoint -> --endpoint minimax
let capA = {};
let a = mk(capA).reviewDiff({ diffFile: diff, roster: {
  reviewer_engine: 'minimax-m3', reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_endpoint: 'minimax',
}});
console.log(`a_status=${a.status}`);
console.log(`a_args=${capA.args.join(' ')}`);

// (c) non-endpoint runner never gets --endpoint (endpoint present but runner is codex)
let capC = {};
let c = mk(capC).reviewDiff({ diffFile: diff, roster: {
  reviewer_engine: 'gpt-5.5', reviewer_effort: 'high', reviewer_runner: 'codex', reviewer_endpoint: 'minimax',
}});
console.log(`c_status=${c.status}`);
console.log(`c_has_endpoint=${capC.args.includes('--endpoint')}`);

// endpoint-capable runner but INVALID endpoint name (a URL) -> no --endpoint (fail-safe)
let capU = {};
mk(capU).reviewDiff({ diffFile: diff, roster: {
  reviewer_engine: 'minimax-m3', reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_endpoint: 'http://x',
}});
console.log(`u_has_endpoint=${capU.args.includes('--endpoint')}`);

// (b) family-conflict fallback substitution blanks the endpoint (never inherited)
let capB = {};
let b = mk(capB).reviewDiff({ diffFile: diff, roster: {
  reviewer_engine: 'minimax-m3', reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_endpoint: 'minimax',
  implementer_engine: 'minimax-m3',
  on_family_conflict: 'fallback',
  fallback_ladder_implementer_family: 'minimax',
  fallback_ladder: [{ engine: 'claude-haiku', model: 'haiku', runner: 'claude-native' }],
}});
console.log(`b_status=${b.status}`);
console.log(`b_runner=${b.roster.reviewer_runner}`);
console.log(`b_endpoint=${JSON.stringify(b.roster.reviewer_endpoint)}`);
console.log(`b_has_endpoint=${capB.args.includes('--endpoint')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine reviewer_endpoint wiring process exits 0"
assert_contains "$OUT" "a_status=reviewed" "endpoint-capable reviewer runs"
assert_contains "$OUT" "--endpoint minimax" "endpoint-capable runner + valid endpoint passes --endpoint minimax"
assert_contains "$OUT" "c_status=reviewed" "non-endpoint reviewer runs"
assert_contains "$OUT" "c_has_endpoint=false" "non-endpoint runner (codex) never receives --endpoint"
assert_contains "$OUT" "u_has_endpoint=false" "endpoint-capable runner with invalid endpoint name gets no --endpoint (fail-safe)"
assert_contains "$OUT" "b_status=reviewed" "family-conflict fallback still reviews"
assert_contains "$OUT" "b_runner=claude-native" "family-conflict fallback substitutes the cross-family runner"
assert_contains "$OUT" 'b_endpoint=""' "family-conflict fallback blanks the substituted reviewer's endpoint"
assert_contains "$OUT" "b_has_endpoint=false" "substituted fallback reviewer never inherits the incumbent endpoint"

# --- GAP 2: --resume re-enters review without re-dispatching implementation (v2.32.45) ---
RESUME_PROMPT="$TEST_TMP/resume-loop-prompt.txt"
printf 'resume prompt\n' > "$RESUME_PROMPT"
OUT="$(node - "$REPO_ROOT" "$RESUME_PROMPT" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const BASE = '1111111111111111111111111111111111111111';
const TIP = '2222222222222222222222222222222222222222';
const roster = {
  reviewer_engine: 'test-review-model', reviewer_effort: 'xhigh', reviewer_runner: 'test-review-runner', reviewer_qualified: true,
  implementer_engine: 'test-impl-model', implementer_effort: 'high', implementer_runner: 'test-impl-runner',
  loop_max_rounds: 1, loop_convergence_verdict: 'SHIP-AS-IS',
};

function mk(inspect, counter) {
  return new AutopilotEngine({
    clock: () => '2026-07-01T00:00:00.000Z',
    gitResumeInspect() { return inspect; },
    implementationDispatcher() {
      counter.n += 1;
      return { error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: { status: 'committed', runner: 'x', model: 'x', branch: 'b', base: BASE, commit: TIP, files_changed: 1, insertions: 1, deletions: 0, worktree: null, agent_log: null, error: null } };
    },
    reviewDispatcher() {
      counter.r += 1;
      return { error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: { runner: 'r', model: 'm', status: 'reviewed', verdict: 'SHIP-AS-IS', findings: '', raw_log: '/tmp/l', error: null } };
    },
    diffProvider() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-')); const f = path.join(d, 'r.diff'); fs.writeFileSync(f, 'diff'); return f; },
  });
}

// (d) resume happy path: enters review with ZERO implementation dispatch but the
// REVIEW leg MUST fire (a mutation short-circuiting resume→converged without
// review is caught by d_review_calls / d_review_chain).
let cd = { n: 0, r: 0 };
let d = mk({ error: null, exists: true, tipSha: TIP, baseAncestor: true }, cd).runLegacyImplementationReviewLoop({ promptFile: prompt, branch: 'feat', base: BASE, roster, resume: true });
console.log(`d_status=${d.status}`);
console.log(`d_impl_calls=${cd.n}`);
console.log(`d_review_calls=${cd.r}`);
console.log(`d_review_chain=${d.reviewChain.length}`);
console.log(`d_has_review=${d.review && d.review.status === 'reviewed'}`);
console.log(`d_rounds=${d.rounds}`);
console.log(`d_commit=${d.implementationChain[0].implementation.commit}`);
console.log(`d_runner=${d.implementationChain[0].implementation.runner}`);
console.log(`d_ledger=${d.ledger.map((e) => `${e.unit}:${e.status}`).join(',')}`);

// (e1) missing branch -> resume_invalid, nothing dispatched
let e1 = { n: 0 };
let r1 = mk({ error: null, exists: false, tipSha: null, baseAncestor: false }, e1).runLegacyImplementationReviewLoop({ promptFile: prompt, branch: 'feat', base: BASE, roster, resume: true });
console.log(`e1_status=${r1.status}`);
console.log(`e1_phase=${r1.phase}`);
console.log(`e1_impl_calls=${e1.n}`);
console.log(`e1_rounds=${r1.rounds}`);

// (e2) not ahead (tip === base) -> resume_invalid
let e2 = { n: 0 };
let r2 = mk({ error: null, exists: true, tipSha: BASE, baseAncestor: true }, e2).runLegacyImplementationReviewLoop({ promptFile: prompt, branch: 'feat', base: BASE, roster, resume: true });
console.log(`e2_status=${r2.status}`);
console.log(`e2_phase=${r2.phase}`);
console.log(`e2_impl_calls=${e2.n}`);

// (e3) base not ancestor -> resume_invalid
let e3 = { n: 0 };
let r3 = mk({ error: null, exists: true, tipSha: TIP, baseAncestor: false }, e3).runLegacyImplementationReviewLoop({ promptFile: prompt, branch: 'feat', base: BASE, roster, resume: true });
console.log(`e3_status=${r3.status}`);
console.log(`e3_phase=${r3.phase}`);
console.log(`e3_impl_calls=${e3.n}`);

// (f) no --resume -> today's behavior: implementation IS dispatched
let cf = { n: 0 };
let f = mk({ error: null, exists: true, tipSha: TIP, baseAncestor: true }, cf).runLegacyImplementationReviewLoop({ promptFile: prompt, branch: 'feat', base: BASE, roster });
console.log(`f_status=${f.status}`);
console.log(`f_impl_calls=${cf.n}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "AutopilotEngine --resume process exits 0"
assert_contains "$OUT" "d_status=converged" "resume happy path converges"
assert_contains "$OUT" "d_impl_calls=0" "resume happy path dispatches zero implementations"
assert_contains "$OUT" "d_review_calls=1" "resume happy path FIRES the review leg exactly once (guards against a resume→converged short-circuit that skips review)"
assert_contains "$OUT" "d_review_chain=1" "resume happy path records one review in reviewChain"
assert_contains "$OUT" "d_has_review=true" "resume happy path returns a reviewed review object"
assert_contains "$OUT" "d_rounds=1" "resume happy path runs one review round"
assert_contains "$OUT" "d_commit=2222222222222222222222222222222222222222" "resume happy path reviews the existing branch tip"
assert_contains "$OUT" "d_runner=resume" "resume happy path marks the synthesized implementation as resume"
assert_contains "$OUT" "resume_precheck:resumed" "resume happy path ledgers the precheck"
assert_contains "$OUT" "e1_status=blocked" "resume missing branch blocks"
assert_contains "$OUT" "e1_phase=resume_invalid" "resume missing branch reports resume_invalid"
assert_contains "$OUT" "e1_impl_calls=0" "resume missing branch dispatches nothing"
assert_contains "$OUT" "e1_rounds=0" "resume missing branch runs zero rounds"
assert_contains "$OUT" "e2_status=blocked" "resume not-ahead branch blocks"
assert_contains "$OUT" "e2_phase=resume_invalid" "resume not-ahead branch reports resume_invalid"
assert_contains "$OUT" "e2_impl_calls=0" "resume not-ahead branch dispatches nothing"
assert_contains "$OUT" "e3_status=blocked" "resume non-ancestor base blocks"
assert_contains "$OUT" "e3_phase=resume_invalid" "resume non-ancestor base reports resume_invalid"
assert_contains "$OUT" "e3_impl_calls=0" "resume non-ancestor base dispatches nothing"
assert_contains "$OUT" "f_status=converged" "no --resume converges via normal dispatch"
assert_contains "$OUT" "f_impl_calls=1" "no --resume dispatches implementation as today"

# --- on_engine_unavailable policy wiring (2026-07-17 run E residual) -------------------
# dispatch-hetero v2.32.53 emits status engine_unavailable on quota/rate/auth/overload
# death; the resolver's on_engine_unavailable policy key (ask|solo-fallback|wait-reset)
# must map to a machine-readable action on the engine result instead of depth-0 reading
# raw JSON and applying the policy by hand.

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/impl-engine-unavailable.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

function mkEngine(dispatchStatus, errorText) {
  return new AutopilotEngine({
    implementationDispatcher() {
      return {
        error: null,
        status: 1,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: dispatchStatus,
          runner: 'test-impl-runner',
          model: 'test-impl-model',
          commit: null,
          base: '1111111111111111111111111111111111111111',
          branch: 'impl-branch',
          files_changed: 0,
          insertions: 0,
          deletions: 0,
          worktree: '/tmp/wt',
          agent_log: '/tmp/impl-log',
          error: errorText,
        },
      };
    },
  });
}

function run(policy, dispatchStatus, errorText) {
  const roster = {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
  };
  if (policy !== undefined) roster.on_engine_unavailable = policy;
  const result = mkEngine(dispatchStatus, errorText).implementTask({
    promptFile: prompt,
    branch: 'impl-branch',
    base: '1111111111111111111111111111111111111111',
    roster,
  });
  const eu = result.engine_unavailable || null;
  return [
    `status=${result.status}`,
    `phase=${result.phase}`,
    `eu=${eu ? `${eu.policy}/${eu.action}/${eu.error_class}` : 'null'}`,
    `ledger=${result.ledger.map((entry) => `${entry.unit}:${entry.status}`).join(',')}`,
  ].join(' ');
}

const quotaErr = 'engine unavailable (quota_exhausted): worker exited non-zero (agent exit 1); worktree kept';
const authErr = 'engine unavailable (auth_failed): worker exited non-zero (agent exit 1); worktree kept';

console.log(`a_${run('ask', 'engine_unavailable', quotaErr)}`);
console.log(`b_${run('wait-reset', 'engine_unavailable', quotaErr)}`);
console.log(`c_${run('wait-reset', 'engine_unavailable', authErr)}`);
console.log(`d_${run('solo-fallback', 'engine_unavailable', quotaErr)}`);
console.log(`e_${run('solo-fallback', 'precondition_failed', 'missing binary')}`);
console.log(`f_${run('wait-reset', 'precondition_failed', 'missing binary')}`);
console.log(`g_${run(undefined, 'engine_unavailable', quotaErr)}`);
console.log(`h_${run('ask', 'no_op', null)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "on_engine_unavailable wiring process exits 0"
assert_contains "$OUT" "a_status=blocked" "engine_unavailable stays blocked under ask"
assert_contains "$OUT" "a_status=blocked phase=dispatch_implementation" "engine_unavailable keeps dispatch phase"
assert_contains "$OUT" "eu=ask/escalate/quota_exhausted" "ask policy maps engine_unavailable to escalate with parsed error class"
assert_contains "$OUT" "eu=wait-reset/wait-reset/quota_exhausted" "wait-reset policy maps quota death to wait-reset"
assert_contains "$OUT" "eu=wait-reset/escalate/auth_failed" "auth death escalates even under wait-reset (waiting cannot fix auth)"
assert_contains "$OUT" "eu=solo-fallback/wait-reset/quota_exhausted" "solo-fallback policy routes quota death to wait-reset per behavior matrix"
assert_contains "$OUT" "eu=solo-fallback/solo-fallback/null" "solo-fallback policy maps precondition_failed to solo-fallback"
assert_contains "$OUT" "eu=wait-reset/escalate/null" "wait-reset policy escalates non-quota precondition_failed"
assert_contains "$OUT" "eu=ask/escalate/quota_exhausted" "missing policy fails closed to ask/escalate"
assert_contains "$OUT" "h_status=blocked phase=dispatch_implementation eu=null" "non-unavailable statuses carry no engine_unavailable directive"
assert_contains "$OUT" "a_status=blocked phase=dispatch_implementation eu=ask/escalate/quota_exhausted ledger=dispatch_implementation:engine_unavailable,engine_unavailable_policy:escalate" "engine_unavailable policy decision is ledgered"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/loop-engine-unavailable.txt" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const prompt = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

fs.writeFileSync(prompt, 'implementer prompt');

const engine = new AutopilotEngine({
  implementationDispatcher() {
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'engine_unavailable',
        runner: 'test-impl-runner',
        model: 'test-impl-model',
        commit: null,
        base: '1111111111111111111111111111111111111111',
        branch: 'impl-branch',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: '/tmp/wt',
        agent_log: '/tmp/impl-log',
        error: 'engine unavailable (rate_limited): worker exited non-zero (agent exit 1); worktree kept',
      },
    };
  },
});

const result = engine.runLegacyImplementationReviewLoop({
  promptFile: prompt,
  branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111',
  roster: {
    implementer_engine: 'test-impl-model',
    implementer_effort: 'high',
    implementer_runner: 'test-impl-runner',
    reviewer_engine: 'test-review-model',
    reviewer_effort: 'high',
    reviewer_runner: 'test-review-runner',
    loop_max_rounds: 2,
    loop_convergence_verdict: 'SHIP-AS-IS',
    on_engine_unavailable: 'wait-reset',
  },
});
const eu = result.engine_unavailable || null;
console.log(`loop_status=${result.status}`);
console.log(`loop_eu=${eu ? `${eu.policy}/${eu.action}/${eu.error_class}` : 'null'}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "loop on_engine_unavailable propagation process exits 0"
assert_contains "$OUT" "loop_status=blocked" "loop blocks on engine_unavailable"
assert_contains "$OUT" "loop_eu=wait-reset/wait-reset/rate_limited" "loop propagates the engine_unavailable directive to the final result"

CLEANUP_REPO="$TEST_TMP/cleanup-repo"
CLEANUP_WORKTREE="$TEST_TMP/cleanup-worktree"
git init -q "$CLEANUP_REPO"
git -C "$CLEANUP_REPO" config user.name fixture
git -C "$CLEANUP_REPO" config user.email fixture@example.test
printf 'base\n' >"$CLEANUP_REPO/base.txt"
git -C "$CLEANUP_REPO" add base.txt
git -C "$CLEANUP_REPO" commit -qm "cleanup base"
git -C "$CLEANUP_REPO" branch retained-cleanup
git -C "$CLEANUP_REPO" worktree add -q "$CLEANUP_WORKTREE" retained-cleanup
printf '.autopilot-worktree\n.autopilot-worktree.lock\n' \
  >>"$CLEANUP_REPO/.git/info/exclude"
CLEANUP_TIP="$(git -C "$CLEANUP_REPO" rev-parse retained-cleanup)"
CLEANUP_REASON="implementation-campaign-repair-lineage"
CLEANUP_REASON_SHA="$(printf '%s' "$CLEANUP_REASON" | sha256sum | cut -d' ' -f1)"
cat >"$CLEANUP_WORKTREE/.autopilot-worktree" <<EOF
created_at=1782864000
base_sha=$CLEANUP_TIP
run_id=cleanup-run
loop_id=cleanup-loop
schema=2
branch=retained-cleanup
root_run_id=campaign-v1-$(printf 'a%.0s' {1..64})
retention=lease
retention_owner=campaign-v1-$(printf 'a%.0s' {1..64})
retention_reason_sha256=$CLEANUP_REASON_SHA
retention_expires_at=2000000000
EOF
CLEANUP_INPUT="$(node - "$REPO_ROOT" "$CLEANUP_REPO" "$CLEANUP_WORKTREE" \
  "$CLEANUP_TIP" <<'NODE'
const path = require('path');
const [root, cwd, worktree, tip] = process.argv.slice(2);
const { worktreeInstanceId } = require(
  path.join(root, 'src', 'engine', 'repair-lineage-cleanup'),
);
const { repairLineageCleanupId } = require(
  path.join(root, 'src', 'engine', 'implementation-campaign'),
);
const rootRunId = `campaign-v1-${'a'.repeat(64)}`;
const record = {
  lineage_id: rootRunId,
  branch: 'retained-cleanup',
  worktree,
  expected_tip: tip,
  cleanup_epoch: 1,
  worktree_instance_id: worktreeInstanceId(worktree),
  retention_owner: rootRunId,
  retention_reason: 'implementation-campaign-repair-lineage',
  retention_expires_at: 2000000000,
};
process.stdout.write(JSON.stringify({
  cwd,
  cleanupId: repairLineageCleanupId({
    lineageId: record.lineage_id,
    branch: record.branch,
    worktree: record.worktree,
    expectedTip: record.expected_tip,
    cleanupEpoch: record.cleanup_epoch,
    worktreeInstanceId: record.worktree_instance_id,
  }),
  record,
  cleanupHelper: path.join(root, 'src', 'engine', 'repair-lineage-cleanup.js'),
}));
NODE
)"
mkdir -p "$CLEANUP_REPO/.git/autopilot"
node - "$REPO_ROOT" "$CLEANUP_INPUT" \
  "$CLEANUP_REPO/.git/autopilot/repair-lineage-cleanup.jsonl" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, inputJson, journal] = process.argv.slice(2);
const { canonicalDigest } = require(
  path.join(root, 'src', 'engine', 'implementation-campaign'),
);
const input = JSON.parse(inputJson);
const row = {
  schema: 1,
  cleanup_id: input.cleanupId,
  action: 'intent',
  ...input.record,
};
row.record_digest = canonicalDigest(row);
fs.writeFileSync(journal, `${JSON.stringify(row)}\n`);
NODE
CLEANUP_REMOVE_INPUT="$(node - "$CLEANUP_INPUT" <<'NODE'
const input = JSON.parse(process.argv[2]);
const record = input.record;
process.stdout.write(JSON.stringify({
  cwd: input.cwd,
  worktree: record.worktree,
  expectedBranch: record.branch,
  expectedTip: record.expected_tip,
  expectedRootRunId: record.lineage_id,
  expectedRetentionOwner: record.retention_owner,
  expectedRetentionReason: record.retention_reason,
  expectedRetentionExpiresAt: record.retention_expires_at,
  expectedWorktreeInstanceId: record.worktree_instance_id,
}));
NODE
)"
flock -x "$CLEANUP_WORKTREE/.autopilot-worktree.lock" \
  node "$REPO_ROOT/src/engine/repair-lineage-cleanup.js" "$CLEANUP_REMOVE_INPUT"
PENDING_CLEANUP_STATE="$(node - "$REPO_ROOT" "$CLEANUP_INPUT" <<'NODE'
const path = require('path');
const [root, inputJson] = process.argv.slice(2);
const { repairLineageCleanupState } = require(
  path.join(root, 'src', 'engine', 'campaign-intake'),
);
const input = JSON.parse(inputJson);
process.stdout.write(String(repairLineageCleanupState({
  repo: input.cwd,
  reference: { commit: input.record.expected_tip },
  repairLineage: {
    lineage_id: input.record.lineage_id,
    branch: input.record.branch,
    worktree: input.record.worktree,
    cleanup_epoch: input.record.cleanup_epoch,
    worktree_instance_id: input.record.worktree_instance_id,
    retention_owner: input.record.retention_owner,
    retention_reason: input.record.retention_reason,
    retention_expires_at: input.record.retention_expires_at,
  },
})));
NODE
)"
assert_eq "$PENDING_CLEANUP_STATE" "pending_intent" \
  "durable intake accepts exact pending cleanup intent after removal crash"
flock -x "$CLEANUP_REPO/.git/autopilot/repair-lineage-cleanup.transaction.lock" \
  node "$REPO_ROOT/src/engine/repair-lineage-cleanup-transaction.js" \
  "$CLEANUP_INPUT" >"$TEST_TMP/cleanup-transaction-a.out" &
CLEANUP_PID_A=$!
flock -x "$CLEANUP_REPO/.git/autopilot/repair-lineage-cleanup.transaction.lock" \
  node "$REPO_ROOT/src/engine/repair-lineage-cleanup-transaction.js" \
  "$CLEANUP_INPUT" >"$TEST_TMP/cleanup-transaction-b.out" &
CLEANUP_PID_B=$!
wait "$CLEANUP_PID_A"; CLEANUP_EXIT_A=$?
wait "$CLEANUP_PID_B"; CLEANUP_EXIT_B=$?
assert_eq "$CLEANUP_EXIT_A" "0" \
  "first concurrent cleanup controller completes successfully"
assert_eq "$CLEANUP_EXIT_B" "0" \
  "second concurrent cleanup controller replays the serialized completion"
assert_file_absent "$CLEANUP_WORKTREE" \
  "serialized repair-lineage cleanup removes the exact clean retained worktree"
assert_eq "$(git -C "$CLEANUP_REPO" rev-parse retained-cleanup)" "$CLEANUP_TIP" \
  "serialized repair-lineage cleanup preserves the retained branch tip"
assert_eq "$(wc -l <"$CLEANUP_REPO/.git/autopilot/repair-lineage-cleanup.jsonl" \
  | tr -d ' ')" "2" \
  "crash recovery records one intent and one completion without duplicates"
NO_INTENT_INPUT="$(node - "$CLEANUP_INPUT" <<'NODE'
const input = JSON.parse(process.argv[2]);
input.cleanupId = 'f'.repeat(64);
process.stdout.write(JSON.stringify(input));
NODE
)"
OUT="$(flock -x "$CLEANUP_REPO/.git/autopilot/repair-lineage-cleanup.transaction.lock" \
  node "$REPO_ROOT/src/engine/repair-lineage-cleanup-transaction.js" \
  "$NO_INTENT_INPUT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" \
  "missing worktree without a prior intent cannot be retroactively recovered"
assert_contains "$OUT" "missing retained worktree has no prior cleanup intent" \
  "cleanup recovery requires durable ownership intent from an earlier attempt"

finalize_test
